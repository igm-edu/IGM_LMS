-- IGM LMS 서버 함수
--
-- 002 다음에 실행한다.
--
-- 여기 있는 함수들은 "테이블에 직접 권한을 주면 위험한 조작"을 담는다.
-- 전부 security definer 이므로 함수 첫 줄의 권한 검사가 유일한 관문이다.
-- 검사를 빠뜨린 definer 함수는 열어 둔 뒷문과 같다.

-- ---------------------------------------------------------------------------
-- 1. 역할·상태 변경 (관리자 전용)
-- ---------------------------------------------------------------------------
-- 002에서 profiles 의 UPDATE 를 다섯 개 열로만 제한했다. 열 권한은 로그인한
-- 모두에게 똑같이 적용되므로 관리자도 그 경로로는 role 을 바꿀 수 없다.
-- 그래서 역할 변경만 이 함수로 따로 뺐다. 우회로가 아니라 유일한 통로다.

create or replace function public.admin_set_user_role(target_id uuid, new_role text)
  returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then
    raise exception '권한이 없습니다';
  end if;
  if new_role not in ('student', 'instructor', 'admin') then
    raise exception '알 수 없는 역할입니다: %', new_role;
  end if;
  -- 마지막 관리자가 스스로를 강등하면 아무도 관리자 기능에 접근할 수 없게 된다.
  if new_role <> 'admin' and target_id = auth.uid() then
    raise exception '본인의 관리자 권한은 스스로 내릴 수 없습니다';
  end if;

  update profiles set role = new_role where id = target_id;
  if not found then
    raise exception '대상 사용자를 찾을 수 없습니다';
  end if;
end;
$$;

create or replace function public.admin_set_user_status(target_id uuid, new_status text)
  returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then
    raise exception '권한이 없습니다';
  end if;
  if new_status not in ('active', 'inactive') then
    raise exception '알 수 없는 상태입니다: %', new_status;
  end if;
  if new_status = 'inactive' and target_id = auth.uid() then
    raise exception '본인 계정은 스스로 비활성화할 수 없습니다';
  end if;

  update profiles set status = new_status where id = target_id;
  if not found then
    raise exception '대상 사용자를 찾을 수 없습니다';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. 강사 후보 목록
-- ---------------------------------------------------------------------------
-- 클래스 등록 화면에서 담당 강사를 고르려면 후보 목록이 필요하다.
-- profiles 의 행 정책은 본인과 관리자만 허용하므로 일반 조회로는 나오지 않는다.
-- 이름과 소속만 돌려주고 연락처·생년월일은 내보내지 않는다.
create or replace function public.list_instructors()
  returns table (id uuid, name text, company text)
  language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then
    raise exception '권한이 없습니다';
  end if;
  return query
    select p.id, p.name, p.company
      from profiles p
     where p.role in ('instructor', 'admin') and p.status = 'active'
     order by p.name;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. 클래스 수강생 명단
-- ---------------------------------------------------------------------------
-- 강사가 담당 클래스의 수강생을 봐야 하지만 profiles 행 접근을 열어 주면
-- 생년월일과 동의 기록까지 함께 나간다. 필요한 열만 골라 돌려준다.
create or replace function public.class_roster(cid uuid)
  returns table (user_id uuid, name text, email text, company text, "position" text)
  language plpgsql security definer set search_path = public as $$
begin
  if not (public.is_admin() or public.teaches_class(cid)) then
    raise exception '권한이 없습니다';
  end if;
  return query
    select p.id, p.name, p.email::text, p.company, p."position"
      from enrollments e join profiles p on p.id = e.user_id
     where e.class_id = cid and e.status = '수강중'
     order by p.name;
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. 함수 실행 권한
-- ---------------------------------------------------------------------------
-- Supabase 는 public 스키마의 함수 실행 권한도 기본으로 주므로 회수 후 다시 준다.
-- 보조 함수(is_admin 등)는 정책 안에서만 쓰이므로 직접 호출을 열 이유가 없다.
revoke all on function public.admin_set_user_role(uuid, text)   from public, anon, authenticated;
revoke all on function public.admin_set_user_status(uuid, text) from public, anon, authenticated;
revoke all on function public.list_instructors()                from public, anon, authenticated;
revoke all on function public.class_roster(uuid)                from public, anon, authenticated;

grant execute on function public.admin_set_user_role(uuid, text)   to authenticated;
grant execute on function public.admin_set_user_status(uuid, text) to authenticated;
grant execute on function public.list_instructors()                to authenticated;
grant execute on function public.class_roster(uuid)                to authenticated;

-- ---------------------------------------------------------------------------
-- 아직 만들지 않은 것
-- ---------------------------------------------------------------------------
-- submit_quiz(quiz_id, answers) : 서버에서 채점하고 점수만 돌려주는 함수.
--   quiz_attempts / quiz_answers 에 insert 권한을 주지 않은 것은 이 함수를
--   전제한 것이다. 퀴즈 기능을 만들 때 함께 작성한다. 그때까지 수강생은
--   응시 기록을 만들 수 없다(읽기만 가능).
-- judge_completion(user_id, class_id) : 수료 판정. attendance 에 그 시점의
--   기준값을 함께 기록한다. 출결·수료 기능과 함께 작성한다.
