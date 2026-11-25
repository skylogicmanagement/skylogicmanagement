create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.roles (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id),
  code text not null,
  name text not null,
  unique (org_id, code),
  unique (id, org_id)
);

create table public.permissions (
  code text primary key,
  description text not null
);

create table public.role_permissions (
  org_id uuid not null references public.organizations(id),
  role_id uuid not null,
  permission_code text not null references public.permissions(code),
  primary key (role_id, permission_code),
  foreign key (role_id, org_id) references public.roles(id, org_id)
);

create table public.memberships (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id),
  user_id uuid not null references auth.users(id),
  role_id uuid not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (org_id, user_id),
  foreign key (role_id, org_id) references public.roles(id, org_id)
);

create table public.user_profiles (
  org_id uuid not null references public.organizations(id),
  user_id uuid not null references auth.users(id),
  display_name text not null check (btrim(display_name) <> ''),
  phone text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (org_id, user_id),
  foreign key (org_id, user_id) references public.memberships(org_id, user_id)
);

create table public.asset_types (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id),
  code text not null,
  name text not null,
  active boolean not null default true,
  unique (org_id, code),
  unique (id, org_id)
);

create table public.asset_statuses (
  org_id uuid not null references public.organizations(id),
  code text not null,
  name text not null,
  active boolean not null default true,
  primary key (org_id, code)
);

create table public.operation_statuses (
  org_id uuid not null references public.organizations(id),
  code text not null,
  name text not null,
  active boolean not null default true,
  primary key (org_id, code)
);

create table public.maintenance_types (
  org_id uuid not null references public.organizations(id),
  code text not null,
  name text not null,
  active boolean not null default true,
  primary key (org_id, code)
);

create table public.locations (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id),
  name text not null,
  location_type text not null default 'other',
  address text,
  municipality text,
  department text,
  latitude numeric(10, 7),
  longitude numeric(10, 7),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (id, org_id)
);

create table public.suppliers (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id),
  name text not null,
  contact_name text,
  email text,
  phone text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (id, org_id)
);

create table public.farms (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id),
  name text not null,
  owner_or_customer text,
  municipality text,
  department text,
  address text,
  latitude numeric(10, 7),
  longitude numeric(10, 7),
  contact_name text,
  phone text,
  notes text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (id, org_id)
);

create table public.assets (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id),
  asset_type_code text not null,
  internal_code text not null,
  name text not null,
  brand text,
  model text,
  serial_number text,
  acquired_at date,
  supplier_id uuid,
  purchase_document_path text,
  acquisition_value numeric(14, 2),
  status text not null default 'unverified',
  location_id uuid,
  responsible_user_id uuid references auth.users(id),
  notes text,
  active boolean not null default true,
  created_by uuid default auth.uid() references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, internal_code),
  foreign key (org_id, asset_type_code) references public.asset_types(org_id, code),
  foreign key (org_id, status) references public.asset_statuses(org_id, code),
  foreign key (supplier_id, org_id) references public.suppliers(id, org_id),
  foreign key (location_id, org_id) references public.locations(id, org_id),
  unique (id, org_id)
);

create unique index assets_unique_serial_per_org
  on public.assets (org_id, lower(btrim(serial_number)))
  where serial_number is not null and btrim(serial_number) <> '';

create table public.drone_details (
  asset_id uuid primary key,
  org_id uuid not null references public.organizations(id),
  total_flight_hours numeric(12, 2) check (total_flight_hours is null or total_flight_hours >= 0),
  hours_since_maintenance numeric(12, 2) check (hours_since_maintenance is null or hours_since_maintenance >= 0),
  last_maintenance_at date,
  next_maintenance_hours numeric(12, 2),
  foreign key (asset_id, org_id) references public.assets(id, org_id)
);

create table public.battery_details (
  asset_id uuid primary key,
  org_id uuid not null references public.organizations(id),
  charge_cycles integer check (charge_cycles is null or charge_cycles >= 0),
  technical_notes text,
  foreign key (asset_id, org_id) references public.assets(id, org_id)
);

create table public.asset_assignments (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id),
  asset_id uuid not null,
  assigned_asset_id uuid,
  assigned_user_id uuid references auth.users(id),
  operation_id uuid,
  assignment_type text not null check (assignment_type in ('asset', 'user', 'operation')),
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  reason text,
  created_by uuid default auth.uid() references auth.users(id),
  created_at timestamptz not null default now(),
  check ((assignment_type = 'asset' and assigned_asset_id is not null and assigned_user_id is null and operation_id is null)
      or (assignment_type = 'user' and assigned_user_id is not null and assigned_asset_id is null and operation_id is null)
      or (assignment_type = 'operation' and operation_id is not null and assigned_asset_id is null and assigned_user_id is null)),
  foreign key (asset_id, org_id) references public.assets(id, org_id),
  foreign key (assigned_asset_id, org_id) references public.assets(id, org_id),
  unique (id, org_id)
);

create unique index one_current_asset_parent_assignment
  on public.asset_assignments (org_id, asset_id)
  where assignment_type = 'asset' and ended_at is null;

create unique index one_current_user_assignment
  on public.asset_assignments (org_id, asset_id)
  where assignment_type = 'user' and ended_at is null;

create table public.operations (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id),
  operation_number bigint generated by default as identity,
  farm_id uuid not null,
  municipality text,
  field_location text,
  status text not null default 'preparing',
  operator_user_id uuid references auth.users(id),
  responsible_user_id uuid references auth.users(id),
  delivered_by_user_id uuid references auth.users(id),
  received_by_user_id uuid references auth.users(id),
  departure_at timestamptz,
  returned_at timestamptz,
  notes text,
  created_by uuid not null default auth.uid() references auth.users(id),
  created_at timestamptz not null default now(),
  unique (org_id, operation_number),
  foreign key (farm_id, org_id) references public.farms(id, org_id),
  foreign key (org_id, status) references public.operation_statuses(org_id, code),
  unique (id, org_id)
);

alter table public.asset_assignments
  add constraint asset_assignments_operation_fk
  foreign key (operation_id, org_id) references public.operations(id, org_id);

create table public.operation_assets (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id),
  operation_id uuid not null,
  asset_id uuid not null,
  delivered_by_user_id uuid references auth.users(id),
  received_by_user_id uuid references auth.users(id),
  returned_by_user_id uuid references auth.users(id),
  return_received_by_user_id uuid references auth.users(id),
  departure_condition text,
  return_condition text check (return_condition in ('good', 'damaged', 'missing', 'needs_inspection')),
  departure_at timestamptz not null default now(),
  returned_at timestamptz,
  return_location_id uuid,
  return_notes text,
  created_by uuid not null default auth.uid() references auth.users(id),
  created_at timestamptz not null default now(),
  foreign key (operation_id, org_id) references public.operations(id, org_id),
  foreign key (asset_id, org_id) references public.assets(id, org_id),
  foreign key (return_location_id, org_id) references public.locations(id, org_id),
  unique (operation_id, asset_id),
  unique (id, org_id)
);

create unique index one_open_operation_per_asset
  on public.operation_assets (org_id, asset_id)
  where returned_at is null;

create table public.flight_logs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id),
  drone_asset_id uuid not null,
  operation_id uuid not null,
  farm_id uuid not null,
  logged_at timestamptz not null default now(),
  hour_meter_start numeric(12, 2) not null,
  hour_meter_end numeric(12, 2) not null,
  flight_hours numeric(12, 2) generated always as (hour_meter_end - hour_meter_start) stored,
  recorded_by uuid not null default auth.uid() references auth.users(id),
  notes text,
  check (hour_meter_start >= 0 and hour_meter_end >= hour_meter_start),
  foreign key (drone_asset_id, org_id) references public.assets(id, org_id),
  foreign key (operation_id, org_id) references public.operations(id, org_id),
  foreign key (farm_id, org_id) references public.farms(id, org_id),
  unique (operation_id, drone_asset_id)
);

