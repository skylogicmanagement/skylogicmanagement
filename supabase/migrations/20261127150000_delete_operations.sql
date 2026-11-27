create or replace function public.reject_business_delete()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if current_setting('app.allow_operation_history_delete', true) = 'on' then
    return old;
  end if;
  raise exception 'Historical records cannot be deleted; deactivate or record a correction instead';
end;
$$;

create or replace function public.reject_flight_log_mutation()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'DELETE' and current_setting('app.allow_operation_history_delete', true) = 'on' then
    return old;
  end if;
  raise exception 'Confirmed flight-hour records cannot be changed or deleted';
end;
$$;

create or replace function public.guard_drone_hours()
returns trigger
language plpgsql
as $$
begin
  if current_setting('app.allow_operation_history_delete', true) = 'on' then
    return new;
  end if;
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

create function public.delete_operation_with_history(p_org_id uuid, p_operation_id uuid)
returns text[]
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  operation_row public.operations%rowtype;
  drone_row record;
  current_total numeric;
  current_since_maintenance numeric;
  document_paths text[];
begin
  if auth.uid() is null or not public.has_org_permission(p_org_id, 'operations.manage') then
    raise exception 'Not authorized to delete operations';
  end if;

  perform oa.id
  from public.operation_assets oa
  where oa.operation_id = p_operation_id and oa.org_id = p_org_id
  order by oa.id
  for update;

  perform aa.id
  from public.asset_assignments aa
  where aa.operation_id = p_operation_id and aa.org_id = p_org_id
  order by aa.id
  for update;

  select * into operation_row
  from public.operations
  where id = p_operation_id and org_id = p_org_id
  for update;
  if not found then
    raise exception 'Operation was not found';
  end if;

  if exists (
    select 1 from public.operation_assets
    where operation_id = p_operation_id and org_id = p_org_id and returned_at is null
  ) or exists (
    select 1 from public.asset_assignments
    where operation_id = p_operation_id and org_id = p_org_id and ended_at is null
  ) then
    raise exception 'Return all operation assets before deleting the operation';
  end if;

  select coalesce(array_agg(storage_path), array[]::text[])
  into document_paths
  from public.documents
  where operation_id = p_operation_id and org_id = p_org_id;

  perform set_config('app.allow_operation_history_delete', 'on', true);

  perform dd.asset_id
  from public.drone_details dd
  where dd.org_id = p_org_id
    and dd.asset_id in (
      select fl.drone_asset_id
      from public.flight_logs fl
      where fl.operation_id = p_operation_id and fl.org_id = p_org_id
    )
  order by dd.asset_id
  for update;

  for drone_row in
    select
      fl.drone_asset_id,
      sum(fl.flight_hours) as removed_total,
      coalesce(sum(fl.flight_hours) filter (
        where fl.logged_at >= coalesce((
          select max(coalesce(m.completed_at, m.performed_at))
          from public.maintenance_records m
          where m.asset_id = fl.drone_asset_id
            and m.org_id = p_org_id
            and m.status = 'completed'
        ), '-infinity'::timestamptz)
      ), 0) as removed_since_maintenance
    from public.flight_logs fl
    where fl.operation_id = p_operation_id and fl.org_id = p_org_id
    group by fl.drone_asset_id
  loop
    select total_flight_hours, hours_since_maintenance
    into current_total, current_since_maintenance
    from public.drone_details
    where asset_id = drone_row.drone_asset_id and org_id = p_org_id
    for update;
    if not found
      or current_total is null
      or current_since_maintenance is null
      or current_total < drone_row.removed_total
      or current_since_maintenance < drone_row.removed_since_maintenance then
      raise exception 'Drone flight-hour totals are inconsistent; operation was not deleted';
    end if;

    update public.drone_details
    set total_flight_hours = current_total - drone_row.removed_total,
        hours_since_maintenance = current_since_maintenance - drone_row.removed_since_maintenance
    where asset_id = drone_row.drone_asset_id and org_id = p_org_id;
  end loop;

  delete from public.flight_logs
  where operation_id = p_operation_id and org_id = p_org_id;
  delete from public.operation_assets
  where operation_id = p_operation_id and org_id = p_org_id;
  delete from public.asset_assignments
  where operation_id = p_operation_id and org_id = p_org_id;
  delete from public.documents
  where operation_id = p_operation_id and org_id = p_org_id;
  delete from public.operations
  where id = p_operation_id and org_id = p_org_id;

  return document_paths;
end;
$$;

revoke all on function public.delete_operation_with_history(uuid, uuid) from public, anon, authenticated;
grant execute on function public.delete_operation_with_history(uuid, uuid) to authenticated;

create function public.can_delete_removed_operation_document(p_storage_path text)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public, storage, pg_temp
as $$
  select auth.uid() is not null
    and not exists (
      select 1 from public.documents d where d.storage_path = p_storage_path
    )
    and exists (
      select 1
      from public.audit_events ae
      where ae.entity_table = 'documents'
        and ae.event_type = 'delete'
        and ae.before_state ->> 'storage_path' = p_storage_path
        and ae.before_state ->> 'operation_id' is not null
        and ae.org_id::text = (storage.foldername(p_storage_path))[1]
        and public.has_org_permission(ae.org_id, 'operations.manage')
    );
$$;

revoke all on function public.can_delete_removed_operation_document(text) from public, anon;
grant execute on function public.can_delete_removed_operation_document(text) to authenticated;

drop policy if exists sky_logic_deleted_operation_files_delete on storage.objects;
create policy sky_logic_deleted_operation_files_delete on storage.objects for delete to authenticated
  using (
    bucket_id = 'sky-logic-private'
    and public.can_delete_removed_operation_document(name)
  );
