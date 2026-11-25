create function public.start_maintenance(
  p_org_id uuid,
  p_asset_id uuid,
  p_maintenance_type text,
  p_plan_id uuid default null,
  p_performed_at timestamptz default now(),
  p_technician_user_id uuid default null,
  p_external_company text default null,
  p_external_technician text default null,
  p_diagnosis text default null,
  p_notes text default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  record_id uuid;
  asset_type text;
  asset_status text;
  asset_active boolean;
begin
  if auth.uid() is null or not public.has_org_permission(p_org_id, 'maintenance.manage') then
    raise exception 'Not authorized to create maintenance records for this organization';
  end if;
  if p_performed_at is null or p_performed_at > now() then
    raise exception 'Maintenance date cannot be in the future';
  end if;
  if coalesce(nullif(btrim(p_external_company), ''), nullif(btrim(p_external_technician), '')) is null
    and p_technician_user_id is null then
    raise exception 'Select an internal technician or provide external maintenance details';
  end if;

  select asset_type_code, status, active
  into asset_type, asset_status, asset_active
  from public.assets
  where id = p_asset_id and org_id = p_org_id
  for update;

  if asset_type is null or not asset_active then
    raise exception 'Active asset was not found';
  end if;
  if asset_status in ('in_transit', 'in_operation', 'maintenance') then
    raise exception 'Asset is not available to start another maintenance record';
  end if;
  if exists (
    select 1 from public.operation_assets
    where asset_id = p_asset_id and org_id = p_org_id and returned_at is null
  ) then
    raise exception 'Asset assigned to an open operation cannot enter maintenance';
  end if;
  if not exists (
    select 1 from public.maintenance_types
    where org_id = p_org_id and code = p_maintenance_type and active
  ) then
    raise exception 'Select an active maintenance type';
  end if;
  if p_plan_id is not null and not exists (
    select 1 from public.maintenance_plans
    where id = p_plan_id
      and org_id = p_org_id
      and asset_type_code = asset_type
      and active
  ) then
    raise exception 'Maintenance plan does not match the selected asset';
  end if;

  update public.assets
  set status = 'maintenance', updated_at = now()
  where id = p_asset_id and org_id = p_org_id;

  insert into public.maintenance_records (
    org_id, asset_id, plan_id, maintenance_type, status, performed_at,
    technician_user_id, external_company, external_technician, diagnosis,
    notes, created_by
  ) values (
    p_org_id, p_asset_id, p_plan_id, p_maintenance_type, 'open', p_performed_at,
    p_technician_user_id, nullif(btrim(p_external_company), ''),
    nullif(btrim(p_external_technician), ''), nullif(btrim(p_diagnosis), ''),
    nullif(btrim(p_notes), ''), auth.uid()
  )
  returning id into record_id;

  return record_id;
end;
$$;

create function public.complete_maintenance(
  p_org_id uuid,
  p_maintenance_record_id uuid,
  p_activities text,
  p_outcome text,
  p_release_asset_status text,
  p_cost numeric default null,
  p_completed_at timestamptz default now(),
  p_next_intervention_at date default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  target_asset_id uuid;
  record_status text;
begin
  if auth.uid() is null or not public.has_org_permission(p_org_id, 'maintenance.manage') then
    raise exception 'Not authorized to complete maintenance records for this organization';
  end if;
  if nullif(btrim(p_activities), '') is null or nullif(btrim(p_outcome), '') is null then
    raise exception 'Activities and outcome are required to complete maintenance';
  end if;
  if p_cost is not null and p_cost < 0 then
    raise exception 'Maintenance cost cannot be negative';
  end if;
  if p_completed_at is null or p_completed_at > now() then
    raise exception 'Completion time cannot be in the future';
  end if;
  if p_release_asset_status not in ('available', 'inspection', 'damaged', 'repair', 'out_of_service') then
    raise exception 'Select a valid post-maintenance asset status';
  end if;
  if not exists (
    select 1 from public.asset_statuses
    where org_id = p_org_id and code = p_release_asset_status and active
  ) then
    raise exception 'The selected asset status is not active';
  end if;

  select asset_id, status into target_asset_id, record_status
  from public.maintenance_records
  where id = p_maintenance_record_id and org_id = p_org_id
  for update;

  if target_asset_id is null or record_status not in ('open', 'in_progress') then
    raise exception 'Open maintenance record was not found';
  end if;

  perform 1 from public.assets
  where id = target_asset_id and org_id = p_org_id
  for update;

  update public.maintenance_records
  set status = 'completed',
      completed_at = p_completed_at,
      activities = btrim(p_activities),
      outcome = btrim(p_outcome),
      cost = p_cost,
      next_intervention_at = p_next_intervention_at
  where id = p_maintenance_record_id and org_id = p_org_id;

  update public.assets
  set status = p_release_asset_status, updated_at = now()
  where id = target_asset_id and org_id = p_org_id;

  return p_maintenance_record_id;
end;
$$;

create function public.guard_maintenance_history()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if old.status in ('completed', 'cancelled') then
    raise exception 'Closed maintenance records cannot be changed';
  end if;
  if new.org_id is distinct from old.org_id
    or new.asset_id is distinct from old.asset_id
    or new.plan_id is distinct from old.plan_id
    or new.maintenance_type is distinct from old.maintenance_type
    or new.performed_at is distinct from old.performed_at
    or new.technician_user_id is distinct from old.technician_user_id
    or new.external_company is distinct from old.external_company
    or new.external_technician is distinct from old.external_technician
    or new.diagnosis is distinct from old.diagnosis
    or new.created_by is distinct from old.created_by
    or new.created_at is distinct from old.created_at then
    raise exception 'Maintenance identity and diagnosis cannot be rewritten';
  end if;
  if new.status not in ('in_progress', 'completed', 'cancelled') then
    raise exception 'Invalid maintenance status transition';
  end if;
  if new.status = 'completed'
    and (new.completed_at is null or new.activities is null or new.outcome is null) then
    raise exception 'Completed maintenance requires time, activities, and outcome';
  end if;
  return new;
end;
$$;

create trigger guard_maintenance_history_changes
  before update on public.maintenance_records
  for each row execute function public.guard_maintenance_history();

alter table public.maintenance_plans
  add constraint maintenance_plans_require_interval
  check (interval_flight_hours is not null or interval_days is not null);

create function public.guard_asset_maintenance_status()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if exists (
    select 1 from public.maintenance_records
    where asset_id = old.id
      and org_id = old.org_id
      and status in ('open', 'in_progress')
  ) and (
    new.status is distinct from 'maintenance'
    or (old.active and not new.active)
  ) then
    raise exception 'An asset with open maintenance cannot be released or deactivated';
  end if;
  return new;
end;
$$;

create trigger guard_asset_open_maintenance
  before update on public.assets
  for each row execute function public.guard_asset_maintenance_status();

revoke insert, update, delete on public.maintenance_records from anon, authenticated;
grant select on public.maintenance_records to authenticated;

revoke all on function public.start_maintenance(uuid, uuid, text, uuid, timestamptz, uuid, text, text, text, text) from public, anon;
grant execute on function public.start_maintenance(uuid, uuid, text, uuid, timestamptz, uuid, text, text, text, text) to authenticated;
revoke all on function public.complete_maintenance(uuid, uuid, text, text, text, numeric, timestamptz, date) from public, anon;
grant execute on function public.complete_maintenance(uuid, uuid, text, text, text, numeric, timestamptz, date) to authenticated;
