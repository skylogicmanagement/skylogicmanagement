create or replace function public.update_asset_profile(
  p_org_id uuid,
  p_asset_id uuid,
  p_internal_code text,
  p_name text,
  p_serial_number text,
  p_brand text,
  p_model text,
  p_acquired_at date,
  p_supplier_id uuid,
  p_acquisition_value numeric,
  p_location_id uuid,
  p_responsible_user_id uuid,
  p_notes text,
  p_battery_charge_cycles integer default null,
  p_battery_technical_notes text default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  current_asset public.assets%rowtype;
begin
  if auth.uid() is null or not public.has_org_permission(p_org_id, 'assets.manage') then
    raise exception 'Not authorized to edit assets for this organization';
  end if;
  if nullif(trim(p_internal_code), '') is null
    or nullif(trim(p_name), '') is null then
    raise exception 'Internal code and asset name are required';
  end if;
  if p_acquisition_value is not null and p_acquisition_value < 0 then
    raise exception 'Acquisition value cannot be negative';
  end if;
  if p_battery_charge_cycles is not null and p_battery_charge_cycles < 0 then
    raise exception 'Battery charge cycles cannot be negative';
  end if;

  select * into current_asset
  from public.assets
  where id = p_asset_id and org_id = p_org_id and active
  for update;
  if not found then
    raise exception 'Active asset not found';
  end if;

  if p_location_id is distinct from current_asset.location_id
    and p_location_id is not null and not exists (
    select 1 from public.locations
    where id = p_location_id and org_id = p_org_id and active
  ) then
    raise exception 'Selected location is inactive or does not belong to this organization';
  end if;
  if p_supplier_id is distinct from current_asset.supplier_id
    and p_supplier_id is not null and not exists (
    select 1 from public.suppliers
    where id = p_supplier_id and org_id = p_org_id and active
  ) then
    raise exception 'Selected supplier is inactive or does not belong to this organization';
  end if;
  if p_responsible_user_id is distinct from current_asset.responsible_user_id
    and p_responsible_user_id is not null and not exists (
    select 1 from public.memberships
    where org_id = p_org_id
      and user_id = p_responsible_user_id
      and active
  ) then
    raise exception 'Selected responsible person is not an active organization member';
  end if;

  if exists (
    select 1 from public.operation_assets
    where org_id = p_org_id
      and asset_id = p_asset_id
      and returned_at is null
  ) and (
    p_location_id is distinct from current_asset.location_id
    or p_responsible_user_id is distinct from current_asset.responsible_user_id
  ) then
    raise exception 'Location or responsible person cannot be edited while the asset is in an open operation';
  end if;

  update public.assets
  set internal_code = trim(p_internal_code),
      name = trim(p_name),
      serial_number = nullif(trim(p_serial_number), ''),
      brand = nullif(trim(p_brand), ''),
      model = nullif(trim(p_model), ''),
      acquired_at = p_acquired_at,
      supplier_id = p_supplier_id,
      acquisition_value = p_acquisition_value,
      location_id = p_location_id,
      responsible_user_id = p_responsible_user_id,
      notes = nullif(trim(p_notes), ''),
      updated_at = now()
  where id = p_asset_id and org_id = p_org_id;

  if current_asset.asset_type_code = 'battery' then
    update public.battery_details
    set charge_cycles = p_battery_charge_cycles,
        technical_notes = nullif(trim(p_battery_technical_notes), '')
    where asset_id = p_asset_id and org_id = p_org_id;
  elsif p_battery_charge_cycles is not null or p_battery_technical_notes is not null then
    raise exception 'Battery technical details can only be updated for battery assets';
  end if;

  return p_asset_id;
end;
$$;

revoke all on function public.update_asset_profile(uuid, uuid, text, text, text, text, text, date, uuid, numeric, uuid, uuid, text, integer, text) from public, anon;
grant execute on function public.update_asset_profile(uuid, uuid, text, text, text, text, text, date, uuid, numeric, uuid, uuid, text, integer, text) to authenticated;
