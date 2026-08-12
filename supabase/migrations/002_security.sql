-- IGM LMS 접근 제어
--
-- 001 다음에 실행한다. 이 파일이 끝나기 전까지 테이블은 보호되지 않는다.
--
-- 여기가 이 아키텍처에서 가장 위험한 파일이다. 공개 키가 프론트에 박히므로
-- 아래 정책이 유일한 방어선이다. Apps Script 시절에는 코드가 서버에만 있어
-- 실수해도 노출 범위가 좁았지만 여기서는 정책 하나가 곧 개인정보 전체다.

-- ---------------------------------------------------------------------------
-- 0. 기본 권한 회수
-- ---------------------------------------------------------------------------
-- Supabase 는 public 스키마의 새 테이블에 anon/authenticated 권한을 기본으로 준다.
-- 전부 회수하고 필요한 것만 아래에서 다시 준다. 빠뜨린 테이블이 열려 있는 것보다
-- 빠뜨린 테이블에 접근이 안 되는 편이 낫다.
revoke all on all tables in schema public from anon, authenticated;

-- 로그인하지 않은 사용자는 어떤 테이블에도 접근하지 않는다.
-- 가입·로그인은 auth 스키마가 처리하므로 여기서 열어 줄 것이 없다.

-- ---------------------------------------------------------------------------
-- 1. 보조 함수
-- ---------------------------------------------------------------------------
-- 전부 security definer 다. 정책 안에서 profiles 를 다시 조회하면 profiles 의
-- 정책이 또 평가되어 무한 재귀가 난다. definer 로 감싸면 RLS를 건너뛰므로
-- 재귀가 끊긴다. search_path 고정은 definer 함수의 필수 안전장치다.

create or replace function public.is_admin()
  returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from profiles
    where id = auth.uid() and role = 'admin' and status = 'active'
  );
$$;

create or replace function public.teaches_class(cid uuid)
  returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from classes c
    join profiles p on p.id = auth.uid()
    where c.id = cid and c.instructor_id = auth.uid()
      and p.status = 'active' and p.role in ('instructor', 'admin')
  );
$$;

create or replace function public.is_enrolled(cid uuid)
  returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from enrollments
    where class_id = cid and user_id = auth.uid() and status = '수강중'
  );
$$;

-- 클래스에 딸린 자료(차시·퀴즈)를 볼 수 있는가
create or replace function public.can_view_class(cid uuid)
  returns boolean language sql stable security definer set search_path = public as $$
  select public.is_admin() or public.teaches_class(cid) or public.is_enrolled(cid);
$$;

-- 차시가 속한 클래스
create or replace function public.class_of_lesson(lid uuid)
  returns uuid language sql stable security definer set search_path = public as $$
  select class_id from lessons where id = lid;
$$;

-- 퀴즈가 속한 클래스
create or replace function public.class_of_quiz(qid uuid)
  returns uuid language sql stable security definer set search_path = public as $$
  select l.class_id from quizzes q join lessons l on l.id = q.lesson_id where q.id = qid;
$$;

-- ---------------------------------------------------------------------------
-- 2. 가입 시 프로필 생성
-- ---------------------------------------------------------------------------
-- 중요: raw_user_meta_data 는 클라이언트가 보내는 값이다. 여기서 role 을 읽으면
-- 가입할 때 role: 'admin' 을 끼워 넣는 것만으로 관리자가 된다. 역할은 반드시
-- 기본값(student)으로 고정하고, 변경은 003의 관리자 전용 함수로만 한다.
create or replace function public.handle_new_user()
  returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (
    id, email, name, phone, company, position, birth_date,
    consent_at, retention_until
  ) values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'name', ''),
    coalesce(new.raw_user_meta_data->>'phone', ''),
    coalesce(new.raw_user_meta_data->>'company', ''),
    coalesce(new.raw_user_meta_data->>'position', ''),
    (new.raw_user_meta_data->>'birth_date')::date,
    now(),
    now() + interval '3 years'   -- 상위 설계의 보관 기간 3년
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- profiles.email 은 auth.users.email 의 사본이므로 변경을 따라가야 한다.
-- 이 트리거를 빠뜨리면 이메일을 바꾼 사람의 관리자 화면 표시가 옛 주소로 남는다.
create or replace function public.sync_profile_email()
  returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.email is distinct from old.email then
    update public.profiles set email = new.email where id = new.id;
  end if;
  return new;
end;
$$;

