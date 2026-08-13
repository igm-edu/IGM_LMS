-- 영상 길이가 바뀌면 그 차시의 시청 기록을 다시 계산한다
--
-- 시청률은 watch_logs 에 쓸 때 계산해서 저장한다(002). 그래서 나중에 차시의
-- video_duration_sec 이 바뀌어도 이미 쌓인 행은 옛 길이 기준의 값을 그대로
-- 들고 있는다. 자동 측정이 틀렸을 때 길이를 수동 보정하는 경로를 열어 두었으므로
-- 이 상황은 실제로 생긴다. 수료 판정이 잘못된 분모로 내려진다.
--
-- 예: 600초로 등록된 영상을 300초까지 본 수강생은 50%. 관리자가 실제 길이인
-- 300초로 고치면 100%가 되어야 하는데 50%로 남는다.
--
-- 2026-08-12 라이브 확인 중 발견했다. 902초짜리로 등록된 차시를 5초짜리 영상으로
-- 바꿨더니 max_watched_sec 902 가 그대로 남아 영상 길이보다 큰 값이 되었다.

create or replace function public.recalc_watch_rates()
  returns trigger language plpgsql set search_path = public as $$
begin
  if new.video_duration_sec is distinct from old.video_duration_sec
     and new.video_duration_sec > 0 then
    -- SET 의 모든 식은 갱신 전 행 값을 본다. least() 를 여러 번 써도 일관된다.
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

create trigger lessons_recalc_watch
  after update on public.lessons
  for each row execute function public.recalc_watch_rates();

-- 이미 어긋난 행을 한 번 바로잡는다. 위 트리거는 앞으로의 변경만 다룬다.
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
   and w.max_watched_sec > l.video_duration_sec;