create table public.maintenance_plans (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id),
  asset_type_code text not null,
  name text not null,
  interval_flight_hours numeric(10, 2) check (interval_flight_hours > 0),
  interval_days integer check (interval_days > 0),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  foreign key (org_id, asset_type_code) references public.asset_types(org_id, code),
  unique (id, org_id)
);

create table public.maintenance_records (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id),
  asset_id uuid not null,
  plan_id uuid,
  maintenance_type text not null,
  status text not null default 'open' check (status in ('open', 'in_progress', 'completed', 'cancelled')),
  performed_at timestamptz not null default now(),
  completed_at timestamptz,
  technician_user_id uuid references auth.users(id),
  external_company text,
  external_technician text,
  diagnosis text,
  activities text,
  outcome text,
  cost numeric(14, 2) check (cost is null or cost >= 0),
  next_intervention_at date,
  notes text,
  created_by uuid not null default auth.uid() references auth.users(id),
  created_at timestamptz not null default now(),
  foreign key (asset_id, org_id) references public.assets(id, org_id),
  foreign key (org_id, maintenance_type) references public.maintenance_types(org_id, code),
  foreign key (plan_id, org_id) references public.maintenance_plans(id, org_id),
  unique (id, org_id)
);

create table public.inventory_items (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id),
  internal_code text not null,
  name text not null,
  category text not null,
  manufacturer_reference text,
  unit text not null,
  quantity_on_hand numeric(14, 3) not null default 0 check (quantity_on_hand >= 0),
  location_id uuid,
  supplier_id uuid,
  unit_value numeric(14, 2) check (unit_value is null or unit_value >= 0),
  active boolean not null default true,
  notes text,
  created_by uuid not null default auth.uid() references auth.users(id),
  created_at timestamptz not null default now(),
  unique (org_id, internal_code),
  foreign key (location_id, org_id) references public.locations(id, org_id),
  foreign key (supplier_id, org_id) references public.suppliers(id, org_id),
  unique (id, org_id)
);

create table public.inventory_movements (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id),
  item_id uuid not null,
  movement_type text not null check (movement_type in ('purchase', 'installation', 'consumption', 'transfer', 'return', 'repair_sent', 'repair_return', 'write_off', 'correction')),
  quantity_delta numeric(14, 3) not null check (quantity_delta <> 0),
  maintenance_record_id uuid,
  asset_id uuid,
  related_movement_id uuid,
  reason text,
  created_by uuid not null default auth.uid() references auth.users(id),
  created_at timestamptz not null default now(),
  foreign key (item_id, org_id) references public.inventory_items(id, org_id),
  foreign key (maintenance_record_id, org_id) references public.maintenance_records(id, org_id),
  foreign key (asset_id, org_id) references public.assets(id, org_id),
  foreign key (related_movement_id, org_id) references public.inventory_movements(id, org_id),
  unique (id, org_id)
);

create table public.documents (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id),
  asset_id uuid,
  operation_id uuid,
  maintenance_record_id uuid,
  storage_path text not null,
  file_name text not null,
  content_type text,
  uploaded_by uuid not null default auth.uid() references auth.users(id),
  uploaded_at timestamptz not null default now(),
  check (num_nonnulls(asset_id, operation_id, maintenance_record_id) = 1),
  foreign key (asset_id, org_id) references public.assets(id, org_id),
  foreign key (operation_id, org_id) references public.operations(id, org_id),
  foreign key (maintenance_record_id, org_id) references public.maintenance_records(id, org_id),
  unique (storage_path)
);

create table public.audit_events (
  id bigint generated always as identity primary key,
  org_id uuid not null references public.organizations(id),
  occurred_at timestamptz not null default now(),
  actor_user_id uuid references auth.users(id),
  event_type text not null,
  entity_table text not null,
  entity_id uuid,
  before_state jsonb,
  after_state jsonb,
  correction_of bigint references public.audit_events(id),
  correction_reason text,
  transaction_id bigint not null default txid_current(),
  previous_hash text,
  event_hash text not null
);

create table public.audit_chain_heads (
  org_id uuid primary key references public.organizations(id),
  last_event_id bigint not null,
  last_hash text not null,
  updated_at timestamptz not null default now()
);

create index audit_events_org_date_idx on public.audit_events (org_id, occurred_at desc);
create index audit_events_entity_idx on public.audit_events (org_id, entity_table, entity_id, occurred_at desc);
create index operations_open_idx on public.operations (org_id, status) where status <> 'completed';
create index assets_status_idx on public.assets (org_id, status) where active;
create index flight_logs_drone_date_idx on public.flight_logs (org_id, drone_asset_id, logged_at desc);

insert into public.permissions (code, description) values
  ('assets.read', 'Consultar activos'),
  ('assets.manage', 'Crear y actualizar activos'),
  ('operations.read', 'Consultar operaciones'),
  ('operations.manage', 'Crear y gestionar operaciones'),
  ('maintenance.read', 'Consultar mantenimientos'),
  ('maintenance.manage', 'Registrar mantenimientos'),
  ('inventory.read', 'Consultar inventario'),
  ('inventory.manage', 'Gestionar inventario'),
  ('audit.read', 'Consultar auditoría'),
  ('users.manage', 'Gestionar usuarios'),
  ('catalogs.manage', 'Gestionar catálogos'),
  ('reports.read', 'Consultar reportes')
on conflict (code) do nothing;

alter table public.permissions enable row level security;
alter table public.permissions force row level security;

create function public.user_org_ids()
returns setof uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select org_id from public.memberships
  where user_id = auth.uid() and active
$$;

create function public.has_org_permission(target_org uuid, permission text)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.memberships m
    join public.role_permissions rp on rp.role_id = m.role_id and rp.org_id = m.org_id
    where m.user_id = auth.uid()
      and m.org_id = target_org
      and m.active
      and rp.permission_code = permission
  )
$$;

create function public.write_audit_event()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  row_data jsonb;
  old_data jsonb;
  new_data jsonb;
  organization_id uuid;
  entity_uuid uuid;
begin
  if tg_op = 'DELETE' then
    row_data := to_jsonb(old);
    old_data := row_data;
  elsif tg_op = 'UPDATE' then
    old_data := to_jsonb(old);
    new_data := to_jsonb(new);
    row_data := new_data;
  else
    new_data := to_jsonb(new);
    row_data := new_data;
  end if;

  organization_id := (row_data ->> 'org_id')::uuid;
  if organization_id is null then
    if tg_op = 'DELETE' then
      return old;
    end if;
    return new;
  end if;

  begin
    entity_uuid := (row_data ->> 'id')::uuid;
  exception when invalid_text_representation then
    entity_uuid := null;
  end;

  insert into public.audit_events (
    org_id, actor_user_id, event_type, entity_table, entity_id, before_state, after_state
  ) values (
    organization_id,
    auth.uid(),
    lower(tg_op),
    tg_table_name,
    entity_uuid,
    old_data,
    new_data
  );
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

create function public.create_asset_details()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.asset_type_code = 'drone' then
    insert into public.drone_details (asset_id, org_id) values (new.id, new.org_id)
    on conflict (asset_id) do nothing;
  elsif new.asset_type_code = 'battery' then
    insert into public.battery_details (asset_id, org_id) values (new.id, new.org_id)
    on conflict (asset_id) do nothing;
  end if;
  return new;
end;
$$;

create function public.validate_org_users()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  row_data jsonb := to_jsonb(new);
  user_field text;
  referenced_user_id uuid;
