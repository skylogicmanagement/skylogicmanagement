alter table public.inventory_items
  add column is_serialized boolean not null default false,
  add column serial_number text,
  add column manufacturer text,
  add column model text,
  add column acquired_on date,
  add constraint inventory_serialized_quantity_check check (
    not is_serialized
    or (
      serial_number is not null
      and quantity_on_hand <= 1
      and quantity_on_hand = trunc(quantity_on_hand)
    )
  );

create unique index inventory_items_org_serial_unique
  on public.inventory_items (org_id, serial_number)
  where serial_number is not null;

alter table public.inventory_movements
  add column source_location_id uuid,
  add column target_location_id uuid,
  add constraint inventory_movement_source_location_fk
    foreign key (source_location_id, org_id) references public.locations(id, org_id),
  add constraint inventory_movement_target_location_fk
    foreign key (target_location_id, org_id) references public.locations(id, org_id);

create table public.inventory_location_balances (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id),
  item_id uuid not null,
  location_id uuid,
  balance_key text generated always as (coalesce(location_id::text, 'unassigned')) stored,
  quantity_on_hand numeric(14, 3) not null default 0 check (quantity_on_hand >= 0),
  updated_at timestamptz not null default now(),
  foreign key (item_id, org_id) references public.inventory_items(id, org_id),
  foreign key (location_id, org_id) references public.locations(id, org_id),
  unique (item_id, balance_key)
);

alter table public.inventory_location_balances enable row level security;
alter table public.inventory_location_balances force row level security;

create policy inventory_location_balances_read on public.inventory_location_balances
  for select to authenticated
  using (
    public.has_org_permission(org_id, 'inventory.read')
    or public.has_org_permission(org_id, 'inventory.manage')
  );

grant select on public.inventory_location_balances to authenticated;

insert into public.inventory_location_balances (org_id, item_id, location_id, quantity_on_hand)
select org_id, id, location_id, quantity_on_hand
from public.inventory_items
where quantity_on_hand > 0
on conflict (item_id, balance_key) do update
set quantity_on_hand = excluded.quantity_on_hand,
    updated_at = now();

create or replace function public.apply_inventory_movement()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  item_row public.inventory_items%rowtype;
  source_balance numeric(14, 3);
  amount numeric(14, 3);
