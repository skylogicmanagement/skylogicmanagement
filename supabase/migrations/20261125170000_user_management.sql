create table public.organization_user_contacts (
  org_id uuid not null,
  user_id uuid not null,
  email text not null check (btrim(email) <> ''),
  created_at timestamptz not null default now(),
  primary key (org_id, user_id),
  foreign key (org_id, user_id) references public.memberships(org_id, user_id) on delete cascade
);

alter table public.organization_user_contacts enable row level security;
alter table public.organization_user_contacts force row level security;

create policy organization_user_contacts_read on public.organization_user_contacts
  for select to authenticated
  using (public.has_org_permission(org_id, 'users.manage'));

revoke insert, update, delete on public.memberships from authenticated;
grant select on public.memberships to authenticated;
revoke all on public.organization_user_contacts from anon, authenticated;
grant select on public.organization_user_contacts to authenticated;

insert into public.organization_user_contacts (org_id, user_id, email)
select m.org_id, m.user_id, lower(u.email)
from public.memberships m
join auth.users u on u.id = m.user_id
where u.email is not null
on conflict (org_id, user_id) do update set email = excluded.email;

create or replace function public.create_org_membership(
  p_org_id uuid,
  p_user_id uuid,
  p_role_id uuid,
  p_display_name text,
  p_phone text,
  p_email text
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  membership_id uuid;
begin
  if auth.uid() is null or not public.has_org_permission(p_org_id, 'users.manage') then
    raise exception 'Not authorized to manage users for this organization';
  end if;

  if p_user_id is null
    or nullif(btrim(p_display_name), '') is null
    or nullif(btrim(p_email), '') is null
    or not exists (
      select 1
      from auth.users u
      where u.id = p_user_id and lower(u.email) = lower(btrim(p_email))
    )
    or not exists (
      select 1 from public.roles r where r.id = p_role_id and r.org_id = p_org_id
    ) then
    raise exception 'A valid user, organization role, name, and email are required';
  end if;

  insert into public.memberships (org_id, user_id, role_id, active)
  values (p_org_id, p_user_id, p_role_id, true)
  on conflict (org_id, user_id) do update
    set role_id = excluded.role_id, active = true
  returning id into membership_id;

  insert into public.user_profiles (org_id, user_id, display_name, phone)
  values (p_org_id, p_user_id, btrim(p_display_name), nullif(btrim(p_phone), ''))
  on conflict (org_id, user_id) do update
    set display_name = excluded.display_name,
        phone = excluded.phone,
        updated_at = now();

  insert into public.organization_user_contacts (org_id, user_id, email)
  values (p_org_id, p_user_id, lower(btrim(p_email)))
  on conflict (org_id, user_id) do update set email = excluded.email;

  return membership_id;
end;
$$;

create or replace function public.update_org_membership(
  p_org_id uuid,
  p_membership_id uuid,
  p_role_id uuid,
  p_active boolean
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  target_user_id uuid;
  target_role_id uuid;
  target_active boolean;
begin
  if auth.uid() is null or not public.has_org_permission(p_org_id, 'users.manage') then
    raise exception 'Not authorized to manage users for this organization';
  end if;

  if not exists (
    select 1 from public.roles r where r.id = p_role_id and r.org_id = p_org_id
  ) then
    raise exception 'Selected role does not belong to this organization';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_org_id::text, 0));

  if not public.has_org_permission(p_org_id, 'users.manage') then
    raise exception 'Your user-management permission is no longer active';
  end if;

  select m.user_id, m.role_id, m.active
  into target_user_id, target_role_id, target_active
  from public.memberships m
  where m.id = p_membership_id and m.org_id = p_org_id
  for update;

  if target_user_id is null then
    raise exception 'Organization membership was not found';
  end if;

  if target_user_id = auth.uid()
    and (not p_active or p_role_id <> target_role_id) then
    raise exception 'You cannot deactivate or change your own role';
  end if;

  if target_active and (
    not p_active
    or p_role_id <> target_role_id
  ) and exists (
    select 1
    from public.role_permissions rp
    where rp.org_id = p_org_id
      and rp.role_id = target_role_id
      and rp.permission_code = 'users.manage'
  ) and not exists (
    select 1
    from public.memberships m
    join public.role_permissions rp on rp.org_id = m.org_id and rp.role_id = m.role_id
    where m.org_id = p_org_id
      and m.active
      and m.id <> p_membership_id
      and rp.permission_code = 'users.manage'
  ) then
    raise exception 'The organization must retain at least one active user administrator';
  end if;

  update public.memberships
  set role_id = p_role_id, active = p_active
  where id = p_membership_id and org_id = p_org_id;
end;
$$;

revoke all on function public.create_org_membership(uuid, uuid, uuid, text, text, text) from public, anon;
grant execute on function public.create_org_membership(uuid, uuid, uuid, text, text, text) to authenticated;
revoke all on function public.update_org_membership(uuid, uuid, uuid, boolean) from public, anon;
grant execute on function public.update_org_membership(uuid, uuid, uuid, boolean) to authenticated;