begin
  foreach user_field in array array[
    'user_id', 'created_by', 'responsible_user_id', 'assigned_user_id', 'operator_user_id',
    'delivered_by_user_id', 'received_by_user_id', 'returned_by_user_id',
    'return_received_by_user_id', 'recorded_by', 'technician_user_id', 'uploaded_by'
  ] loop
    if row_data ->> user_field is not null then
      referenced_user_id := (row_data ->> user_field)::uuid;
      if not exists (
        select 1 from public.memberships m
        where m.org_id = new.org_id and m.user_id = referenced_user_id and m.active
      ) then
        raise exception 'User % is not an active member of this organization', referenced_user_id;
      end if;
    end if;
  end loop;
  return new;
end;
$$;

create function public.reject_audit_mutation()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  raise exception 'Audit events are append-only';
end;
$$;

create function public.seal_audit_event()
returns trigger
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  prior_hash text;
  hash_payload jsonb;
begin
  perform pg_advisory_xact_lock(hashtextextended(new.org_id::text, 0));
  insert into public.audit_chain_heads (org_id, last_event_id, last_hash)
  values (new.org_id, 0, '')
  on conflict (org_id) do nothing;

  select last_hash into prior_hash
  from public.audit_chain_heads
  where org_id = new.org_id
  for update;

  new.previous_hash := nullif(prior_hash, '');
  hash_payload := jsonb_build_array(
    new.id, new.org_id, new.occurred_at, new.actor_user_id, new.event_type,
    new.entity_table, new.entity_id, new.before_state, new.after_state,
    new.correction_of, new.correction_reason, new.transaction_id, new.previous_hash
  );
  new.event_hash := encode(digest(convert_to(hash_payload::text, 'UTF8'), 'sha256'), 'hex');

  update public.audit_chain_heads
  set last_event_id = new.id, last_hash = new.event_hash, updated_at = now()
  where org_id = new.org_id;
  return new;
end;
$$;

