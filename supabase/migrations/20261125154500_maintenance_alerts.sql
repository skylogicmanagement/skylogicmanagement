create or replace function public.get_maintenance_alerts(p_org_id uuid)
returns table (
  asset_id uuid,
  asset_name text,
  internal_code text,
  asset_type_code text,
  plan_id uuid,
  plan_name text,
  interval_flight_hours numeric,
  hours_since_maintenance numeric,
  hours_remaining numeric,
  due_date date,
  days_remaining integer,
  alert_status text
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null
    or not (
      public.has_org_permission(p_org_id, 'maintenance.read')
      or public.has_org_permission(p_org_id, 'maintenance.manage')
    ) then
    raise exception 'Not authorized to consult maintenance alerts';
  end if;

  return query
  with plan_assets as (
    select
      a.id as asset_id,
      a.name as asset_name,
      a.internal_code,
      a.asset_type_code,
      a.acquired_at::date as acquired_on,
      p.id as plan_id,
      p.name as plan_name,
      p.interval_flight_hours,
      p.interval_days,
      d.hours_since_maintenance,
      latest.completed_at,
      latest.performed_at,
      latest.next_intervention_at
    from public.assets a
    join public.maintenance_plans p
      on p.org_id = a.org_id
      and p.asset_type_code = a.asset_type_code
      and p.active
    left join public.drone_details d
      on d.asset_id = a.id and d.org_id = a.org_id
    left join lateral (
      select mr.completed_at, mr.performed_at, mr.next_intervention_at
      from public.maintenance_records mr
      where mr.org_id = a.org_id
        and mr.asset_id = a.id
        and mr.plan_id = p.id
        and mr.status = 'completed'
      order by coalesce(mr.completed_at, mr.performed_at) desc
      limit 1
    ) latest on true
    where a.org_id = p_org_id
      and a.active
      and not exists (
        select 1
        from public.maintenance_records open_record
        where open_record.org_id = a.org_id
          and open_record.asset_id = a.id
          and open_record.status in ('open', 'in_progress')
      )
  ),
  scheduled as (
    select
      pa.*,
      coalesce(
        pa.next_intervention_at,
        case
          when pa.interval_days is not null and pa.completed_at is not null
            then pa.completed_at::date + pa.interval_days
          when pa.interval_days is not null and pa.performed_at is not null
            then pa.performed_at::date + pa.interval_days
          when pa.interval_days is not null and pa.acquired_on is not null
            then pa.acquired_on + pa.interval_days
          else null
        end
      ) as due_date,
      case
        when pa.asset_type_code = 'drone' and pa.interval_flight_hours is not null
          then pa.interval_flight_hours - pa.hours_since_maintenance
        else null
      end as hours_remaining
    from plan_assets pa
  ),
  measured as (
    select
      s.*,
      s.due_date - current_date as days_remaining
    from scheduled s
  )
  select
    measured.asset_id,
    measured.asset_name,
    measured.internal_code,
    measured.asset_type_code,
    measured.plan_id,
    measured.plan_name,
    measured.interval_flight_hours,
    measured.hours_since_maintenance,
    measured.hours_remaining,
    measured.due_date,
    measured.days_remaining,
    case
      when measured.hours_remaining < 0 or measured.days_remaining < 0 then 'overdue'
      when measured.hours_remaining = 0 or measured.days_remaining = 0 then 'due'
      when measured.hours_remaining is null and measured.due_date is null then 'untracked'
      else 'upcoming'
    end
  from measured
  where (
      measured.hours_remaining is not null
      and measured.hours_remaining <= measured.interval_flight_hours * 0.10
    )
    or (
      measured.due_date is not null
      and measured.due_date <= current_date + 7
    )
    or (
      measured.hours_remaining is null
      and measured.due_date is null
    )
  order by
    case
      when measured.hours_remaining < 0 or measured.days_remaining < 0 then 0
      when measured.hours_remaining = 0 or measured.days_remaining = 0 then 1
      when measured.hours_remaining is null and measured.due_date is null then 3
      else 2
    end,
    measured.due_date nulls last,
    measured.hours_remaining nulls last;
end;
$$;

revoke all on function public.get_maintenance_alerts(uuid) from public, anon;
grant execute on function public.get_maintenance_alerts(uuid) to authenticated;
