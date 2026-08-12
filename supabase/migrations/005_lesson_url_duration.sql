-- 영상 주소를 바꿀 때는 길이도 함께 바꾼다
--
-- 주소만 갈고 길이를 그대로 두면 시청률의 분모가 이전 영상 것으로 남는다.
-- 오류가 나지 않고 숫자만 조용히 틀어지는 종류라 사람이 알아채기 어렵다.
-- 설계 문서(2026-08-06-class-lesson-design.md)가 정한 규칙인데, Apps Script
-- 시절에는 핸들러가 막았고 PostgREST 로 넘어오면서 막는 곳이 없어졌다.
--
-- 길이만 고치는 것은 허용한다. 자동 측정이 틀렸을 때의 수동 보정 경로다.
--
-- 알려진 한계: 새 영상의 길이가 이전과 초 단위까지 같으면 트리거가 구분하지
-- 못하고 거부한다. 트리거는 "무엇을 보냈는지"가 아니라 "결과 행이 달라졌는지"만
-- 볼 수 있기 때문이다. 드문 경우이고, 그때는 길이를 다른 값으로 한 번 저장한 뒤
-- 되돌리면 된다. 분모가 조용히 틀어지는 쪽보다 낫다고 보아 이 거래를 택했다.

create or replace function public.check_lesson_duration_with_url()
  returns trigger language plpgsql set search_path = public as $$
begin
  if new.video_url is distinct from old.video_url
     and new.video_duration_sec is not distinct from old.video_duration_sec then
    raise exception '영상 주소를 바꿀 때는 영상 길이도 함께 저장해야 합니다';
  end if;
  return new;
end;
$$;

create trigger lessons_url_duration
  before update on public.lessons
  for each row execute function public.check_lesson_duration_with_url();