create function public.verify_audit_chain(target_org uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  event_row record;
  expected_previous text;
  calculated_hash text;
  chain_head text;
  hash_payload jsonb;
begin
  if not public.has_org_permission(target_org, 'audit.read') then
    raise exception 'Not authorized to verify this audit chain';
  end if;

  for event_row in
    select * from public.audit_events
    where org_id = target_org
    order by id
  loop
    if event_row.previous_hash is distinct from expected_previous then
      return false;
    end if;
    hash_payload := jsonb_build_array(
      event_row.id, event_row.org_id, event_row.occurred_at, event_row.actor_user_id,
      event_row.event_type, event_row.entity_table, event_row.entity_id,
      event_row.before_state, event_row.after_state, event_row.correction_of,
      event_row.correction_reason, event_row.transaction_id, event_row.previous_hash
    );
    calculated_hash := encode(digest(convert_to(hash_payload::text, 'UTF8'), 'sha256'), 'hex');
    if event_row.event_hash is distinct from calculated_hash then
      return false;
    end if;
    expected_previous := calculated_hash;
  end loop;

  select last_hash into chain_head
  from public.audit_chain_heads
  where org_id = target_org;
  return chain_head is not distinct from expected_previous;
end;
$$;

create function public.guard_operation_asset()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  current_status text;
  is_active boolean;
  operation_status text;
begin
  if tg_op = 'INSERT' then
    if new.delivered_by_user_id is null or new.received_by_user_id is null then
      raise exception 'Departure requires both the delivering and receiving users';
    end if;
    if new.departure_condition is null or btrim(new.departure_condition) = '' then
      raise exception 'Departure condition is required for every asset';
    end if;

    select status, active into current_status, is_active
    from public.assets
    where id = new.asset_id and org_id = new.org_id
    for update;

    if current_status is null or not is_active or current_status not in ('available', 'preparing') then
      raise exception 'Asset is not available for an operation';
    end if;

    select status into operation_status
    from public.operations
    where id = new.operation_id and org_id = new.org_id
    for update;
    if operation_status is null or operation_status not in ('preparing', 'in_transit', 'in_operation') then
      raise exception 'Assets can only be added to an open operation';
    end if;

    update public.assets set status = 'in_operation', updated_at = now()
    where id = new.asset_id and org_id = new.org_id;
    update public.operations
    set status = 'in_operation', departure_at = coalesce(departure_at, new.departure_at)
    where id = new.operation_id and org_id = new.org_id;
    return new;
  end if;

  if new.operation_id is distinct from old.operation_id
    or new.asset_id is distinct from old.asset_id
    or new.departure_at is distinct from old.departure_at
    or new.departure_condition is distinct from old.departure_condition
    or new.delivered_by_user_id is distinct from old.delivered_by_user_id
    or new.received_by_user_id is distinct from old.received_by_user_id then
    raise exception 'Confirmed departure details cannot be changed';
  end if;

  if old.returned_at is not null then
    raise exception 'Confirmed returns cannot be changed';
  end if;

  if old.returned_at is null and new.returned_at is not null then
    if new.return_condition is null
      or new.returned_by_user_id is null
      or new.return_received_by_user_id is null then
      raise exception 'Return requires both the delivering and receiving users';
    end if;

    update public.assets
    set status = case
        when new.return_condition = 'damaged' then 'damaged'
        when new.return_condition = 'missing' then 'out_of_service'
        when new.return_condition = 'needs_inspection' then 'inspection'
        else 'available'
      end,
      location_id = case
        when new.return_condition = 'missing' then null
        else coalesce(new.return_location_id, location_id)
      end,
      updated_at = now()
    where id = new.asset_id and org_id = new.org_id;

    if not exists (
      select 1 from public.operation_assets
      where operation_id = new.operation_id
        and org_id = new.org_id
        and id <> new.id
        and returned_at is null
    ) then
      update public.operations
      set status = 'completed', returned_at = coalesce(returned_at, new.returned_at)
      where id = new.operation_id and org_id = new.org_id;
    end if;
  end if;
  return new;
end;
$$;

create function public.guard_asset_status()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if old.status is distinct from new.status and pg_trigger_depth() < 2 then
    if old.status in ('in_transit', 'in_operation') or new.status in ('in_transit', 'in_operation') then
      raise exception 'Operation status changes must be recorded through operation assets';
    end if;
    if new.status = 'available' and exists (
      select 1 from public.operation_assets
      where asset_id = new.id and org_id = new.org_id and returned_at is null
    ) then
      raise exception 'An asset assigned to an open operation cannot be made available';
    end if;
  end if;

  if old.active and not new.active and exists (
    select 1 from public.operation_assets
    where asset_id = new.id and org_id = new.org_id and returned_at is null
  ) then
    raise exception 'An asset in an open operation cannot be deactivated';
  end if;
  return new;
end;
$$;

create function public.guard_drone_hours()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'INSERT' then
    if pg_trigger_depth() < 2
      and (new.total_flight_hours is not null or new.hours_since_maintenance is not null) then
      raise exception 'Flight-hour totals are derived from validated flight logs';
    end if;
    return new;
  end if;

  if pg_trigger_depth() < 2 and (
    new.total_flight_hours is distinct from old.total_flight_hours
    or new.hours_since_maintenance is distinct from old.hours_since_maintenance
  ) then
    raise exception 'Flight-hour totals are derived from validated flight logs';
  end if;
  return new;
end;
$$;

create function public.guard_assignment_history()
returns trigger
language plpgsql
as $$
begin
  if old.ended_at is not null then
    raise exception 'Closed asset assignments are immutable';
  end if;
  if new.org_id is distinct from old.org_id
    or new.asset_id is distinct from old.asset_id
    or new.assigned_asset_id is distinct from old.assigned_asset_id
    or new.assigned_user_id is distinct from old.assigned_user_id
    or new.operation_id is distinct from old.operation_id
    or new.assignment_type is distinct from old.assignment_type
    or new.started_at is distinct from old.started_at then
    raise exception 'Assignment history cannot be rewritten';
  end if;
  if new.ended_at is null then
    raise exception 'An assignment update must close the current assignment';
  end if;
  new.ended_at := greatest(now(), old.started_at);
  return new;
end;
$$;

create function public.guard_operation_completion()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if old.status in ('completed', 'cancelled') and new.status is distinct from old.status then
    raise exception 'Closed operations cannot be reopened or reclassified';
  end if;
  if old.status in ('completed', 'cancelled') and (
    new.org_id is distinct from old.org_id
    or new.farm_id is distinct from old.farm_id
    or new.municipality is distinct from old.municipality
    or new.field_location is distinct from old.field_location
    or new.operator_user_id is distinct from old.operator_user_id
    or new.responsible_user_id is distinct from old.responsible_user_id
    or new.delivered_by_user_id is distinct from old.delivered_by_user_id
    or new.received_by_user_id is distinct from old.received_by_user_id
    or new.departure_at is distinct from old.departure_at
    or new.returned_at is distinct from old.returned_at
    or new.notes is distinct from old.notes
  ) then
    raise exception 'Closed operation records are immutable';
  end if;
  if new.status is distinct from old.status and pg_trigger_depth() < 2 then
    if new.status not in ('preparing', 'cancelled') or old.status <> 'preparing' then
      raise exception 'Operation status is controlled by its asset movements';
    end if;
    if new.status = 'cancelled' and exists (
      select 1 from public.operation_assets
      where operation_id = old.id and org_id = old.org_id and returned_at is null
    ) then
      raise exception 'An operation with assets in the field cannot be cancelled';
    end if;
  end if;
  if old.returned_at is not null and new.returned_at is distinct from old.returned_at then
    raise exception 'Operation return time cannot be changed';
  end if;
  if new.returned_at is distinct from old.returned_at and pg_trigger_depth() < 2 then
    raise exception 'Operation return time is derived from received assets';
  end if;
  if new.status = 'completed' and old.status <> 'completed' and pg_trigger_depth() < 2 then
    if exists (
      select 1 from public.operation_assets
      where operation_id = old.id and org_id = old.org_id and returned_at is null
    ) or not exists (
      select 1 from public.operation_assets
      where operation_id = old.id and org_id = old.org_id
    ) then
      raise exception 'An operation can only close after all assets are received';
    end if;
  end if;
  return new;
end;
$$;

create function public.guard_inventory_quantity()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'INSERT' then
    if new.quantity_on_hand <> 0 then
      raise exception 'Initial inventory must be entered as a stock movement';
    end if;
    return new;
  end if;
  if new.quantity_on_hand is distinct from old.quantity_on_hand and pg_trigger_depth() < 2 then
    raise exception 'Inventory quantities must be changed through inventory movements';
  end if;
  return new;
end;
$$;

create function public.apply_inventory_movement()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  available_quantity numeric(14, 3);
begin
  if new.movement_type in ('purchase', 'return', 'repair_return')
    and new.quantity_delta <= 0 then
    raise exception 'This inventory movement must add stock';
  end if;
  if new.movement_type in ('installation', 'consumption', 'repair_sent', 'write_off')
    and new.quantity_delta >= 0 then
    raise exception 'This inventory movement must reduce stock';
  end if;

  select quantity_on_hand into available_quantity
  from public.inventory_items
  where id = new.item_id and org_id = new.org_id
  for update;

  if available_quantity is null then
    raise exception 'Inventory item not found';
  end if;
  if available_quantity + new.quantity_delta < 0 then
    raise exception 'Inventory movement exceeds available quantity';
  end if;

  update public.inventory_items
  set quantity_on_hand = available_quantity + new.quantity_delta
  where id = new.item_id and org_id = new.org_id;
  return new;
end;
$$;

create function public.reject_business_delete()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  raise exception 'Historical records cannot be deleted; deactivate or record a correction instead';
end;
$$;

create function public.reject_flight_log_mutation()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  raise exception 'Confirmed flight-hour records cannot be changed or deleted';
end;
$$;

create function public.validate_flight_log()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  previous_hour_meter numeric(12, 2);
begin
  perform pg_advisory_xact_lock(hashtextextended(new.drone_asset_id::text, 1));

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
    raise exception 'Flight hours can only be recorded after the drone has returned';
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

  select max(hour_meter_end) into previous_hour_meter
  from public.flight_logs
  where drone_asset_id = new.drone_asset_id and org_id = new.org_id;

  if previous_hour_meter is not null and new.hour_meter_start < previous_hour_meter then
    raise exception 'Hour-meter readings cannot move backwards';
  end if;
  return new;
end;
$$;

create function public.sync_drone_flight_hours()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not exists (
    select 1 from public.assets
    where id = new.drone_asset_id
      and org_id = new.org_id
      and asset_type_code = 'drone'
  ) then
    raise exception 'Flight log asset must be a drone';
  end if;

  insert into public.drone_details (asset_id, org_id, total_flight_hours, hours_since_maintenance)
  values (new.drone_asset_id, new.org_id, new.flight_hours, new.flight_hours)
  on conflict (asset_id) do update
  set total_flight_hours = coalesce(public.drone_details.total_flight_hours, 0) + excluded.total_flight_hours,
      hours_since_maintenance = coalesce(public.drone_details.hours_since_maintenance, 0) + excluded.hours_since_maintenance;
  return new;
end;
$$;

create function public.sync_drone_maintenance()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.status = 'completed'
    and (tg_op = 'INSERT' or old.status is distinct from 'completed') then
    update public.drone_details
    set hours_since_maintenance = 0,
        last_maintenance_at = coalesce(new.completed_at, new.performed_at)::date
    where asset_id = new.asset_id
      and org_id = new.org_id
      and exists (
        select 1 from public.assets
        where id = new.asset_id and org_id = new.org_id and asset_type_code = 'drone'
      );
  end if;
  return new;
end;
$$;

create function public.create_operation_with_assets(
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
  p_notes text default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  new_operation_id uuid;
  requested_count bigint;
  distinct_count bigint;
  sorted_asset_ids uuid[];
  selected_asset_id uuid;
begin
  if auth.uid() is null or not public.has_org_permission(p_org_id, 'operations.manage') then
    raise exception 'Not authorized to create operations for this organization';
  end if;
  if p_asset_ids is null or cardinality(p_asset_ids) = 0 then
    raise exception 'An operation must include at least one asset';
  end if;
  if p_operator_user_id is null or p_responsible_user_id is null
    or p_delivered_by_user_id is null or p_received_by_user_id is null then
    raise exception 'Operator, responsible person, delivering person, and receiving person are required';
  end if;
  if p_departure_condition is null or btrim(p_departure_condition) = '' then
    raise exception 'Departure condition is required';
  end if;
  if p_departure_at is null or p_departure_at > now() then
    raise exception 'Departure time cannot be in the future';
  end if;

  select count(*), count(distinct selected.asset_id)
  into requested_count, distinct_count
  from unnest(p_asset_ids) as selected(asset_id);
  if requested_count <> distinct_count then
    raise exception 'An asset can only be included once in an operation';
  end if;
  if not exists (
    select 1 from public.assets
    where org_id = p_org_id
      and id = any(p_asset_ids)
      and asset_type_code = 'drone'
  ) then
    raise exception 'An operation must include at least one drone';
  end if;
  if not exists (
    select 1 from public.farms
    where org_id = p_org_id and id = p_farm_id and active
  ) then
    raise exception 'Select an active farm';
  end if;
  select array_agg(selected.asset_id order by selected.asset_id)
  into sorted_asset_ids
  from unnest(p_asset_ids) as selected(asset_id);

  insert into public.operations (
    org_id, farm_id, status, operator_user_id, responsible_user_id,
    delivered_by_user_id, received_by_user_id, departure_at,
    municipality, field_location, notes, created_by
  ) values (
    p_org_id, p_farm_id, 'preparing', p_operator_user_id, p_responsible_user_id,
    p_delivered_by_user_id, p_received_by_user_id, p_departure_at,
    nullif(btrim(p_municipality), ''), nullif(btrim(p_field_location), ''),
    nullif(btrim(p_notes), ''), auth.uid()
  )
  returning id into new_operation_id;

  foreach selected_asset_id in array sorted_asset_ids loop
    insert into public.operation_assets (
      org_id, operation_id, asset_id, delivered_by_user_id,
        received_by_user_id, departure_condition, departure_at, created_by
    ) values (
      p_org_id, new_operation_id, selected_asset_id,
        p_delivered_by_user_id, p_received_by_user_id, p_departure_condition,
        p_departure_at, auth.uid()
    );
  end loop;

  return new_operation_id;
end;
$$;

create function public.return_operation_asset(
  p_org_id uuid,
  p_operation_asset_id uuid,
  p_return_condition text,
  p_returned_by_user_id uuid,
  p_return_received_by_user_id uuid,
  p_return_location_id uuid default null,
  p_return_notes text default null,
  p_hour_meter_start numeric default null,
  p_hour_meter_end numeric default null,
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
  if returned_asset_type = 'drone'
    and (p_hour_meter_start is null or p_hour_meter_end is null) then
    raise exception 'Drone hour-meter readings are required when recording its return';
  end if;
  if returned_asset_type <> 'drone'
    and (p_hour_meter_start is not null or p_hour_meter_end is not null) then
    raise exception 'Hour-meter readings can only be recorded for drones';
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
      org_id, drone_asset_id, operation_id, farm_id, logged_at,
      hour_meter_start, hour_meter_end, recorded_by
    ) values (
      p_org_id, returned_asset_id, returned_operation_id, operation_farm_id,
      p_returned_at, p_hour_meter_start, p_hour_meter_end, auth.uid()
    );
  end if;
  return returned_asset_id;
end;
$$;

create trigger audit_organizations after insert or update or delete on public.organizations for each row execute function public.write_audit_event();
create trigger audit_roles after insert or update or delete on public.roles for each row execute function public.write_audit_event();
create trigger audit_role_permissions after insert or update or delete on public.role_permissions for each row execute function public.write_audit_event();
create trigger audit_memberships after insert or update or delete on public.memberships for each row execute function public.write_audit_event();
create trigger audit_user_profiles after insert or update or delete on public.user_profiles for each row execute function public.write_audit_event();
create trigger audit_asset_types after insert or update or delete on public.asset_types for each row execute function public.write_audit_event();
create trigger audit_asset_statuses after insert or update or delete on public.asset_statuses for each row execute function public.write_audit_event();
create trigger audit_operation_statuses after insert or update or delete on public.operation_statuses for each row execute function public.write_audit_event();
create trigger audit_maintenance_types after insert or update or delete on public.maintenance_types for each row execute function public.write_audit_event();
create trigger audit_locations after insert or update or delete on public.locations for each row execute function public.write_audit_event();
create trigger audit_suppliers after insert or update or delete on public.suppliers for each row execute function public.write_audit_event();
create trigger audit_farms after insert or update or delete on public.farms for each row execute function public.write_audit_event();
create trigger audit_assets after insert or update or delete on public.assets for each row execute function public.write_audit_event();
create trigger create_asset_type_details after insert on public.assets for each row execute function public.create_asset_details();
create trigger guard_drone_hours_changes before insert or update on public.drone_details for each row execute function public.guard_drone_hours();
create trigger audit_drone_details after insert or update or delete on public.drone_details for each row execute function public.write_audit_event();
create trigger audit_battery_details after insert or update or delete on public.battery_details for each row execute function public.write_audit_event();
create trigger audit_asset_assignments after insert or update or delete on public.asset_assignments for each row execute function public.write_audit_event();
create trigger audit_operations after insert or update or delete on public.operations for each row execute function public.write_audit_event();
create trigger audit_operation_assets after insert or update or delete on public.operation_assets for each row execute function public.write_audit_event();
create trigger audit_flight_logs after insert or update or delete on public.flight_logs for each row execute function public.write_audit_event();
create trigger audit_maintenance_plans after insert or update or delete on public.maintenance_plans for each row execute function public.write_audit_event();
create trigger audit_maintenance_records after insert or update or delete on public.maintenance_records for each row execute function public.write_audit_event();
create trigger sync_drone_maintenance_completion after insert or update on public.maintenance_records for each row execute function public.sync_drone_maintenance();
create trigger audit_inventory_items after insert or update or delete on public.inventory_items for each row execute function public.write_audit_event();
create trigger audit_inventory_movements after insert or update or delete on public.inventory_movements for each row execute function public.write_audit_event();
create trigger audit_documents after insert or update or delete on public.documents for each row execute function public.write_audit_event();
create trigger validate_asset_user_memberships before insert or update on public.assets for each row execute function public.validate_org_users();
create trigger validate_assignment_user_memberships before insert or update on public.asset_assignments for each row execute function public.validate_org_users();
create trigger validate_user_profile_membership before insert or update on public.user_profiles for each row execute function public.validate_org_users();
create trigger validate_operation_user_memberships before insert or update on public.operations for each row execute function public.validate_org_users();
create trigger validate_operation_asset_user_memberships before insert or update on public.operation_assets for each row execute function public.validate_org_users();
create trigger validate_flight_log_user_memberships before insert or update on public.flight_logs for each row execute function public.validate_org_users();
create trigger validate_maintenance_user_memberships before insert or update on public.maintenance_records for each row execute function public.validate_org_users();
create trigger validate_inventory_item_user_memberships before insert or update on public.inventory_items for each row execute function public.validate_org_users();
create trigger validate_inventory_movement_user_memberships before insert on public.inventory_movements for each row execute function public.validate_org_users();
create trigger validate_document_user_memberships before insert on public.documents for each row execute function public.validate_org_users();
create trigger prevent_asset_delete before delete on public.assets for each row execute function public.reject_business_delete();
create trigger prevent_assignment_delete before delete on public.asset_assignments for each row execute function public.reject_business_delete();
create trigger prevent_operation_delete before delete on public.operations for each row execute function public.reject_business_delete();
create trigger prevent_operation_asset_delete before delete on public.operation_assets for each row execute function public.reject_business_delete();
create trigger prevent_flight_log_mutation before update or delete on public.flight_logs for each row execute function public.reject_flight_log_mutation();
create trigger prevent_maintenance_record_delete before delete on public.maintenance_records for each row execute function public.reject_business_delete();
create trigger prevent_inventory_item_delete before delete on public.inventory_items for each row execute function public.reject_business_delete();
create trigger prevent_inventory_movement_delete before delete on public.inventory_movements for each row execute function public.reject_business_delete();
create trigger prevent_document_delete before delete on public.documents for each row execute function public.reject_business_delete();
create trigger prevent_audit_update_delete before update or delete on public.audit_events for each row execute function public.reject_audit_mutation();
create trigger seal_audit_event_before_insert before insert on public.audit_events for each row execute function public.seal_audit_event();
create trigger guard_operation_asset_changes before insert or update on public.operation_assets for each row execute function public.guard_operation_asset();
create trigger guard_asset_status_changes before update on public.assets for each row execute function public.guard_asset_status();
create trigger guard_assignment_history_changes before update on public.asset_assignments for each row execute function public.guard_assignment_history();
create trigger guard_operation_completion_changes before update on public.operations for each row execute function public.guard_operation_completion();
create trigger guard_inventory_quantity_changes before insert or update on public.inventory_items for each row execute function public.guard_inventory_quantity();
create trigger validate_flight_log_insert before insert on public.flight_logs for each row execute function public.validate_flight_log();
create trigger apply_inventory_movement_insert before insert on public.inventory_movements for each row execute function public.apply_inventory_movement();
create trigger add_drone_flight_hours after insert on public.flight_logs for each row execute function public.sync_drone_flight_hours();

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'organizations', 'roles', 'role_permissions', 'memberships', 'user_profiles', 'asset_types',
    'asset_statuses', 'operation_statuses', 'maintenance_types',
    'locations', 'suppliers', 'farms', 'assets', 'drone_details', 'battery_details',
    'asset_assignments', 'operations', 'operation_assets', 'flight_logs',
    'maintenance_plans', 'maintenance_records', 'inventory_items',
    'inventory_movements', 'documents', 'audit_events', 'audit_chain_heads'
  ] loop
    execute format('alter table public.%I enable row level security', table_name);
    execute format('alter table public.%I force row level security', table_name);
  end loop;
end $$;

create policy org_member_read on public.permissions for select to authenticated using (true);

create policy org_read on public.organizations for select to authenticated
  using (id in (select public.user_org_ids()));
create policy role_read on public.roles for select to authenticated
  using (public.has_org_permission(org_id, 'users.manage'));
create policy role_permissions_read on public.role_permissions for select to authenticated
  using (public.has_org_permission(org_id, 'users.manage'));
create policy membership_self_read on public.memberships for select to authenticated
  using (user_id = auth.uid() or public.has_org_permission(org_id, 'users.manage'));
create policy user_profiles_read on public.user_profiles for select to authenticated
  using (org_id in (select public.user_org_ids()));
create policy user_profiles_self_insert on public.user_profiles for insert to authenticated
  with check (user_id = auth.uid() and org_id in (select public.user_org_ids()));
create policy user_profiles_self_update on public.user_profiles for update to authenticated
  using (user_id = auth.uid() and org_id in (select public.user_org_ids()))
  with check (user_id = auth.uid() and org_id in (select public.user_org_ids()));
create policy user_profiles_admin_manage on public.user_profiles for all to authenticated
  using (public.has_org_permission(org_id, 'users.manage'))
  with check (public.has_org_permission(org_id, 'users.manage'));
create policy asset_types_read on public.asset_types for select to authenticated
  using (public.has_org_permission(org_id, 'assets.read'));
create policy asset_statuses_read on public.asset_statuses for select to authenticated
  using (public.has_org_permission(org_id, 'assets.read'));
create policy operation_statuses_read on public.operation_statuses for select to authenticated
  using (public.has_org_permission(org_id, 'operations.read') or public.has_org_permission(org_id, 'operations.manage'));
create policy maintenance_types_read on public.maintenance_types for select to authenticated
  using (public.has_org_permission(org_id, 'maintenance.read') or public.has_org_permission(org_id, 'maintenance.manage'));
create policy locations_read on public.locations for select to authenticated
  using (public.has_org_permission(org_id, 'assets.read'));
create policy suppliers_read on public.suppliers for select to authenticated
  using (public.has_org_permission(org_id, 'assets.read'));
create policy farms_read on public.farms for select to authenticated
  using (public.has_org_permission(org_id, 'operations.read') or public.has_org_permission(org_id, 'operations.manage'));
create policy assets_read on public.assets for select to authenticated
  using (public.has_org_permission(org_id, 'assets.read'));
create policy drone_details_read on public.drone_details for select to authenticated
  using (public.has_org_permission(org_id, 'assets.read'));
create policy battery_details_read on public.battery_details for select to authenticated
  using (public.has_org_permission(org_id, 'assets.read'));
create policy assignments_read on public.asset_assignments for select to authenticated
  using (public.has_org_permission(org_id, 'operations.read') or public.has_org_permission(org_id, 'operations.manage'));
create policy operations_read on public.operations for select to authenticated
  using (public.has_org_permission(org_id, 'operations.read') or public.has_org_permission(org_id, 'operations.manage'));
create policy operation_assets_read on public.operation_assets for select to authenticated
  using (public.has_org_permission(org_id, 'operations.read') or public.has_org_permission(org_id, 'operations.manage'));
create policy flight_logs_read on public.flight_logs for select to authenticated
  using (public.has_org_permission(org_id, 'assets.read'));
create policy maintenance_plans_read on public.maintenance_plans for select to authenticated
  using (public.has_org_permission(org_id, 'maintenance.read') or public.has_org_permission(org_id, 'maintenance.manage'));
create policy maintenance_records_read on public.maintenance_records for select to authenticated
  using (public.has_org_permission(org_id, 'maintenance.read') or public.has_org_permission(org_id, 'maintenance.manage'));
create policy inventory_items_read on public.inventory_items for select to authenticated
  using (public.has_org_permission(org_id, 'inventory.read') or public.has_org_permission(org_id, 'inventory.manage'));
create policy inventory_movements_read on public.inventory_movements for select to authenticated
  using (public.has_org_permission(org_id, 'inventory.read') or public.has_org_permission(org_id, 'inventory.manage'));
create policy documents_read on public.documents for select to authenticated
  using (public.has_org_permission(org_id, 'assets.read')
    or public.has_org_permission(org_id, 'operations.read')
    or public.has_org_permission(org_id, 'maintenance.read'));

create policy assets_manage on public.assets for all to authenticated
  using (public.has_org_permission(org_id, 'assets.manage'))
  with check (public.has_org_permission(org_id, 'assets.manage'));
create policy drone_details_manage on public.drone_details for all to authenticated
  using (public.has_org_permission(org_id, 'assets.manage') or public.has_org_permission(org_id, 'maintenance.manage'))
  with check (public.has_org_permission(org_id, 'assets.manage') or public.has_org_permission(org_id, 'maintenance.manage'));
create policy battery_details_manage on public.battery_details for all to authenticated
  using (public.has_org_permission(org_id, 'assets.manage'))
  with check (public.has_org_permission(org_id, 'assets.manage'));

create policy assignments_manage on public.asset_assignments for all to authenticated
  using (public.has_org_permission(org_id, 'operations.manage'))
  with check (public.has_org_permission(org_id, 'operations.manage'));
create policy operations_manage on public.operations for all to authenticated
  using (public.has_org_permission(org_id, 'operations.manage'))
  with check (public.has_org_permission(org_id, 'operations.manage'));
create policy operation_assets_manage on public.operation_assets for all to authenticated
  using (public.has_org_permission(org_id, 'operations.manage'))
  with check (public.has_org_permission(org_id, 'operations.manage'));
create policy flight_logs_manage on public.flight_logs for all to authenticated
  using (public.has_org_permission(org_id, 'maintenance.manage') or public.has_org_permission(org_id, 'operations.manage'))
  with check (public.has_org_permission(org_id, 'maintenance.manage') or public.has_org_permission(org_id, 'operations.manage'));

create policy maintenance_plans_manage on public.maintenance_plans for all to authenticated
  using (public.has_org_permission(org_id, 'catalogs.manage'))
  with check (public.has_org_permission(org_id, 'catalogs.manage'));
create policy maintenance_records_manage on public.maintenance_records for all to authenticated
  using (public.has_org_permission(org_id, 'maintenance.manage'))
  with check (public.has_org_permission(org_id, 'maintenance.manage'));
create policy inventory_items_manage on public.inventory_items for all to authenticated
  using (public.has_org_permission(org_id, 'inventory.manage'))
  with check (public.has_org_permission(org_id, 'inventory.manage'));
create policy inventory_movements_manage on public.inventory_movements for insert to authenticated
  with check (public.has_org_permission(org_id, 'inventory.manage'));
create policy documents_insert on public.documents for insert to authenticated
  with check (
    uploaded_by = auth.uid()
    and (storage.foldername(storage_path))[1] = org_id::text
    and (storage.foldername(storage_path))[2] = auth.uid()::text
    and (public.has_org_permission(org_id, 'assets.manage')
      or public.has_org_permission(org_id, 'operations.manage')
      or public.has_org_permission(org_id, 'maintenance.manage'))
  );

create policy catalogs_manage on public.asset_types for all to authenticated
  using (public.has_org_permission(org_id, 'catalogs.manage'))
  with check (public.has_org_permission(org_id, 'catalogs.manage'));
create policy asset_statuses_manage on public.asset_statuses for all to authenticated
  using (public.has_org_permission(org_id, 'catalogs.manage'))
  with check (public.has_org_permission(org_id, 'catalogs.manage'));
create policy operation_statuses_manage on public.operation_statuses for all to authenticated
  using (public.has_org_permission(org_id, 'catalogs.manage'))
  with check (public.has_org_permission(org_id, 'catalogs.manage'));
create policy maintenance_types_manage on public.maintenance_types for all to authenticated
  using (public.has_org_permission(org_id, 'catalogs.manage'))
  with check (public.has_org_permission(org_id, 'catalogs.manage'));
create policy locations_manage on public.locations for all to authenticated
  using (public.has_org_permission(org_id, 'catalogs.manage'))
  with check (public.has_org_permission(org_id, 'catalogs.manage'));
create policy suppliers_manage on public.suppliers for all to authenticated
  using (public.has_org_permission(org_id, 'catalogs.manage'))
  with check (public.has_org_permission(org_id, 'catalogs.manage'));
create policy farms_manage on public.farms for all to authenticated
  using (public.has_org_permission(org_id, 'catalogs.manage') or public.has_org_permission(org_id, 'operations.manage'))
  with check (public.has_org_permission(org_id, 'catalogs.manage') or public.has_org_permission(org_id, 'operations.manage'));

create policy audit_read on public.audit_events for select to authenticated
  using (public.has_org_permission(org_id, 'audit.read'));
create policy roles_manage on public.roles for all to authenticated
  using (public.has_org_permission(org_id, 'users.manage'))
  with check (public.has_org_permission(org_id, 'users.manage'));
create policy role_permissions_manage on public.role_permissions for all to authenticated
  using (public.has_org_permission(org_id, 'users.manage'))
  with check (public.has_org_permission(org_id, 'users.manage'));
create policy memberships_manage on public.memberships for all to authenticated
  using (public.has_org_permission(org_id, 'users.manage'))
  with check (public.has_org_permission(org_id, 'users.manage'));

revoke all on public.organizations, public.roles, public.role_permissions, public.memberships,
  public.user_profiles,
  public.permissions, public.asset_types, public.asset_statuses, public.operation_statuses,
  public.maintenance_types, public.locations, public.suppliers, public.farms, public.assets,
  public.drone_details, public.battery_details, public.asset_assignments, public.operations,
  public.operation_assets, public.flight_logs, public.maintenance_plans,
  public.maintenance_records, public.inventory_items, public.inventory_movements,
  public.documents, public.audit_events, public.audit_chain_heads from anon, authenticated;
revoke all on sequence public.operations_operation_number_seq from anon, authenticated;
grant select on public.audit_events to authenticated;
grant select on public.permissions to authenticated;
grant select, insert, update on public.organizations, public.roles, public.role_permissions,
  public.memberships, public.asset_types, public.asset_statuses, public.operation_statuses,
  public.maintenance_types, public.locations, public.suppliers, public.farms, public.user_profiles,
  public.assets, public.drone_details, public.battery_details, public.asset_assignments,
  public.operations, public.operation_assets, public.maintenance_plans,
  public.maintenance_records, public.inventory_items, public.documents to authenticated;
grant select, insert on public.flight_logs, public.inventory_movements to authenticated;
grant usage, select on sequence public.operations_operation_number_seq to authenticated;
revoke all on function public.user_org_ids() from public, anon;
revoke all on function public.has_org_permission(uuid, text) from public, anon;
grant execute on function public.user_org_ids(), public.has_org_permission(uuid, text) to authenticated;
revoke all on function public.verify_audit_chain(uuid) from public, anon;
grant execute on function public.verify_audit_chain(uuid) to authenticated;
revoke all on function public.create_operation_with_assets(uuid, uuid, uuid[], uuid, uuid, uuid, uuid, text, text, text, timestamptz, text) from public, anon;
grant execute on function public.create_operation_with_assets(uuid, uuid, uuid[], uuid, uuid, uuid, uuid, text, text, text, timestamptz, text) to authenticated;
revoke all on function public.return_operation_asset(uuid, uuid, text, uuid, uuid, uuid, text, numeric, numeric, timestamptz) from public, anon;
grant execute on function public.return_operation_asset(uuid, uuid, text, uuid, uuid, uuid, text, numeric, numeric, timestamptz) to authenticated;

insert into public.organizations (id, name)
values ('c148841e-76e7-4ee2-b514-1ca7ce9836ad', 'Sky Logic')
on conflict (id) do nothing;

insert into public.roles (org_id, code, name) values
  ('c148841e-76e7-4ee2-b514-1ca7ce9836ad', 'management', 'Administradora / Gerencia'),
  ('c148841e-76e7-4ee2-b514-1ca7ce9836ad', 'system_admin', 'Administrador del sistema'),
  ('c148841e-76e7-4ee2-b514-1ca7ce9836ad', 'operations', 'Responsable de operaciones'),
  ('c148841e-76e7-4ee2-b514-1ca7ce9836ad', 'drone_technician', 'Técnico de drones'),
  ('c148841e-76e7-4ee2-b514-1ca7ce9836ad', 'inventory', 'Encargado de inventario'),
  ('c148841e-76e7-4ee2-b514-1ca7ce9836ad', 'operator', 'Operador')
on conflict (org_id, code) do nothing;

insert into public.role_permissions (org_id, role_id, permission_code)
select r.org_id, r.id, p.code
from public.roles r
cross join public.permissions p
where r.org_id = 'c148841e-76e7-4ee2-b514-1ca7ce9836ad'
  and (
    (r.code = 'management' and p.code in ('assets.read', 'operations.read', 'maintenance.read', 'inventory.read', 'audit.read', 'reports.read'))
    or (r.code = 'system_admin' and p.code in ('assets.read', 'assets.manage', 'operations.read', 'operations.manage', 'maintenance.read', 'maintenance.manage', 'inventory.read', 'inventory.manage', 'audit.read', 'users.manage', 'catalogs.manage', 'reports.read'))
    or (r.code = 'operations' and p.code in ('assets.read', 'operations.read', 'operations.manage'))
    or (r.code = 'drone_technician' and p.code in ('assets.read', 'maintenance.read', 'maintenance.manage'))
    or (r.code = 'inventory' and p.code in ('assets.read', 'inventory.read', 'inventory.manage'))
    or (r.code = 'operator' and p.code in ('assets.read', 'operations.read'))
  )
on conflict do nothing;

insert into public.asset_types (org_id, code, name) values
  ('c148841e-76e7-4ee2-b514-1ca7ce9836ad', 'drone', 'Dron'),
  ('c148841e-76e7-4ee2-b514-1ca7ce9836ad', 'controller', 'Control'),
  ('c148841e-76e7-4ee2-b514-1ca7ce9836ad', 'battery', 'Batería'),
  ('c148841e-76e7-4ee2-b514-1ca7ce9836ad', 'tank', 'Tanque'),
  ('c148841e-76e7-4ee2-b514-1ca7ce9836ad', 'pump', 'Motobomba'),
  ('c148841e-76e7-4ee2-b514-1ca7ce9836ad', 'generator', 'Generador'),
  ('c148841e-76e7-4ee2-b514-1ca7ce9836ad', 'tool', 'Herramienta'),
  ('c148841e-76e7-4ee2-b514-1ca7ce9836ad', 'accessory', 'Accesorio'),
  ('c148841e-76e7-4ee2-b514-1ca7ce9836ad', 'other', 'Otro')
on conflict (org_id, code) do nothing;

insert into public.asset_statuses (org_id, code, name) values
  ('c148841e-76e7-4ee2-b514-1ca7ce9836ad', 'unverified', 'Sin verificar'),
  ('c148841e-76e7-4ee2-b514-1ca7ce9836ad', 'available', 'Disponible en base'),
  ('c148841e-76e7-4ee2-b514-1ca7ce9836ad', 'preparing', 'En preparación'),
  ('c148841e-76e7-4ee2-b514-1ca7ce9836ad', 'in_transit', 'En tránsito'),
  ('c148841e-76e7-4ee2-b514-1ca7ce9836ad', 'in_operation', 'En operación'),
  ('c148841e-76e7-4ee2-b514-1ca7ce9836ad', 'inspection', 'En inspección'),
  ('c148841e-76e7-4ee2-b514-1ca7ce9836ad', 'maintenance', 'En mantenimiento'),
  ('c148841e-76e7-4ee2-b514-1ca7ce9836ad', 'repair', 'En reparación'),
  ('c148841e-76e7-4ee2-b514-1ca7ce9836ad', 'damaged', 'Dañado'),
  ('c148841e-76e7-4ee2-b514-1ca7ce9836ad', 'out_of_service', 'Fuera de servicio')
on conflict (org_id, code) do nothing;

insert into public.operation_statuses (org_id, code, name) values
  ('c148841e-76e7-4ee2-b514-1ca7ce9836ad', 'preparing', 'En preparación'),
  ('c148841e-76e7-4ee2-b514-1ca7ce9836ad', 'in_transit', 'En tránsito'),
  ('c148841e-76e7-4ee2-b514-1ca7ce9836ad', 'in_operation', 'En operación'),
  ('c148841e-76e7-4ee2-b514-1ca7ce9836ad', 'inspection', 'En inspección'),
  ('c148841e-76e7-4ee2-b514-1ca7ce9836ad', 'completed', 'Finalizada'),
  ('c148841e-76e7-4ee2-b514-1ca7ce9836ad', 'cancelled', 'Cancelada')
on conflict (org_id, code) do nothing;

insert into public.maintenance_types (org_id, code, name) values
  ('c148841e-76e7-4ee2-b514-1ca7ce9836ad', 'preventive', 'Preventivo'),
  ('c148841e-76e7-4ee2-b514-1ca7ce9836ad', 'corrective', 'Correctivo'),
  ('c148841e-76e7-4ee2-b514-1ca7ce9836ad', 'inspection', 'Inspección'),
  ('c148841e-76e7-4ee2-b514-1ca7ce9836ad', 'diagnostic', 'Diagnóstico'),
  ('c148841e-76e7-4ee2-b514-1ca7ce9836ad', 'repair', 'Reparación')
on conflict (org_id, code) do nothing;

insert into public.locations (org_id, name, location_type)
values
  ('c148841e-76e7-4ee2-b514-1ca7ce9836ad', 'Base principal', 'base'),
  ('c148841e-76e7-4ee2-b514-1ca7ce9836ad', 'Taller', 'workshop'),
  ('c148841e-76e7-4ee2-b514-1ca7ce9836ad', 'Bodega', 'warehouse')
on conflict do nothing;

insert into public.assets (org_id, asset_type_code, internal_code, name)
values
  ('c148841e-76e7-4ee2-b514-1ca7ce9836ad', 'drone', 'SKY-ONE', 'Sky One'),
  ('c148841e-76e7-4ee2-b514-1ca7ce9836ad', 'drone', 'SKY-TWO', 'Sky Two'),
  ('c148841e-76e7-4ee2-b514-1ca7ce9836ad', 'controller', 'CTRL-SKY-ONE', 'Control de Sky One'),
  ('c148841e-76e7-4ee2-b514-1ca7ce9836ad', 'controller', 'CTRL-SKY-TWO', 'Control de Sky Two'),
  ('c148841e-76e7-4ee2-b514-1ca7ce9836ad', 'battery', 'BAT-SKY-ONE-01', 'Batería 1 de Sky One'),
  ('c148841e-76e7-4ee2-b514-1ca7ce9836ad', 'battery', 'BAT-SKY-ONE-02', 'Batería 2 de Sky One'),
  ('c148841e-76e7-4ee2-b514-1ca7ce9836ad', 'battery', 'BAT-SKY-ONE-03', 'Batería 3 de Sky One'),
  ('c148841e-76e7-4ee2-b514-1ca7ce9836ad', 'battery', 'BAT-SKY-TWO-01', 'Batería 1 de Sky Two'),
  ('c148841e-76e7-4ee2-b514-1ca7ce9836ad', 'battery', 'BAT-SKY-TWO-02', 'Batería 2 de Sky Two'),
  ('c148841e-76e7-4ee2-b514-1ca7ce9836ad', 'battery', 'BAT-SKY-TWO-03', 'Batería 3 de Sky Two')
on conflict (org_id, internal_code) do nothing;

insert into public.asset_assignments (
  org_id, asset_id, assigned_asset_id, assignment_type, reason
)
select component.org_id, component.id, drone.id, 'asset', 'Componente inicial asociado al dron'
from public.assets component
join public.assets drone
  on drone.org_id = component.org_id
  and drone.internal_code = case
    when component.internal_code like '%SKY-ONE%' then 'SKY-ONE'
    when component.internal_code like '%SKY-TWO%' then 'SKY-TWO'
  end
where component.org_id = 'c148841e-76e7-4ee2-b514-1ca7ce9836ad'
  and component.asset_type_code in ('controller', 'battery')
on conflict do nothing;

insert into public.drone_details (asset_id, org_id)
select id, org_id from public.assets where org_id = 'c148841e-76e7-4ee2-b514-1ca7ce9836ad'
  and asset_type_code = 'drone'
on conflict (asset_id) do nothing;

insert into public.battery_details (asset_id, org_id)
select id, org_id from public.assets where org_id = 'c148841e-76e7-4ee2-b514-1ca7ce9836ad'
  and asset_type_code = 'battery'
on conflict (asset_id) do nothing;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'sky-logic-private',
  'sky-logic-private',
  false,
  26214400,
  array['image/jpeg', 'image/png', 'image/webp', 'application/pdf']
)
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

