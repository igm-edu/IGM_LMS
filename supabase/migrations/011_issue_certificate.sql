-- 수료증 발급
--
-- 번호 형식: IGM-<연도>-<4자리 일련번호>  (예: IGM-2026-0001)
-- 연도는 수료 시각 기준이다. 12월에 수료하고 1월에 발급해도 수료한 해의
-- 번호를 받아야 한다. 발급일 기준으로 매기면 같은 기수가 두 해로 갈린다.
--
-- 일련번호는 그해 마지막 번호 + 1 이다. 개수를 세지 않고 최댓값을 쓰는 이유는,
-- 중간에 한 장을 지우면 개수 방식은 이미 나간 번호를 다시 발급하기 때문이다.
--
-- 동시에 두 명이 발급하면 같은 번호를 계산할 수 있다. certificate_no 에
-- unique 가 있어 데이터가 깨지지는 않지만 한쪽이 오류로 실패한다.
-- 연도별 자문 잠금으로 아예 줄을 세운다. 트랜잭션이 끝나면 자동으로 풀린다.

create or replace function public.issue_certificate(p_attendance_id uuid)
  returns table (certificate_no text, issued_at timestamptz, already boolean)
  language plpgsql security definer set search_path = public as $$
declare
  v_class_id  uuid;
  v_completed boolean;
  v_when      timestamptz;
  v_year      text;
  v_seq       integer;
  v_no        text;
  v_existing  record;
begin
  select a.class_id, a.is_completed, a.completed_at
    into v_class_id, v_completed, v_when
    from attendance a where a.id = p_attendance_id;

  if v_class_id is null then
    raise exception '수료 판정 기록을 찾을 수 없습니다';
  end if;
  if not (public.is_admin() or public.teaches_class(v_class_id)) then
    raise exception '권한이 없습니다';
  end if;
  if not v_completed then
    raise exception '수료하지 않은 수강생에게는 발급할 수 없습니다';
  end if;

  -- 이미 발급했으면 그 번호를 돌려준다. 두 번 눌러도 두 장이 나오지 않는다.
  select c.certificate_no, c.issued_at into v_existing
    from certificates c where c.attendance_id = p_attendance_id;
  if found then
    return query select v_existing.certificate_no, v_existing.issued_at, true;
    return;
  end if;

  v_year := to_char(coalesce(v_when, now()), 'YYYY');
  perform pg_advisory_xact_lock(hashtext('certificate_no:' || v_year));

  select coalesce(max((regexp_match(c.certificate_no, '(\d+)$'))[1]::integer), 0) + 1
    into v_seq
    from certificates c
   where c.certificate_no like 'IGM-' || v_year || '-%';

  v_no := 'IGM-' || v_year || '-' || lpad(v_seq::text, 4, '0');

  insert into certificates (attendance_id, certificate_no)
  values (p_attendance_id, v_no);

  return query select v_no, now()::timestamptz, false;
end;
$$;

/** 클래스에서 수료한 사람 전원에게 발급한다. 이미 받은 사람은 건너뛴다. */
create or replace function public.issue_class_certificates(p_class_id uuid)
  returns table (user_id uuid, name text, certificate_no text, already boolean)
  language plpgsql security definer set search_path = public as $$
declare
  r record;
  v record;
begin
  if not (public.is_admin() or public.teaches_class(p_class_id)) then
    raise exception '권한이 없습니다';
  end if;

  for r in
    select a.id, a.user_id, p.name
      from attendance a
      join profiles p on p.id = a.user_id
     where a.class_id = p_class_id and a.is_completed
     order by p.name
  loop
    select * into v from public.issue_certificate(r.id);
    user_id        := r.user_id;
    name           := r.name;
    certificate_no := v.certificate_no;
    already        := v.already;
    return next;
  end loop;
end;
$$;

revoke all on function public.issue_certificate(uuid)        from public, anon, authenticated;
revoke all on function public.issue_class_certificates(uuid) from public, anon, authenticated;
grant execute on function public.issue_certificate(uuid)        to authenticated;
grant execute on function public.issue_class_certificates(uuid) to authenticated;
