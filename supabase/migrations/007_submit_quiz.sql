-- 퀴즈 채점
--
-- 수강생에게 quiz_attempts / quiz_answers 의 insert 권한을 주지 않은 것이
-- 이 함수를 전제한 것이다(002). 권한을 줬다면 자기 점수를 직접 100점으로
-- 써 넣을 수 있다. 정답을 quiz_answer_keys 로 분리한 것도 같은 이유다.
--
-- 점수는 백분율로 계산한다. 문항 배점의 합이 100이라는 보장이 없으므로
-- (맞힌 배점 합 / 전체 배점 합) * 100 으로 환산해 pass_score(0~100)와 비교한다.

create or replace function public.submit_quiz(p_quiz_id uuid, p_answers jsonb)
  returns table (
    attempt_id      uuid,
    score           numeric,
    is_passed       boolean,
    correct_count   integer,
    question_count  integer
  )
  language plpgsql security definer set search_path = public as $$
declare
  v_class_id  uuid;
  v_pass      numeric;
  v_retry     boolean;
  v_total     numeric;
  v_questions integer;
  v_earned    numeric;
  v_correct   integer;
  v_attempt   uuid;
  v_score     numeric;
  v_passed    boolean;
begin
  if p_answers is null or jsonb_typeof(p_answers) <> 'array' then
    raise exception '답안 형식이 올바르지 않습니다';
  end if;

  select l.class_id, q.pass_score, c.quiz_retry_allowed
    into v_class_id, v_pass, v_retry
    from quizzes q
    join lessons l on l.id = q.lesson_id
    join classes c on c.id = l.class_id
   where q.id = p_quiz_id;

  if v_class_id is null then
    raise exception '퀴즈를 찾을 수 없습니다';
  end if;

  -- 화면을 우회해 남의 과정 퀴즈를 제출하는 것을 막는다.
  if not (public.is_admin() or public.is_enrolled(v_class_id)) then
    raise exception '수강 중인 과정의 퀴즈만 응시할 수 있습니다';
  end if;

  if not v_retry and exists (
    select 1 from quiz_attempts where quiz_id = p_quiz_id and user_id = auth.uid()
  ) then
    raise exception '재응시가 허용되지 않은 퀴즈입니다';
  end if;

  select coalesce(sum(score), 0), count(*)
    into v_total, v_questions
    from quiz_questions where quiz_id = p_quiz_id;

  if v_questions = 0 or v_total <= 0 then
    raise exception '문제가 등록되지 않은 퀴즈입니다';
  end if;

  -- 이 퀴즈의 문제가 아닌 답안을 조용히 버리면 점수만 이상해진다.
  if exists (
    select 1 from jsonb_array_elements(p_answers) a
     where not exists (
       select 1 from quiz_questions qq
        where qq.id = (a->>'question_id')::uuid and qq.quiz_id = p_quiz_id)
  ) then
    raise exception '이 퀴즈의 문제가 아닌 답안이 포함되어 있습니다';
  end if;

  -- 같은 문제에 두 번 답하면 어느 쪽을 채점할지 정해지지 않는다.
  if (select count(*) from jsonb_array_elements(p_answers) a) <>
     (select count(distinct a->>'question_id') from jsonb_array_elements(p_answers) a) then
    raise exception '같은 문제에 대한 답안이 여러 개입니다';
  end if;

  insert into quiz_attempts (user_id, quiz_id, score, is_passed)
  values (auth.uid(), p_quiz_id, 0, false)
  returning id into v_attempt;

  -- 정답 키가 없는 문제는 오답으로 둔다. 관리자가 정답을 넣지 않은 상태인데,
  -- 여기서 예외를 던지면 수강생이 제출 자체를 못 한다.
  insert into quiz_answers (attempt_id, question_id, selected_option, is_correct)
  select v_attempt,
         (a->>'question_id')::uuid,
         (a->>'selected_option')::smallint,
         coalesce(ak.correct_option = (a->>'selected_option')::smallint, false)
    from jsonb_array_elements(p_answers) a
    left join quiz_answer_keys ak on ak.question_id = (a->>'question_id')::uuid;

  -- 답하지 않은 문제는 행이 없으므로 자연히 0점이다.
  select coalesce(sum(qq.score), 0), count(*)
    into v_earned, v_correct
    from quiz_answers ans
    join quiz_questions qq on qq.id = ans.question_id
   where ans.attempt_id = v_attempt and ans.is_correct;

  v_score  := round((v_earned / v_total) * 100, 2);
  v_passed := v_score >= v_pass;

  update quiz_attempts
     set score = v_score, is_passed = v_passed
   where id = v_attempt;

  return query select v_attempt, v_score, v_passed, v_correct, v_questions;
end;
$$;

revoke all on function public.submit_quiz(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.submit_quiz(uuid, jsonb) to authenticated;
