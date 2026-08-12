-- 시청 기록 삭제 권한 (관리자 전용)
--
-- 002 에서 watch_logs 에 select/insert/update 만 주고 delete 를 빠뜨렸다.
-- 그 결과 잘못 쌓인 시청 기록을 아무도 지울 수 없었다. 관리자도 마찬가지였다.
-- 실제로 걸린 경로: 클래스를 지우려 하면 차시로 cascade 되는데 watch_logs 의
-- on delete restrict 가 막고, 그 watch_logs 를 지울 방법이 없어 교착이 된다.
--
-- 수강생에게는 주지 않는다. 시청 기록을 지우고 다시 쌓는 것은 진도 조작이다.

grant delete on public.watch_logs to authenticated;

create policy watch_logs_delete on public.watch_logs for delete to authenticated
  using (public.is_admin());
