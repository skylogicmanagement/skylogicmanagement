drop policy if exists assets_read on public.assets;
create policy assets_read on public.assets for select to authenticated
  using (
    public.has_org_permission(org_id, 'assets.read')
    or public.has_org_permission(org_id, 'reports.read')
  );

drop policy if exists farms_read on public.farms;
create policy farms_read on public.farms for select to authenticated
  using (
    public.has_org_permission(org_id, 'operations.read')
    or public.has_org_permission(org_id, 'operations.manage')
    or public.has_org_permission(org_id, 'reports.read')
  );

drop policy if exists operations_read on public.operations;
create policy operations_read on public.operations for select to authenticated
  using (
    public.has_org_permission(org_id, 'operations.read')
    or public.has_org_permission(org_id, 'operations.manage')
    or public.has_org_permission(org_id, 'reports.read')
  );

drop policy if exists flight_logs_read on public.flight_logs;
create policy flight_logs_read on public.flight_logs for select to authenticated
  using (
    public.has_org_permission(org_id, 'assets.read')
    or public.has_org_permission(org_id, 'reports.read')
  );
