create table public.pilots (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id),
  full_name text not null check (btrim(full_name) <> ''),
  phone text,
  license_number text,
  notes text,
  active boolean not null default true,
  created_by uuid default auth.uid() references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, org_id)
);

alter table public.pilots enable row level security;
alter table public.pilots force row level security;

create policy pilots_read on public.pilots for select to authenticated
  using (public.has_org_permission(org_id, 'operations.read')
    or public.has_org_permission(org_id, 'operations.manage'));
create policy pilots_manage on public.pilots for all to authenticated
  using (public.has_org_permission(org_id, 'operations.manage'))
  with check (public.has_org_permission(org_id, 'operations.manage'));

revoke all on public.pilots from anon, authenticated;
grant select, insert, update on public.pilots to authenticated;

create trigger audit_pilots
  after insert or update or delete on public.pilots
  for each row execute function public.write_audit_event();

create function public.guard_pilot_deactivation()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if old.active and not new.active and exists (
    select 1
    from public.operation_assets oa
    join public.operations o on o.id = oa.operation_id and o.org_id = oa.org_id
    where oa.org_id = old.org_id
      and oa.pilot_id = old.id
      and oa.returned_at is null
      and o.status in ('preparing', 'in_transit', 'in_operation')
  ) then
    raise exception 'A pilot assigned to an open operation cannot be deactivated';
  end if;
  return new;
end;
$$;

create trigger guard_pilot_deactivation_changes
  before update of active on public.pilots
  for each row execute function public.guard_pilot_deactivation();

alter table public.operation_assets
  add column pilot_id uuid,
  add constraint operation_assets_pilot_fk
    foreign key (pilot_id, org_id) references public.pilots(id, org_id);

create function public.guard_operation_asset_pilot()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.pilot_id is distinct from old.pilot_id
    and current_setting('app.allow_operation_pilot_change', true) is distinct from 'on' then
    raise exception 'Drone pilot assignments must use the authorized workflow';
  end if;
  return new;
end;
$$;

create trigger guard_operation_asset_pilot_changes
  before update of pilot_id on public.operation_assets
  for each row execute function public.guard_operation_asset_pilot();

create function public.require_operation_drone_pilot_workflow()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  selected_asset_type text;
begin
  select asset_type_code into selected_asset_type
  from public.assets
  where id = new.asset_id and org_id = new.org_id;

  if selected_asset_type = 'drone'
    and current_setting('app.allow_operation_pilot_creation', true) is distinct from 'on' then
    raise exception 'Drone operation assets must be created with a pilot assignment';
  end if;
  if selected_asset_type is distinct from 'drone' and new.pilot_id is not null then
    raise exception 'Only drones can be assigned a pilot';
  end if;
  return new;
end;
$$;

create trigger require_operation_drone_pilot
  before insert on public.operation_assets
  for each row execute function public.require_operation_drone_pilot_workflow();