begin
  perform pg_advisory_xact_lock(hashtextextended(new.item_id::text, 2));

  select * into item_row
  from public.inventory_items
  where id = new.item_id and org_id = new.org_id and active
  for update;

  if not found then
    raise exception 'Inventory item not found';
  end if;

  if new.movement_type in ('purchase', 'return', 'repair_return') then
    if new.quantity_delta <= 0 then
      raise exception 'This inventory movement must add stock';
    end if;
    new.target_location_id := coalesce(new.target_location_id, item_row.location_id);
    amount := new.quantity_delta;
  elsif new.movement_type in ('installation', 'consumption', 'repair_sent', 'write_off') then
    if new.quantity_delta >= 0 then
      raise exception 'This inventory movement must reduce stock';
    end if;
    new.source_location_id := coalesce(new.source_location_id, item_row.location_id);
    amount := abs(new.quantity_delta);
  elsif new.movement_type = 'transfer' then
    if new.quantity_delta >= 0
      or new.source_location_id is null
      or new.target_location_id is null
      or new.source_location_id = new.target_location_id then
      raise exception 'A transfer requires a positive quantity and two different locations';
    end if;
    amount := abs(new.quantity_delta);
  elsif new.movement_type = 'correction' then
    if new.quantity_delta = 0 or nullif(trim(new.reason), '') is null then
      raise exception 'A correction requires a non-zero quantity and reason';
    end if;
    if new.quantity_delta > 0 then
      new.target_location_id := coalesce(new.target_location_id, item_row.location_id);
    else
      new.source_location_id := coalesce(new.source_location_id, item_row.location_id);
    end if;
    amount := abs(new.quantity_delta);
  else
    raise exception 'Unsupported inventory movement type';
  end if;

  if new.target_location_id is not null and not exists (
    select 1 from public.locations
    where id = new.target_location_id and org_id = new.org_id and active
  ) then
    raise exception 'Target location is inactive or does not belong to this organization';
  end if;

  if item_row.is_serialized and (amount <> 1 or amount <> trunc(amount)) then
    raise exception 'Serialized inventory must move one whole item at a time';
  end if;

  if new.movement_type in ('purchase', 'return', 'repair_return')
    or (new.movement_type = 'correction' and new.quantity_delta > 0) then
    insert into public.inventory_location_balances (org_id, item_id, location_id, quantity_on_hand)
    values (new.org_id, new.item_id, new.target_location_id, amount)
    on conflict (item_id, balance_key) do update
    set quantity_on_hand = public.inventory_location_balances.quantity_on_hand + excluded.quantity_on_hand,
        updated_at = now();
  elsif new.movement_type = 'transfer' then
    select quantity_on_hand into source_balance
    from public.inventory_location_balances
    where item_id = new.item_id
      and location_id is not distinct from new.source_location_id
    for update;
    if source_balance is null or source_balance < amount then
      raise exception 'Transfer exceeds the stock at the source location';
    end if;
    update public.inventory_location_balances
    set quantity_on_hand = quantity_on_hand - amount, updated_at = now()
    where item_id = new.item_id
      and location_id is not distinct from new.source_location_id;
    insert into public.inventory_location_balances (org_id, item_id, location_id, quantity_on_hand)
    values (new.org_id, new.item_id, new.target_location_id, amount)
    on conflict (item_id, balance_key) do update
    set quantity_on_hand = public.inventory_location_balances.quantity_on_hand + excluded.quantity_on_hand,
        updated_at = now();
  else
    select quantity_on_hand into source_balance
    from public.inventory_location_balances
    where item_id = new.item_id
      and location_id is not distinct from new.source_location_id
    for update;
    if source_balance is null or source_balance < amount then
      raise exception 'Inventory movement exceeds stock at the selected location';
    end if;
    update public.inventory_location_balances
    set quantity_on_hand = quantity_on_hand - amount, updated_at = now()
    where item_id = new.item_id
      and location_id is not distinct from new.source_location_id;
  end if;

  if new.movement_type <> 'transfer' then
    if item_row.quantity_on_hand + new.quantity_delta < 0 then
      raise exception 'Inventory movement exceeds available quantity';
    end if;
    if item_row.is_serialized and item_row.quantity_on_hand + new.quantity_delta > 1 then
      raise exception 'Serialized inventory cannot exceed one unit per item';
    end if;
    update public.inventory_items
    set quantity_on_hand = item_row.quantity_on_hand + new.quantity_delta
    where id = new.item_id and org_id = new.org_id;
  end if;

  return new;
end;
$$;

