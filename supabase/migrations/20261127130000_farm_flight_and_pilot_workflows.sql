alter table public.flight_logs
  alter column hour_meter_start drop not null,
  alter column hour_meter_end drop not null,
  alter column flight_hours drop expression;

update public.flight_logs
set flight_hours = hour_meter_end - hour_meter_start
where flight_hours is null
  and hour_meter_start is not null
  and hour_meter_end is not null;

alter table public.flight_logs
  alter column flight_hours set not null;

do $$
declare
  constraint_row record;
begin
  for constraint_row in
    select conname
    from pg_constraint
    where conrelid = 'public.flight_logs'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%hour_meter_start%'
      and pg_get_constraintdef(oid) ilike '%hour_meter_end%'
  loop
    execute format('alter table public.flight_logs drop constraint %I', constraint_row.conname);
  end loop;
end;
$$;

alter table public.flight_logs
  add constraint flight_logs_nonnegative_hours
    check (flight_hours >= 0),
  add constraint flight_logs_legacy_meter_pair
    check (
      (hour_meter_start is null and hour_meter_end is null)
      or (
        hour_meter_start is not null
        and hour_meter_end is not null
        and hour_meter_start >= 0
        and hour_meter_end >= hour_meter_start
      )
    );

create or replace function public.validate_flight_log()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.flight_hours is null or new.flight_hours < 0 then
    raise exception 'Operation hours must be zero or greater';
  end if;

  if not exists (
    select 1 from public.assets
    where id = new.drone_asset_id
      and org_id = new.org_id
      and asset_type_code = 'drone'
  ) then
    raise exception 'Flight log asset must be a drone';
  end if;

  if not exists (
    select 1 from public.operation_assets
    where operation_id = new.operation_id
      and asset_id = new.drone_asset_id
      and org_id = new.org_id
      and returned_at is not null
  ) then
    raise exception 'Operation hours can only be recorded after the drone has returned';
  end if;

  if not exists (
    select 1
    from public.operations o
    where o.id = new.operation_id
      and o.org_id = new.org_id
      and o.farm_id = new.farm_id
  ) then
    raise exception 'Flight-log farm must match its operation';
  end if;

  return new;
end;
$$;

drop function public.return_operation_asset(uuid, uuid, text, uuid, uuid, uuid, text, numeric, numeric, timestamptz);

create function public.return_operation_asset(
  p_org_id uuid,
  p_operation_asset_id uuid,
  p_return_condition text,
  p_returned_by_user_id uuid,
  p_return_received_by_user_id uuid,
  p_return_location_id uuid default null,
  p_return_notes text default null,
  p_flight_hours numeric default null,
  p_returned_at timestamptz default now()
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  returned_asset_id uuid;
  returned_operation_id uuid;
  operation_farm_id uuid;
  returned_asset_type text;
begin
  if auth.uid() is null or not public.has_org_permission(p_org_id, 'operations.manage') then
    raise exception 'Not authorized to return assets for this organization';
  end if;
  if p_returned_at is null or p_returned_at > now() then
    raise exception 'Return time cannot be in the future';
  end if;
  select oa.asset_id, oa.operation_id, o.farm_id, a.asset_type_code
  into returned_asset_id, returned_operation_id, operation_farm_id, returned_asset_type
  from public.operation_assets oa
  join public.operations o on o.id = oa.operation_id and o.org_id = oa.org_id
  join public.assets a on a.id = oa.asset_id and a.org_id = oa.org_id
  where oa.id = p_operation_asset_id
    and oa.org_id = p_org_id
    and oa.returned_at is null
  for update of oa;

  if returned_asset_id is null then
    raise exception 'Open operation asset was not found';
  end if;
  if returned_asset_type = 'drone' and (p_flight_hours is null or p_flight_hours < 0) then
    raise exception 'Nonnegative operation hours are required when returning a drone';
  end if;
  if returned_asset_type <> 'drone' and p_flight_hours is not null then
    raise exception 'Operation hours can only be recorded for drones';
  end if;

  update public.operation_assets
  set return_condition = p_return_condition,
      returned_by_user_id = p_returned_by_user_id,
      return_received_by_user_id = p_return_received_by_user_id,
      return_location_id = p_return_location_id,
      return_notes = nullif(btrim(p_return_notes), ''),
      returned_at = p_returned_at
  where id = p_operation_asset_id
    and org_id = p_org_id
    and returned_at is null
  returning asset_id into returned_asset_id;

  if returned_asset_id is null then
    raise exception 'Open operation asset was not found';
  end if;
  if returned_asset_type = 'drone' then
    insert into public.flight_logs (
      org_id, drone_asset_id, operation_id, farm_id, logged_at, flight_hours, recorded_by
    ) values (
      p_org_id, returned_asset_id, returned_operation_id, operation_farm_id,
      p_returned_at, p_flight_hours, auth.uid()
    );
  end if;
  return returned_asset_id;
end;
$$;

revoke all on function public.return_operation_asset(uuid, uuid, text, uuid, uuid, uuid, text, numeric, timestamptz) from public, anon, authenticated;
grant execute on function public.return_operation_asset(uuid, uuid, text, uuid, uuid, uuid, text, numeric, timestamptz) to authenticated;

create function public.guard_pilot_availability()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.pilot_id is null or new.returned_at is not null then
    return new;
  end if;

  perform 1
  from public.pilots
  where id = new.pilot_id
    and org_id = new.org_id
    and active
  for update;
  if not found then
    raise exception 'Selected pilot is not active in this organization';
  end if;

  if exists (
    select 1
    from public.operation_assets other
    where other.org_id = new.org_id
      and other.pilot_id = new.pilot_id
      and other.returned_at is null
      and other.id <> new.id
  ) then
    raise exception 'Pilot is already assigned to an open operation';
  end if;
  return new;
end;
$$;

create trigger guard_open_pilot_availability
  before update of pilot_id on public.operation_assets
  for each row execute function public.guard_pilot_availability();

create policy flight_logs_operations_read on public.flight_logs for select to authenticated
  using (public.has_org_permission(org_id, 'operations.read')
    or public.has_org_permission(org_id, 'operations.manage'));
