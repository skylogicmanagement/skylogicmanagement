create function public.get_maintenance_inventory_options(p_org_id uuid)
returns table (
  item_id uuid,
  internal_code text,
  item_name text,
  unit text,
  is_serialized boolean,
  location_id uuid,
  location_name text,
  quantity_available numeric
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null or not public.has_org_permission(p_org_id, 'maintenance.manage') then
    raise exception 'Not authorized to consult maintenance inventory';
  end if;

  return query
  select i.id, i.internal_code, i.name, i.unit, i.is_serialized,
         b.location_id, l.name, b.quantity_on_hand
  from public.inventory_items i
  join public.inventory_location_balances b
    on b.item_id = i.id and b.org_id = i.org_id
  join public.locations l
    on l.id = b.location_id and l.org_id = b.org_id and l.active
  where i.org_id = p_org_id
    and i.active
    and b.quantity_on_hand > 0
  order by i.name, l.name;
end;
$$;

create function public.complete_maintenance_with_parts(
  p_org_id uuid,
  p_maintenance_record_id uuid,
  p_activities text,
  p_outcome text,
  p_release_asset_status text,
  p_cost numeric default null,
  p_completed_at timestamptz default now(),
  p_next_intervention_at date default null,
  p_parts jsonb default '[]'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  target_asset_id uuid;
  part jsonb;
  part_item_id uuid;
  part_location_id uuid;
  part_quantity numeric(14, 3);
  part_movement_type text;
begin
  if auth.uid() is null or not public.has_org_permission(p_org_id, 'maintenance.manage') then
    raise exception 'Not authorized to complete maintenance records for this organization';
  end if;
  if p_parts is null or jsonb_typeof(p_parts) <> 'array' then
    raise exception 'Maintenance parts must be provided as a list';
  end if;
  if jsonb_array_length(p_parts) > 50 then
    raise exception 'A maintenance completion cannot contain more than 50 part lines';
  end if;

  select asset_id into target_asset_id
  from public.maintenance_records
  where id = p_maintenance_record_id
    and org_id = p_org_id
    and status in ('open', 'in_progress')
  for update;
  if target_asset_id is null then
    raise exception 'Open maintenance record was not found';
  end if;

  perform public.complete_maintenance(
    p_org_id,
    p_maintenance_record_id,
    p_activities,
    p_outcome,
    p_release_asset_status,
    p_cost,
    p_completed_at,
    p_next_intervention_at
  );

  for part in select value from jsonb_array_elements(p_parts)
  loop
    begin
      part_item_id := (part->>'item_id')::uuid;
      part_location_id := (part->>'source_location_id')::uuid;
      part_quantity := (part->>'quantity')::numeric;
    exception when invalid_text_representation or numeric_value_out_of_range then
      raise exception 'Each maintenance part requires valid item, location, and quantity values';
    end;

    part_movement_type := coalesce(part->>'movement_type', 'installation');
    if part_quantity is null or part_quantity <= 0 then
      raise exception 'Maintenance part quantities must be greater than zero';
    end if;
    if part_movement_type not in ('installation', 'consumption') then
      raise exception 'Maintenance parts must be recorded as installation or consumption';
    end if;
    if not exists (
      select 1
      from public.inventory_location_balances b
      join public.inventory_items i on i.id = b.item_id and i.org_id = b.org_id
      join public.locations l on l.id = b.location_id and l.org_id = b.org_id
      where b.org_id = p_org_id
        and b.item_id = part_item_id
        and b.location_id = part_location_id
        and b.quantity_on_hand >= part_quantity
        and i.active
        and l.active
    ) then
      raise exception 'Insufficient inventory or inactive item/location for maintenance part %', part_item_id;
    end if;

    insert into public.inventory_movements (
      org_id,
      item_id,
      movement_type,
      quantity_delta,
      source_location_id,
      asset_id,
      maintenance_record_id,
      reason
    ) values (
      p_org_id,
      part_item_id,
      part_movement_type,
      -part_quantity,
      part_location_id,
      target_asset_id,
      p_maintenance_record_id,
      case
        when part_movement_type = 'installation' then 'Instalado durante mantenimiento'
        else 'Consumido durante mantenimiento'
      end
    );
  end loop;

  return p_maintenance_record_id;
end;
$$;

revoke all on function public.get_maintenance_inventory_options(uuid) from public, anon;
revoke all on function public.complete_maintenance_with_parts(uuid, uuid, text, text, text, numeric, timestamptz, date, jsonb) from public, anon;
revoke all on function public.complete_maintenance(uuid, uuid, text, text, text, numeric, timestamptz, date) from authenticated;
grant execute on function public.get_maintenance_inventory_options(uuid) to authenticated;
grant execute on function public.complete_maintenance_with_parts(uuid, uuid, text, text, text, numeric, timestamptz, date, jsonb) to authenticated;