create or replace function public.create_inventory_item(
  p_org_id uuid,
  p_internal_code text,
  p_name text,
  p_category text,
  p_unit text,
  p_opening_quantity numeric,
  p_location_id uuid,
  p_is_serialized boolean,
  p_serial_number text,
  p_manufacturer text,
  p_model text,
  p_manufacturer_reference text,
  p_acquired_on date,
  p_supplier_id uuid,
  p_unit_value numeric,
  p_notes text
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  created_item_id uuid;
begin
  if auth.uid() is null or not public.has_org_permission(p_org_id, 'inventory.manage') then
    raise exception 'Not authorized to manage inventory';
  end if;
  if nullif(trim(p_internal_code), '') is null
    or nullif(trim(p_name), '') is null
    or nullif(trim(p_category), '') is null
    or nullif(trim(p_unit), '') is null
    or p_opening_quantity is null
    or p_opening_quantity < 0 then
    raise exception 'Required inventory data is missing or invalid';
  end if;
  if p_is_serialized and (
    nullif(trim(p_serial_number), '') is null
    or p_opening_quantity not in (0, 1)
  ) then
    raise exception 'Serialized items require a serial number and an opening quantity of zero or one';
  end if;
  if p_opening_quantity > 0 and p_location_id is null then
    raise exception 'A storage location is required for opening stock';
  end if;
  if p_location_id is not null and not exists (
    select 1 from public.locations
    where id = p_location_id and org_id = p_org_id and active
  ) then
    raise exception 'The selected storage location is inactive or does not belong to this organization';
  end if;
  if p_supplier_id is not null and not exists (
    select 1 from public.suppliers
    where id = p_supplier_id and org_id = p_org_id and active
  ) then
    raise exception 'The selected supplier is inactive or does not belong to this organization';
  end if;

  insert into public.inventory_items (
    org_id, internal_code, name, category, unit, quantity_on_hand, location_id,
    supplier_id, unit_value, notes, is_serialized, serial_number, manufacturer,
    model, manufacturer_reference, acquired_on
  ) values (
    p_org_id, trim(p_internal_code), trim(p_name), trim(p_category), trim(p_unit), 0,
    p_location_id, p_supplier_id, p_unit_value, nullif(trim(p_notes), ''),
    p_is_serialized, nullif(trim(p_serial_number), ''), nullif(trim(p_manufacturer), ''),
    nullif(trim(p_model), ''), nullif(trim(p_manufacturer_reference), ''), p_acquired_on
  )
  returning id into created_item_id;

  if p_opening_quantity > 0 then
    insert into public.inventory_movements (
      org_id, item_id, movement_type, quantity_delta, target_location_id, reason
    ) values (
      p_org_id, created_item_id, 'purchase', p_opening_quantity, p_location_id,
      'Existencia inicial al registrar el artículo'
    );
  end if;

  return created_item_id;
end;
$$;

create or replace function public.record_inventory_movement(
  p_org_id uuid,
  p_item_id uuid,
  p_movement_type text,
  p_quantity numeric,
  p_reason text,
  p_source_location_id uuid default null,
  p_target_location_id uuid default null,
  p_asset_id uuid default null,
  p_maintenance_record_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  movement_delta numeric(14, 3);
  movement_id uuid;
begin
  if auth.uid() is null or not public.has_org_permission(p_org_id, 'inventory.manage') then
    raise exception 'Not authorized to manage inventory';
  end if;
  if p_quantity is null or p_quantity <= 0 then
    raise exception 'Quantity must be greater than zero';
  end if;

  if p_movement_type in ('purchase', 'return', 'repair_return') then
    movement_delta := p_quantity;
  elsif p_movement_type in ('installation', 'consumption', 'repair_sent', 'write_off', 'transfer') then
    movement_delta := -p_quantity;
  elsif p_movement_type = 'correction' then
    raise exception 'Inventory corrections require an explicit audited correction workflow';
  else
    raise exception 'Unsupported inventory movement type';
  end if;

  if p_movement_type = 'transfer'
    and (p_source_location_id is null or p_target_location_id is null
      or p_source_location_id = p_target_location_id) then
    raise exception 'A transfer requires two different locations';
  end if;
  if p_movement_type in ('installation', 'consumption')
    and nullif(trim(p_reason), '') is null then
    raise exception 'A reason is required for consumption or installation';
  end if;
  if p_movement_type in ('repair_sent', 'write_off')
    and nullif(trim(p_reason), '') is null then
    raise exception 'A reason is required for repair or write-off movements';
  end if;
  if p_movement_type = 'installation' and p_asset_id is null then
    raise exception 'An installation must identify the asset receiving the part';
  end if;
  if p_maintenance_record_id is not null and not exists (
    select 1
    from public.maintenance_records
    where id = p_maintenance_record_id
      and org_id = p_org_id
      and (p_asset_id is null or asset_id = p_asset_id)
  ) then
    raise exception 'The maintenance record does not match the selected asset';
  end if;

  insert into public.inventory_movements (
    org_id, item_id, movement_type, quantity_delta, source_location_id,
    target_location_id, asset_id, maintenance_record_id, reason
  ) values (
    p_org_id, p_item_id, p_movement_type, movement_delta, p_source_location_id,
    p_target_location_id, p_asset_id, p_maintenance_record_id, nullif(trim(p_reason), '')
  )
  returning id into movement_id;

  return movement_id;
end;
$$;

revoke insert, update on public.inventory_items from authenticated;
revoke insert on public.inventory_movements from authenticated;
grant select on public.inventory_items, public.inventory_movements,
  public.inventory_location_balances to authenticated;
revoke all on function public.create_inventory_item(uuid, text, text, text, text, numeric, uuid, boolean, text, text, text, text, date, uuid, numeric, text) from public, anon;
revoke all on function public.record_inventory_movement(uuid, uuid, text, numeric, text, uuid, uuid, uuid, uuid) from public, anon;
grant execute on function public.create_inventory_item(uuid, text, text, text, text, numeric, uuid, boolean, text, text, text, text, date, uuid, numeric, text) to authenticated;
grant execute on function public.record_inventory_movement(uuid, uuid, text, numeric, text, uuid, uuid, uuid, uuid) to authenticated;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
    and not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'inventory_location_balances'
    ) then
    alter publication supabase_realtime add table public.inventory_location_balances;
  end if;
end $$;