create trigger on_auth_user_email_updated
  after update of email on auth.users
  for each row execute function public.sync_profile_email();

-- ---------------------------------------------------------------------------
-- 3. 값 계산 트리거
-- ---------------------------------------------------------------------------
-- 시청률을 클라이언트가 보내는 값 그대로 저장하면 max_watched_sec 은 0인데
-- watch_rate 만 100으로 올려 보낼 수 있다. 초 단위 값만 받고 비율은 여기서 만든다.
-- 누적값이 줄지 않게 하는 것까지 여기서 강제한다.
create or replace function public.compute_watch_rate()
  returns trigger language plpgsql security definer set search_path = public as $$
declare
  dur integer;
  threshold numeric(5,2);
begin
  select l.video_duration_sec, c.watch_rate_threshold
    into dur, threshold
    from lessons l join classes c on c.id = l.class_id
   where l.id = new.lesson_id;

  if dur is null or dur <= 0 then
    raise exception '차시의 영상 길이가 없습니다: %', new.lesson_id;
  end if;

  if tg_op = 'UPDATE' then
    new.max_watched_sec := greatest(new.max_watched_sec, old.max_watched_sec);
  end if;
  if new.max_watched_sec > dur then
    new.max_watched_sec := dur;
  end if;

  new.watch_rate := round((new.max_watched_sec::numeric / dur) * 100, 2);
  new.completed := new.watch_rate >= threshold;
  new.last_updated_at := now();
  return new;
end;
$$;

create trigger watch_logs_compute
  before insert or update on public.watch_logs
  for each row execute function public.compute_watch_rate();

-- 담당 강사는 강사나 관리자여야 한다. 외래키로는 표현할 수 없어 트리거로 둔다.
create or replace function public.check_instructor_role()
  returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.instructor_id is not null and not exists (
    select 1 from profiles
     where id = new.instructor_id and role in ('instructor', 'admin')
  ) then
    raise exception '담당 강사는 instructor 또는 admin 역할이어야 합니다';
  end if;
  return new;
end;
$$;

create trigger classes_check_instructor
  before insert or update on public.classes
  for each row execute function public.check_instructor_role();

-- ---------------------------------------------------------------------------
-- 4. RLS 켜기
-- ---------------------------------------------------------------------------
alter table public.profiles          enable row level security;
alter table public.classes           enable row level security;
alter table public.lessons           enable row level security;
alter table public.enrollments       enable row level security;
alter table public.watch_logs        enable row level security;
alter table public.quizzes           enable row level security;
alter table public.quiz_questions    enable row level security;
alter table public.quiz_answer_keys  enable row level security;
alter table public.quiz_attempts     enable row level security;
alter table public.quiz_answers      enable row level security;
alter table public.attendance        enable row level security;
alter table public.certificates      enable row level security;
alter table public.error_log         enable row level security;

-- ---------------------------------------------------------------------------
-- 5. profiles
-- ---------------------------------------------------------------------------
-- 본인 행과 관리자만. 다른 수강생의 행은 아예 보이지 않으므로 birth_date 와
-- 동의 기록이 새어나가지 않는다. publicUser_ 화이트리스트가 하던 일을
-- 행 정책이 대신한다.
grant select on public.profiles to authenticated;

-- 열 단위 제한. RLS 는 행 단위라 "이 행은 수정 가능하되 role 은 안 됨"을
-- 표현하지 못한다. 열 권한으로 막는다. 이걸 빠뜨리면 수강생이 자기 role 을
-- admin 으로 바꿀 수 있다.
grant update (name, phone, company, position, birth_date)
  on public.profiles to authenticated;

-- 주의: 열 권한은 로그인한 모두에게 같이 적용된다. Postgres 입장에서 관리자도
-- authenticated 이므로 관리자 역시 이 UPDATE 로는 role/status 를 바꿀 수 없다.
-- 역할·상태 변경은 003의 관리자 전용 함수로만 한다. 설계상 의도한 제약이다.

create policy profiles_select on public.profiles for select to authenticated
  using (id = auth.uid() or public.is_admin());

create policy profiles_update on public.profiles for update to authenticated
  using (id = auth.uid() or public.is_admin())
  with check (id = auth.uid() or public.is_admin());

-- insert/delete 권한은 주지 않는다. 생성은 가입 트리거가, 삭제는 auth.users
-- 삭제에 따른 cascade 가 담당한다.

-- ---------------------------------------------------------------------------
-- 6. classes
-- ---------------------------------------------------------------------------
grant select on public.classes to authenticated;
grant insert, update, delete on public.classes to authenticated;

