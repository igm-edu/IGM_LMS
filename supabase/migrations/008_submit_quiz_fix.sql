-- submit_quiz 의 모호한 열 참조를 고친다
--
-- 007 은 배점 합계를 구할 때 `sum(score)` 로 썼다. RETURNS TABLE 에 선언한
-- 출력 이름 score 와 quiz_questions.score 열이 같은 이름이라 Postgres 가
-- 어느 쪽인지 정하지 못하고 "column reference score is ambiguous" 로 실패한다.
--
-- 함수를 만들 때는 오류가 나지 않는다. plpgsql 은 본문을 실행 시점에 해석하므로
-- 실제로 제출해 봐야 드러난다. 2026-08-12 라이브 확인에서 잡았다.
--
-- 출력 이름은 그대로 둔다. 화면이 score / is_passed / correct_count /
-- question_count 를 그 이름으로 읽고 있어 바꾸면 함께 고쳐야 한다.
-- 대신 본문의 열 참조에 전부 한정자를 붙인다.

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

  if not (public.is_admin() or public.is_enrolled(v_class_id)) then
    raise exception '수강 중인 과정의 퀴즈만 응시할 수 있습니다';
  end if;

  if not v_retry and exists (
    select 1 from quiz_attempts qa
     where qa.quiz_id = p_quiz_id and qa.user_id = auth.uid()
  ) then
    raise exception '재응시가 허용되지 않은 퀴즈입니다';
  end if;

  -- 여기가 007 에서 틀렸던 곳이다. qq. 를 붙여 열임을 분명히 한다.
  select coalesce(sum(qq.score), 0), count(*)
    into v_total, v_questions
    from quiz_questions qq
   where qq.quiz_id = p_quiz_id;

  if v_questions = 0 or v_total <= 0 then
    raise exception '문제가 등록되지 않은 퀴즈입니다';
  end if;

  if exists (
    select 1 from jsonb_array_elements(p_answers) a
     where not exists (
       select 1 from quiz_questions qq
        where qq.id = (a->>'question_id')::uuid and qq.quiz_id = p_quiz_id)
  ) then
    raise exception '이 퀴즈의 문제가 아닌 답안이 포함되어 있습니다';
  end if;

  if (select count(*) from jsonb_array_elements(p_answers) a) <>
     (select count(distinct a->>'question_id') from jsonb_array_elements(p_answers) a) then
    raise exception '같은 문제에 대한 답안이 여러 개입니다';
  end if;

  insert into quiz_attempts (user_id, quiz_id, score, is_passed)
  values (auth.uid(), p_quiz_id, 0, false)
  returning quiz_attempts.id into v_attempt;

  insert into quiz_answers (attempt_id, question_id, selected_option, is_correct)
  select v_attempt,
         (a->>'question_id')::uuid,
         (a->>'selected_option')::smallint,
         coalesce(ak.correct_option = (a->>'selected_option')::smallint, false)
    from jsonb_array_elements(p_answers) a
    left join quiz_answer_keys ak on ak.question_id = (a->>'question_id')::uuid;

  select coalesce(sum(qq.score), 0), count(*)
    into v_earned, v_correct
    from quiz_answers ans
    join quiz_questions qq on qq.id = ans.question_id
   where ans.attempt_id = v_attempt and ans.is_correct;

  v_score  := round((v_earned / v_total) * 100, 2);
  v_passed := v_score >= v_pass;

  update quiz_attempts qa
     set score = v_score, is_passed = v_passed
   where qa.id = v_attempt;

  return query select v_attempt, v_score, v_passed, v_correct, v_questions;
end;
$$;
