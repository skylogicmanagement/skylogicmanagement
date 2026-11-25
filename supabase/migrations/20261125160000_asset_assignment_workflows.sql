create function public.sync_asset_responsible_assignment()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'UPDATE'
    and new.responsible_user_id is not distinct from old.responsible_user_id then
    return new;
  end if;

  update public.asset_assignments
  set ended_at = now()
  where org_id = new.org_id
    and asset_id = new.id
    and assignment_type = 'user'
    and ended_at is null;

  if new.responsible_user_id is not null then
    insert into public.asset_assignments (
      org_id, asset_id, assigned_user_id, assignment_type, reason
    ) values (
      new.org_id,
      new.id,
      new.responsible_user_id,
      'user',
      coalesce(nullif(current_setting('app.asset_assignment_reason', true), ''), 'Responsable de ficha')
    );
  end if;

  return new;
end;
$$;

create trigger sync_asset_responsible_assignment_changes
  after insert or update of responsible_user_id on public.assets
  for each row execute function public.sync_asset_responsible_assignment();

update public.asset_assignments aa
set ended_at = now()
where aa.assignment_type = 'user'
  and aa.ended_at is null
  and not exists (
    select 1
    from public.assets a
    where a.id = aa.asset_id
      and a.org_id = aa.org_id
      and a.responsible_user_id = aa.assigned_user_id
      and a.active
  );

insert into public.asset_assignments (
  org_id, asset_id, assigned_user_id, assignment_type, reason
)
select a.org_id, a.id, a.responsible_user_id, 'user', 'Sincronización inicial de responsable'
from public.assets a
where a.active
  and a.responsible_user_id is not null
  and not exists (
    select 1
    from public.asset_assignments aa
    where aa.org_id = a.org_id
      and aa.asset_id = a.id
      and aa.assignment_type = 'user'
      and aa.assigned_user_id = a.responsible_user_id
      and aa.ended_at is null
  );

create function public.assign_asset(
  p_org_id uuid,
  p_asset_id uuid,
  p_assignment_type text,
  p_assigned_asset_id uuid default null,
  p_assigned_user_id uuid default null,
  p_reason text default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  source_asset public.assets%rowtype;
  assigned_asset public.assets%rowtype;
  assignment_id uuid;
begin
  if auth.uid() is null or not public.has_org_permission(p_org_id, 'operations.manage') then
    raise exception 'Not authorized to assign assets for this organization';
  end if;

  if p_assignment_type is null or p_assignment_type not in ('asset', 'user') then
    raise exception 'Manual assignments must target a drone or a responsible user';
  end if;

  select * into source_asset
  from public.assets
  where id = p_asset_id and org_id = p_org_id and active
  for update;
  if not found then
    raise exception 'Active asset was not found';
  end if;
  if source_asset.status <> 'available' then
    raise exception 'Only available assets can receive a manual assignment';
  end if;
  if exists (
    select 1 from public.operation_assets
    where org_id = p_org_id and asset_id = p_asset_id and returned_at is null
  ) then
    raise exception 'An asset in an open operation cannot receive a manual assignment';
  end if;

  if p_assignment_type = 'user' then
    if p_assigned_user_id is null or p_assigned_asset_id is not null then
      raise exception 'Select exactly one active organization member';
    end if;
    if source_asset.responsible_user_id is not null then
      raise exception 'Close the current responsible assignment before assigning another';
    end if;
    if not exists (
      select 1 from public.memberships
      where org_id = p_org_id and user_id = p_assigned_user_id and active
    ) then
      raise exception 'Selected responsible person is not an active organization member';
    end if;

    perform set_config(
      'app.asset_assignment_reason',
      coalesce(nullif(btrim(p_reason), ''), 'Responsable de ficha'),
      true
    );
    update public.assets
    set responsible_user_id = p_assigned_user_id,
        updated_at = now()
    where id = p_asset_id and org_id = p_org_id;

    select id into assignment_id
    from public.asset_assignments
    where org_id = p_org_id
      and asset_id = p_asset_id
      and assignment_type = 'user'
      and assigned_user_id = p_assigned_user_id
      and ended_at is null
    order by started_at desc
    limit 1;
    if assignment_id is null then
      raise exception 'Responsible assignment was not recorded';
    end if;
    return assignment_id;
  end if;

  if p_assigned_asset_id is null or p_assigned_user_id is not null
    or p_assigned_asset_id = p_asset_id then
    raise exception 'Select one different drone as the parent asset';
  end if;
  if source_asset.asset_type_code = 'drone' then
    raise exception 'A drone cannot be assigned to another drone';
  end if;

  select * into assigned_asset
  from public.assets
  where id = p_assigned_asset_id and org_id = p_org_id and active
  for update;
  if not found or assigned_asset.asset_type_code <> 'drone' then
    raise exception 'The selected parent asset must be an active drone in this organization';
  end if;
  if assigned_asset.status <> 'available' then
    raise exception 'The selected drone must be available';
  end if;
  if exists (
    select 1 from public.operation_assets
    where org_id = p_org_id and asset_id = p_assigned_asset_id and returned_at is null
  ) then
    raise exception 'A drone in an open operation cannot receive a component';
  end if;
  if exists (
    select 1 from public.asset_assignments
    where org_id = p_org_id
      and asset_id = p_asset_id
      and assignment_type = 'asset'
      and ended_at is null
  ) then
    raise exception 'Close the current drone assignment before reassigning this asset';
  end if;

  insert into public.asset_assignments (
    org_id, asset_id, assigned_asset_id, assignment_type, reason
  ) values (
    p_org_id, p_asset_id, p_assigned_asset_id, 'asset', nullif(btrim(p_reason), '')
  )
  returning id into assignment_id;

  return assignment_id;
end;
$$;

create function public.end_asset_assignment(
  p_org_id uuid,
  p_assignment_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  current_assignment public.asset_assignments%rowtype;
begin
  if auth.uid() is null or not public.has_org_permission(p_org_id, 'operations.manage') then
    raise exception 'Not authorized to end asset assignments for this organization';
  end if;

  select * into current_assignment
  from public.asset_assignments
  where id = p_assignment_id and org_id = p_org_id and ended_at is null
  for update;
  if not found then
    raise exception 'Current assignment was not found';
  end if;

  if current_assignment.assignment_type = 'user' then
    update public.assets
    set responsible_user_id = null,
        updated_at = now()
    where id = current_assignment.asset_id
      and org_id = p_org_id
      and responsible_user_id = current_assignment.assigned_user_id;

    update public.asset_assignments
    set ended_at = now()
    where id = p_assignment_id
      and org_id = p_org_id
      and ended_at is null;
  else
    update public.asset_assignments
    set ended_at = now()
    where id = p_assignment_id
      and org_id = p_org_id
      and ended_at is null;
  end if;

  return p_assignment_id;
end;
$$;

revoke insert, update on public.asset_assignments from authenticated;
revoke all on function public.assign_asset(uuid, uuid, text, uuid, uuid, text) from public, anon;
revoke all on function public.end_asset_assignment(uuid, uuid) from public, anon;
grant select on public.asset_assignments to authenticated;
grant execute on function public.assign_asset(uuid, uuid, text, uuid, uuid, text) to authenticated;
grant execute on function public.end_asset_assignment(uuid, uuid) to authenticated;
