drop policy if exists maintenance_records_read on public.maintenance_records;
create policy maintenance_records_read on public.maintenance_records for select to authenticated
  using (
    public.has_org_permission(org_id, 'maintenance.read')
    or public.has_org_permission(org_id, 'maintenance.manage')
    or public.has_org_permission(org_id, 'reports.read')
  );

drop policy if exists maintenance_types_read on public.maintenance_types;
create policy maintenance_types_read on public.maintenance_types for select to authenticated
  using (
    public.has_org_permission(org_id, 'maintenance.read')
    or public.has_org_permission(org_id, 'maintenance.manage')
    or public.has_org_permission(org_id, 'reports.read')
  );

create index if not exists maintenance_records_org_performed_idx
  on public.maintenance_records (org_id, performed_at desc);