create policy classes_select on public.classes for select to authenticated
  using (true);

create policy classes_write on public.classes for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- ---------------------------------------------------------------------------
-- 7. lessons
-- ---------------------------------------------------------------------------
grant select, insert, update, delete on public.lessons to authenticated;

create policy lessons_select on public.lessons for select to authenticated
  using (public.can_view_class(class_id));

create policy lessons_write on public.lessons for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- ---------------------------------------------------------------------------
-- 8. enrollments
-- ---------------------------------------------------------------------------
-- 수강 등록은 관리자가 한다. 본인 신청 경로를 열 거라면 insert 정책을 따로 만든다.
grant select, insert, update, delete on public.enrollments to authenticated;

create policy enrollments_select on public.enrollments for select to authenticated
  using (user_id = auth.uid() or public.is_admin() or public.teaches_class(class_id));

create policy enrollments_write on public.enrollments for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- ---------------------------------------------------------------------------
-- 9. watch_logs
-- ---------------------------------------------------------------------------
grant select, insert, update on public.watch_logs to authenticated;

create policy watch_logs_select on public.watch_logs for select to authenticated
  using (
    user_id = auth.uid()
    or public.is_admin()
    or public.teaches_class(public.class_of_lesson(lesson_id))
  );

-- 본인 기록만 쓴다. 남의 user_id 로 넣는 것을 with check 가 막는다.
create policy watch_logs_insert on public.watch_logs for insert to authenticated
  with check (user_id = auth.uid() and public.is_enrolled(public.class_of_lesson(lesson_id)));

create policy watch_logs_update on public.watch_logs for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- 10. 퀴즈
-- ---------------------------------------------------------------------------
grant select, insert, update, delete on public.quizzes to authenticated;
grant select, insert, update, delete on public.quiz_questions to authenticated;
grant select, insert, update, delete on public.quiz_answer_keys to authenticated;
grant select on public.quiz_attempts to authenticated;
grant select on public.quiz_answers to authenticated;

create policy quizzes_select on public.quizzes for select to authenticated
  using (public.can_view_class(public.class_of_lesson(lesson_id)));
create policy quizzes_write on public.quizzes for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

create policy quiz_questions_select on public.quiz_questions for select to authenticated
  using (public.can_view_class(public.class_of_quiz(quiz_id)));
create policy quiz_questions_write on public.quiz_questions for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- 정답은 관리자만. 수강생에게는 select 정책이 없으므로 한 행도 나가지 않는다.
create policy quiz_answer_keys_admin on public.quiz_answer_keys for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- 응시 기록은 읽기만 준다. 제출은 003의 채점 함수로만 한다.
-- insert 권한 자체를 주지 않았으므로 점수를 직접 써 넣을 수 없다.
create policy quiz_attempts_select on public.quiz_attempts for select to authenticated
  using (
    user_id = auth.uid()
    or public.is_admin()
    or public.teaches_class(public.class_of_quiz(quiz_id))
  );

create policy quiz_answers_select on public.quiz_answers for select to authenticated
  using (exists (
    select 1 from public.quiz_attempts a
     where a.id = attempt_id
       and (a.user_id = auth.uid() or public.is_admin()
            or public.teaches_class(public.class_of_quiz(a.quiz_id)))
  ));

-- ---------------------------------------------------------------------------
-- 11. attendance / certificates
-- ---------------------------------------------------------------------------
grant select, insert, update, delete on public.attendance to authenticated;
grant select, insert, update, delete on public.certificates to authenticated;

create policy attendance_select on public.attendance for select to authenticated
  using (user_id = auth.uid() or public.is_admin() or public.teaches_class(class_id));
create policy attendance_write on public.attendance for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

create policy certificates_select on public.certificates for select to authenticated
  using (exists (
    select 1 from public.attendance a
     where a.id = attendance_id
       and (a.user_id = auth.uid() or public.is_admin() or public.teaches_class(a.class_id))
  ));
create policy certificates_write on public.certificates for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- ---------------------------------------------------------------------------
-- 12. error_log
-- ---------------------------------------------------------------------------
-- 클라이언트가 남길 수 있게 insert 만 열고 읽기는 관리자에게만 준다.
grant insert on public.error_log to authenticated;
grant select on public.error_log to authenticated;

create policy error_log_insert on public.error_log for insert to authenticated
  with check (true);
create policy error_log_select on public.error_log for select to authenticated
  using (public.is_admin());