create policy sky_logic_files_read on storage.objects for select to authenticated
  using (
    bucket_id = 'sky-logic-private'
    and (storage.foldername(name))[1] in (
      select membership_org.org_id::text
      from public.user_org_ids() as membership_org(org_id)
    )
  );
create policy sky_logic_files_insert on storage.objects for insert to authenticated
  with check (
    bucket_id = 'sky-logic-private'
    and (storage.foldername(name))[1] in (
      select m.org_id::text
      from public.memberships m
      where m.user_id = auth.uid()
        and m.active
        and (
          public.has_org_permission(m.org_id, 'assets.manage')
          or public.has_org_permission(m.org_id, 'operations.manage')
          or public.has_org_permission(m.org_id, 'maintenance.manage')
        )
    )
    and (storage.foldername(name))[2] = auth.uid()::text
  );

do $$
declare
  table_name text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach table_name in array array[
      'assets', 'operations', 'operation_assets', 'flight_logs',
      'maintenance_records', 'inventory_movements', 'audit_events'
    ] loop
      if not exists (
        select 1 from pg_publication_tables
        where pubname = 'supabase_realtime'
          and schemaname = 'public'
          and tablename = table_name
      ) then
        execute format('alter publication supabase_realtime add table public.%I', table_name);
      end if;
    end loop;
  end if;
end $$;
