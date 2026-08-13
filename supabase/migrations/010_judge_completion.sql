-- 수료 판정
--
-- attendance 는 "지금 상태" 가 아니라 "판정한 기록" 이다. 그래서 판정 시점의
-- 기준값(출결 기준, 퀴즈 합격점)을 함께 찍어 둔다. 나중에 클래스의 기준이
-- 바뀌어도 이미 내린 판정의 근거가 흔들리지 않는다.
--
-- 계산 방식
--   시청률   = 클래스의 모든 차시에 대한 watch_rate 평균. 기록이 없는 차시는 0.
--   퀴즈점수 = 클래스의 모든 퀴즈에 대해 "본인 최고 점수" 의 평균. 미응시는 0.
--
-- 퀴즈가 하나도 없는 클래스는 퀴즈 조건을 보지 않는다. 그러지 않으면 퀴즈를
-- 만들지 않은 클래스에서 아무도 수료할 수 없다. 이때 total_quiz_score 에는
-- 실제 평균인 0 이 들어가므로, 화면은 "퀴즈 없음" 을 구분해 보여줘야 한다.
-- 저장값을 100 으로 꾸미면 응시하지도 않은 점수가 기록으로 남는다.

create or replace function public.judge_completion(p_user_id uuid, p_class_id uuid)
  returns table (
    total_watch_rate numeric,
    total_quiz_score numeric,
    is_completed     boolean,
    lesson_count     integer,
    quiz_count       integer
  )
  language plpgsql security definer set search_path = public as $$
declare
  v_watch_threshold numeric;
  v_quiz_threshold  numeric;
  v_lessons integer;
  v_quizzes integer;
  v_watch   numeric;
  v_quiz    numeric;
  v_done    boolean;
begin
  if not public.is_admin() and not public.teaches_class(p_class_id) then
    raise exception '권한이 없습니다';
  end if;

  select c.watch_rate_threshold, c.quiz_pass_score
    into v_watch_threshold, v_quiz_threshold
    from classes c where c.id = p_class_id;

  if v_watch_threshold is null then
    raise exception '클래스를 찾을 수 없습니다';
  end if;

  if not exists (
    select 1 from enrollments e
     where e.user_id = p_user_id and e.class_id = p_class_id and e.status = '수강중'
  ) then
    raise exception '수강 중인 수강생이 아닙니다';
  end if;

  -- 기록이 없는 차시를 0 으로 세려면 lessons 를 기준으로 왼쪽 조인해야 한다.
  select count(*), coalesce(avg(coalesce(w.watch_rate, 0)), 0)
    into v_lessons, v_watch
    from lessons l
    left join watch_logs w on w.lesson_id = l.id and w.user_id = p_user_id
   where l.class_id = p_class_id;

  if v_lessons = 0 then
    raise exception '차시가 없는 클래스는 수료 판정을 할 수 없습니다';
  end if;

  -- 퀴즈마다 본인 최고 점수를 뽑아 평균낸다. 미응시는 0.
  select count(*), coalesce(avg(coalesce(best.score, 0)), 0)
    into v_quizzes, v_quiz
    from quizzes q
    join lessons l on l.id = q.lesson_id
    left join lateral (
      select max(a.score) as score
        from quiz_attempts a
       where a.quiz_id = q.id and a.user_id = p_user_id
    ) best on true
   where l.class_id = p_class_id;

  v_watch := round(v_watch, 2);
  v_quiz  := round(v_quiz, 2);
  v_done  := v_watch >= v_watch_threshold
             and (v_quizzes = 0 or v_quiz >= v_quiz_threshold);

  insert into attendance (
    user_id, class_id, total_watch_rate, total_quiz_score, is_completed,
    watch_rate_threshold_at_completion, quiz_pass_score_at_completion, completed_at
  ) values (
    p_user_id, p_class_id, v_watch, v_quiz, v_done,
    v_watch_threshold, v_quiz_threshold,
    case when v_done then now() else null end
  )
  on conflict (user_id, class_id) do update
     set total_watch_rate = excluded.total_watch_rate,
         total_quiz_score = excluded.total_quiz_score,
         is_completed     = excluded.is_completed,
         watch_rate_threshold_at_completion = excluded.watch_rate_threshold_at_completion,
         quiz_pass_score_at_completion      = excluded.quiz_pass_score_at_completion,
         -- 한 번 수료한 시각은 다시 판정해도 덮지 않는다. 수료증의 근거다.
         completed_at = coalesce(attendance.completed_at, excluded.completed_at);

  return query select v_watch, v_quiz, v_done, v_lessons, v_quizzes;
end;
$$;

/** 클래스의 수강생 전원을 한 번에 판정한다. */
create or replace function public.judge_class_completions(p_class_id uuid)
  returns table (
    user_id          uuid,
    name             text,
    total_watch_rate numeric,
    total_quiz_score numeric,
    is_completed     boolean
  )
  language plpgsql security definer set search_path = public as $$
declare
  r record;
begin
  if not public.is_admin() and not public.teaches_class(p_class_id) then
    raise exception '권한이 없습니다';
  end if;

  for r in
    select e.user_id from enrollments e
     where e.class_id = p_class_id and e.status = '수강중'
  loop
    perform public.judge_completion(r.user_id, p_class_id);
  end loop;

  return query
    select a.user_id, p.name, a.total_watch_rate, a.total_quiz_score, a.is_completed
      from attendance a
      join profiles p on p.id = a.user_id
     where a.class_id = p_class_id
     order by p.name;
end;
$$;

revoke all on function public.judge_completion(uuid, uuid)      from public, anon, authenticated;
revoke all on function public.judge_class_completions(uuid)     from public, anon, authenticated;
grant execute on function public.judge_completion(uuid, uuid)   to authenticated;
grant execute on function public.judge_class_completions(uuid)  to authenticated;
