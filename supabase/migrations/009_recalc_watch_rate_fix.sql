-- recalc_watch_rates 에 security definer 를 붙인다
--
-- 006 은 이 함수를 security definer 없이 만들었다. 트리거 함수는 기본적으로
-- 호출한 사람의 권한으로 돌기 때문에, 관리자가 차시 길이를 바꿔도 watch_logs 의
-- UPDATE 정책(user_id = auth.uid())에 걸려 **자기 자신의 시청 기록만** 고쳐진다.
-- 다른 수강생들의 행은 조용히 그대로 남는다. 오류도 나지 않는다.
--
-- 002 의 compute_watch_rate 에는 붙였는데 여기서 빠뜨렸다. 같은 실수를 막으려면
-- "트리거 함수가 다른 사람의 행을 건드리는가" 를 기준으로 보면 된다.
-- 005 의 check_lesson_duration_with_url 은 NEW/OLD 만 보므로 필요 없다.
--
-- 트리거는 이미 있으므로 다시 만들지 않는다. 함수만 바꾸면 트리거가 새 정의를
-- 쓴다. (006 을 다시 실행하면 "trigger already exists" 로 멈추는데, 그 자체는
-- 무해하지만 뒤따르는 보정 UPDATE 까지 건너뛰게 되므로 아래에 다시 넣었다.)

create or replace function public.recalc_watch_rates()
  returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.video_duration_sec is distinct from old.video_duration_sec
     and new.video_duration_sec > 0 then
    update watch_logs w
       set max_watched_sec = least(w.max_watched_sec, new.video_duration_sec),
           watch_rate = round(
             (least(w.max_watched_sec, new.video_duration_sec)::numeric
              / new.video_duration_sec) * 100, 2),
           completed = round(
             (least(w.max_watched_sec, new.video_duration_sec)::numeric
              / new.video_duration_sec) * 100, 2) >= c.watch_rate_threshold,
           last_updated_at = now()
      from classes c
     where w.lesson_id = new.id
       and c.id = new.class_id;
  end if;
  return new;
end;
$$;

-- 그동안 어긋난 채로 남은 행을 바로잡는다. 여러 번 실행해도 결과는 같다.
update watch_logs w
   set max_watched_sec = least(w.max_watched_sec, l.video_duration_sec),
       watch_rate = round(
         (least(w.max_watched_sec, l.video_duration_sec)::numeric
          / l.video_duration_sec) * 100, 2),
       completed = round(
         (least(w.max_watched_sec, l.video_duration_sec)::numeric
          / l.video_duration_sec) * 100, 2) >= c.watch_rate_threshold
  from lessons l
  join classes c on c.id = l.class_id
 where w.lesson_id = l.id
   and l.video_duration_sec > 0
   and (w.max_watched_sec > l.video_duration_sec
        or w.watch_rate is distinct from round(
             (least(w.max_watched_sec, l.video_duration_sec)::numeric
              / l.video_duration_sec) * 100, 2));
