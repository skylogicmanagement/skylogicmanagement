create or replace function public.guard_operation_completion()
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
    or (old.status = 'cancelled' and (
      new.farm_id is distinct from old.farm_id
      or new.municipality is distinct from old.municipality
      or new.field_location is distinct from old.field_location
      or new.notes is distinct from old.notes
    ))
    or new.operator_user_id is distinct from old.operator_user_id
    or new.responsible_user_id is distinct from old.responsible_user_id
    or new.delivered_by_user_id is distinct from old.delivered_by_user_id
    or new.received_by_user_id is distinct from old.received_by_user_id
    or new.departure_at is distinct from old.departure_at
    or new.returned_at is distinct from old.returned_at
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