create function public.set_operation_drone_pilot(
  p_org_id uuid,
  p_operation_asset_id uuid,
  p_pilot_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  operation_asset public.operation_assets%rowtype;
  operation_status text;
begin
  if auth.uid() is null or not public.has_org_permission(p_org_id, 'operations.manage') then
    raise exception 'Not authorized to assign a pilot for this organization';
  end if;

  select oa.*
  into operation_asset
  from public.operation_assets oa
  join public.operations o on o.id = oa.operation_id and o.org_id = oa.org_id
  join public.assets a on a.id = oa.asset_id and a.org_id = oa.org_id
  where oa.id = p_operation_asset_id
    and oa.org_id = p_org_id
    and a.asset_type_code = 'drone'
  for update of oa;
  if not found then
    raise exception 'Drone in this operation was not found';
  end if;
  select status into operation_status
  from public.operations
  where id = operation_asset.operation_id and org_id = p_org_id;
  if operation_asset.returned_at is not null
    or operation_status not in ('preparing', 'in_transit', 'in_operation') then
    raise exception 'A pilot can only be assigned to a drone in an open operation';
  end if;
  if operation_asset.pilot_id = p_pilot_id then
    return p_operation_asset_id;
  end if;
  if not exists (
    select 1 from public.pilots
    where id = p_pilot_id and org_id = p_org_id and active
  ) then
    raise exception 'Selected pilot is not active in this organization';
  end if;

  perform set_config('app.allow_operation_pilot_change', 'on', true);
  update public.operation_assets
  set pilot_id = p_pilot_id
  where id = p_operation_asset_id and org_id = p_org_id;

  return p_operation_asset_id;
end;
$$;

create function public.create_operation_with_pilots(
  p_org_id uuid,
  p_farm_id uuid,
  p_asset_ids uuid[],
  p_operator_user_id uuid,
  p_responsible_user_id uuid,
  p_delivered_by_user_id uuid,
  p_received_by_user_id uuid,
  p_departure_condition text,
  p_municipality text default null,
  p_field_location text default null,
  p_departure_at timestamptz default now(),
  p_notes text default null,
  p_pilot_assignments jsonb default '[]'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  new_operation_id uuid;
  drone_count bigint;
  mapping_count bigint;
  distinct_drone_count bigint;
  assignment jsonb;
  selected_asset_id uuid;
  selected_pilot_id uuid;
  operation_asset_id uuid;
begin
  if auth.uid() is null or not public.has_org_permission(p_org_id, 'operations.manage') then
    raise exception 'Not authorized to create operations for this organization';
  end if;
  if p_pilot_assignments is null or jsonb_typeof(p_pilot_assignments) <> 'array' then
    raise exception 'Pilot assignments must be an array';
  end if;

  select count(*) into drone_count
  from public.assets
  where org_id = p_org_id
    and id = any(p_asset_ids)
    and asset_type_code = 'drone';
  select count(*), count(distinct value->>'asset_id')
  into mapping_count, distinct_drone_count
  from jsonb_array_elements(p_pilot_assignments) as assignments(value);
  if drone_count = 0 or mapping_count <> drone_count or distinct_drone_count <> mapping_count then
    raise exception 'Assign exactly one pilot to each drone in the operation';
  end if;

  for assignment in select value from jsonb_array_elements(p_pilot_assignments)
  loop
    if jsonb_typeof(assignment) <> 'object'
      or coalesce(jsonb_typeof(assignment->'asset_id'), '') <> 'string'
      or coalesce(jsonb_typeof(assignment->'pilot_id'), '') <> 'string' then
      raise exception 'Each pilot assignment must include a drone and a pilot';
    end if;
    selected_asset_id := (assignment->>'asset_id')::uuid;
    selected_pilot_id := (assignment->>'pilot_id')::uuid;

    if not (selected_asset_id = any(p_asset_ids))
      or not exists (
        select 1 from public.assets
        where id = selected_asset_id
          and org_id = p_org_id
          and asset_type_code = 'drone'
      ) then
      raise exception 'Pilot assignments can only target drones included in this operation';
    end if;
    if not exists (
      select 1 from public.pilots
      where id = selected_pilot_id and org_id = p_org_id and active
    ) then
      raise exception 'Selected pilot is not active in this organization';
    end if;
  end loop;

  perform set_config('app.allow_operation_pilot_creation', 'on', true);
  new_operation_id := public.create_operation_with_assets(
    p_org_id,
    p_farm_id,
    p_asset_ids,
    p_operator_user_id,
    p_responsible_user_id,
    p_delivered_by_user_id,
    p_received_by_user_id,
    p_departure_condition,
    p_municipality,
    p_field_location,
    p_departure_at,
    p_notes
  );
  perform set_config('app.allow_operation_pilot_creation', 'off', true);

  for assignment in select value from jsonb_array_elements(p_pilot_assignments)
  loop
    selected_asset_id := (assignment->>'asset_id')::uuid;
    selected_pilot_id := (assignment->>'pilot_id')::uuid;
    select id into operation_asset_id
    from public.operation_assets
    where org_id = p_org_id
      and operation_id = new_operation_id
      and asset_id = selected_asset_id;
    perform public.set_operation_drone_pilot(p_org_id, operation_asset_id, selected_pilot_id);
  end loop;

  return new_operation_id;
end;
$$;

revoke all on function public.create_operation_with_assets(uuid, uuid, uuid[], uuid, uuid, uuid, uuid, text, text, text, timestamptz, text) from public, anon, authenticated;
revoke all on function public.set_operation_drone_pilot(uuid, uuid, uuid) from public, anon;
revoke all on function public.create_operation_with_pilots(uuid, uuid, uuid[], uuid, uuid, uuid, uuid, text, text, text, timestamptz, text, jsonb) from public, anon;
grant execute on function public.set_operation_drone_pilot(uuid, uuid, uuid) to authenticated;
grant execute on function public.create_operation_with_pilots(uuid, uuid, uuid[], uuid, uuid, uuid, uuid, text, text, text, timestamptz, text, jsonb) to authenticated;
