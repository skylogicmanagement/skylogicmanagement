alter table public.documents
  add column inventory_item_id uuid;

alter table public.documents
  drop constraint if exists documents_check,
  add constraint documents_single_parent_check
    check (num_nonnulls(asset_id, operation_id, maintenance_record_id, inventory_item_id) = 1),
  add constraint documents_inventory_item_fk
    foreign key (inventory_item_id, org_id) references public.inventory_items(id, org_id);

create index documents_asset_uploaded_idx
  on public.documents (asset_id, uploaded_at desc)
  where asset_id is not null;
create index documents_maintenance_uploaded_idx
  on public.documents (maintenance_record_id, uploaded_at desc)
  where maintenance_record_id is not null;
create index documents_inventory_uploaded_idx
  on public.documents (inventory_item_id, uploaded_at desc)
  where inventory_item_id is not null;

drop policy if exists documents_read on public.documents;
create policy documents_read on public.documents for select to authenticated
  using (
    (asset_id is not null and (
      public.has_org_permission(org_id, 'assets.read')
      or public.has_org_permission(org_id, 'assets.manage')
    ))
    or (operation_id is not null and (
      public.has_org_permission(org_id, 'operations.read')
      or public.has_org_permission(org_id, 'operations.manage')
    ))
    or (maintenance_record_id is not null and (
      public.has_org_permission(org_id, 'maintenance.read')
      or public.has_org_permission(org_id, 'maintenance.manage')
    ))
    or (inventory_item_id is not null and (
      public.has_org_permission(org_id, 'inventory.read')
      or public.has_org_permission(org_id, 'inventory.manage')
    ))
  );

drop policy if exists documents_insert on public.documents;
create policy documents_insert on public.documents for insert to authenticated
  with check (
    uploaded_by = auth.uid()
    and (storage.foldername(storage_path))[1] = org_id::text
    and (storage.foldername(storage_path))[2] = auth.uid()::text
    and (
      (asset_id is not null and public.has_org_permission(org_id, 'assets.manage'))
      or (operation_id is not null and public.has_org_permission(org_id, 'operations.manage'))
      or (maintenance_record_id is not null and public.has_org_permission(org_id, 'maintenance.manage'))
      or (inventory_item_id is not null and public.has_org_permission(org_id, 'inventory.manage'))
    )
  );

drop policy if exists sky_logic_files_read on storage.objects;
create policy sky_logic_files_read on storage.objects for select to authenticated
  using (
    bucket_id = 'sky-logic-private'
    and exists (
      select 1
      from public.documents d
      where d.storage_path = name
        and d.org_id::text = (storage.foldername(name))[1]
        and (
          (d.asset_id is not null and (
            public.has_org_permission(d.org_id, 'assets.read')
            or public.has_org_permission(d.org_id, 'assets.manage')
          ))
          or (d.operation_id is not null and (
            public.has_org_permission(d.org_id, 'operations.read')
            or public.has_org_permission(d.org_id, 'operations.manage')
          ))
          or (d.maintenance_record_id is not null and (
            public.has_org_permission(d.org_id, 'maintenance.read')
            or public.has_org_permission(d.org_id, 'maintenance.manage')
          ))
          or (d.inventory_item_id is not null and (
            public.has_org_permission(d.org_id, 'inventory.read')
            or public.has_org_permission(d.org_id, 'inventory.manage')
          ))
        )
    )
  );

drop policy if exists sky_logic_files_insert on storage.objects;
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
          or public.has_org_permission(m.org_id, 'inventory.manage')
        )
    )
    and (storage.foldername(name))[2] = auth.uid()::text
  );

create or replace function public.is_owned_unattached_file(p_storage_path text)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public, storage, pg_temp
as $$
  select auth.uid() is not null
    and (storage.foldername(p_storage_path))[2] = auth.uid()::text
    and not exists (
      select 1 from public.documents d where d.storage_path = p_storage_path
    );
$$;

revoke all on function public.is_owned_unattached_file(text) from public, anon;
grant execute on function public.is_owned_unattached_file(text) to authenticated;

drop policy if exists sky_logic_files_delete_orphan on storage.objects;
create policy sky_logic_files_delete_orphan on storage.objects for delete to authenticated
  using (
    bucket_id = 'sky-logic-private'
    and public.is_owned_unattached_file(name)
    and (storage.foldername(name))[1] in (
      select m.org_id::text
      from public.memberships m
      where m.user_id = auth.uid()
        and m.active
        and (
          public.has_org_permission(m.org_id, 'assets.manage')
          or public.has_org_permission(m.org_id, 'operations.manage')
          or public.has_org_permission(m.org_id, 'maintenance.manage')
          or public.has_org_permission(m.org_id, 'inventory.manage')
        )
    )
  );
