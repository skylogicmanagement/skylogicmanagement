import { useCallback, useEffect, useMemo, useState } from 'react'
import { AlertTriangle, CalendarClock, Check, ClipboardCheck, Paperclip, Plus, RefreshCw, Trash2, Wrench, X } from 'lucide-react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { supabase } from '../../lib/supabase'
import { DocumentAttachments } from '../documents/DocumentAttachments'
import './maintenance.css'

type Asset = { id: string; internal_code: string; name: string; asset_type_code: string; status: string }
type AssetType = { code: string; name: string }
type MaintenanceType = { code: string; name: string }
type MaintenancePlan = {
  id: string
  asset_type_code: string
  name: string
  interval_flight_hours: number | null
  interval_days: number | null
}
type MaintenanceRecord = {
  id: string
  asset_id: string
  plan_id: string | null
  maintenance_type: string
  status: 'open' | 'in_progress' | 'completed' | 'cancelled'
  performed_at: string
  completed_at: string | null
  technician_user_id: string | null
  external_company: string | null
  external_technician: string | null
  diagnosis: string | null
  activities: string | null
  outcome: string | null
  cost: number | null
  next_intervention_at: string | null
  notes: string | null
}
type Member = { user_id: string; display_name: string }
type StatusOption = { code: string; name: string }
type InventoryOption = {
  item_id: string
  internal_code: string
  item_name: string
  unit: string
  is_serialized: boolean
  location_id: string
  location_name: string
  quantity_available: number
}
type MaintenancePartDraft = {
  stock_key: string
  quantity: string
  movement_type: 'installation' | 'consumption'
}
type MaintenanceAlert = {
  asset_id: string
  asset_name: string
  internal_code: string
  asset_type_code: string
  plan_id: string
  plan_name: string
  interval_flight_hours: number | null
  hours_since_maintenance: number | null
  hours_remaining: number | null
  due_date: string | null
  days_remaining: number | null
  alert_status: 'overdue' | 'due' | 'upcoming' | 'untracked'
}

function stockKey(option: InventoryOption) {
  return `${option.item_id}:${option.location_id}`
}

const releaseStatuses = ['available', 'inspection', 'damaged', 'repair', 'out_of_service']

function localDateTimeValue() {
  const date = new Date(Date.now() - new Date().getTimezoneOffset() * 60_000)
  return date.toISOString().slice(0, 16)
}

function formatDate(value: string | null) {
  if (!value) return 'Sin programar'
  return new Intl.DateTimeFormat('es-CO', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value))
}

function formatCurrency(value: number | null) {
  if (value === null) return 'Sin costo registrado'
  return new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(value)
}

function statusLabel(status: MaintenanceRecord['status']) {
  if (status === 'completed') return 'Finalizado'
  if (status === 'cancelled') return 'Cancelado'
  if (status === 'in_progress') return 'En progreso'
  return 'Abierto'
}

export function MaintenancePage() {
  const reduceMotion = useReducedMotion()
  const [orgId, setOrgId] = useState('')
  const [assets, setAssets] = useState<Asset[]>([])
  const [assetTypes, setAssetTypes] = useState<AssetType[]>([])
  const [maintenanceTypes, setMaintenanceTypes] = useState<MaintenanceType[]>([])
  const [plans, setPlans] = useState<MaintenancePlan[]>([])
  const [maintenanceAlerts, setMaintenanceAlerts] = useState<MaintenanceAlert[]>([])
  const [records, setRecords] = useState<MaintenanceRecord[]>([])
  const [members, setMembers] = useState<Member[]>([])
  const [assetStatuses, setAssetStatuses] = useState<StatusOption[]>([])
  const [inventoryOptions, setInventoryOptions] = useState<InventoryOption[]>([])
  const [inventoryOptionsError, setInventoryOptionsError] = useState('')
  const [canManage, setCanManage] = useState(false)
  const [canManagePlans, setCanManagePlans] = useState(false)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [query, setQuery] = useState('')
  const [createOpen, setCreateOpen] = useState(false)
  const [planOpen, setPlanOpen] = useState(false)
  const [completing, setCompleting] = useState<MaintenanceRecord | null>(null)
  const [attachmentsRecord, setAttachmentsRecord] = useState<MaintenanceRecord | null>(null)
  const [assetNames, setAssetNames] = useState<Record<string, string>>({})
  const [draft, setDraft] = useState({
    asset_id: '',
    maintenance_type: '',
    plan_id: '',
    performed_at: localDateTimeValue(),
    technician_user_id: '',
    external_company: '',
    external_technician: '',
    diagnosis: '',
    notes: '',
  })
  const [planDraft, setPlanDraft] = useState({
    asset_type_code: '',
    name: '',
    interval_flight_hours: '',
    interval_days: '',
  })
  const [completionDraft, setCompletionDraft] = useState({
    activities: '',
    outcome: '',
    release_asset_status: 'available',
    cost: '',
    next_intervention_at: '',
    parts: [] as MaintenancePartDraft[],
  })

  const loadData = useCallback(async () => {
    if (!supabase) return
    setError('')
    const { data: authData, error: authError } = await supabase.auth.getUser()
    if (authError || !authData.user) {
      setError(authError?.message ?? 'No se encontró la sesión activa.')
      setLoading(false)
      return
    }
    const currentUserId = authData.user.id
    const { data: membership, error: membershipError } = await supabase
      .from('memberships')
      .select('org_id')
      .eq('user_id', currentUserId)
      .eq('active', true)
      .limit(1)
      .maybeSingle()
    if (membershipError || !membership) {
      setError(membershipError?.message ?? 'Tu cuenta no tiene una membresía activa.')
      setLoading(false)
      return
    }

    const currentOrgId = membership.org_id
    setOrgId(currentOrgId)
    const [
      assetsResult,
      assetTypesResult,
      maintenanceTypesResult,
      plansResult,
      recordsResult,
      alertsResult,
      membershipsResult,
      profilesResult,
      assetStatusesResult,
      managePermission,
      catalogPermission,
    ] = await Promise.all([
      supabase.from('assets')
        .select('id, internal_code, name, asset_type_code, status')
        .eq('org_id', currentOrgId)
        .eq('active', true)
        .order('internal_code'),
      supabase.from('asset_types')
        .select('code, name')
        .eq('org_id', currentOrgId)
        .eq('active', true)
        .order('name'),
      supabase.from('maintenance_types')
        .select('code, name')
        .eq('org_id', currentOrgId)
        .eq('active', true)
        .order('name'),
      supabase.from('maintenance_plans')
        .select('id, asset_type_code, name, interval_flight_hours, interval_days')
        .eq('org_id', currentOrgId)
        .eq('active', true)
        .order('name'),
      supabase.from('maintenance_records')
        .select('id, asset_id, plan_id, maintenance_type, status, performed_at, completed_at, technician_user_id, external_company, external_technician, diagnosis, activities, outcome, cost, next_intervention_at, notes')
        .eq('org_id', currentOrgId)
        .order('performed_at', { ascending: false })
        .limit(100),
      supabase.rpc('get_maintenance_alerts', { p_org_id: currentOrgId }),
      supabase.from('memberships')
        .select('user_id')
        .eq('org_id', currentOrgId)
        .eq('active', true),
      supabase.from('user_profiles')
        .select('user_id, display_name')
        .eq('org_id', currentOrgId),
      supabase.from('asset_statuses')
        .select('code, name')
        .eq('org_id', currentOrgId)
        .eq('active', true)
        .in('code', releaseStatuses),
      supabase.rpc('has_org_permission', { target_org: currentOrgId, permission: 'maintenance.manage' }),
      supabase.rpc('has_org_permission', { target_org: currentOrgId, permission: 'catalogs.manage' }),
    ])
    const firstError = assetsResult.error
      ?? assetTypesResult.error
      ?? maintenanceTypesResult.error
      ?? plansResult.error
      ?? recordsResult.error
      ?? alertsResult.error
      ?? membershipsResult.error
      ?? profilesResult.error
      ?? assetStatusesResult.error
      ?? managePermission.error
      ?? catalogPermission.error
    if (firstError) {
      setError(firstError.message)
      setLoading(false)
      return
    }

    const assetRows = assetsResult.data ?? []
    setAssets(assetRows)
    setAssetNames(Object.fromEntries(assetRows.map((asset) => [asset.id, `${asset.name} · ${asset.internal_code}`])))
    setAssetTypes(assetTypesResult.data ?? [])
    setMaintenanceTypes(maintenanceTypesResult.data ?? [])
    setPlans(plansResult.data ?? [])
    setRecords(recordsResult.data ?? [])
    setMaintenanceAlerts(alertsResult.data ?? [])
    const profileNames = new Map((profilesResult.data ?? []).map((profile) => [profile.user_id, profile.display_name]))
    setMembers((membershipsResult.data ?? []).map(({ user_id }) => ({
      user_id,
      display_name: profileNames.get(user_id) ?? 'Usuario sin nombre registrado',
    })))
    setAssetStatuses(assetStatusesResult.data ?? [])
    setCanManage(managePermission.data === true)
    setCanManagePlans(catalogPermission.data === true)
    if (managePermission.data) {
      const { data: inventoryData, error: inventoryError } = await supabase.rpc('get_maintenance_inventory_options', { p_org_id: currentOrgId })
      if (inventoryError) {
        setInventoryOptions([])
        setInventoryOptionsError(inventoryError.message)
      } else {
        setInventoryOptions(inventoryData ?? [])
        setInventoryOptionsError('')
      }
    } else {
      setInventoryOptions([])
      setInventoryOptionsError('')
    }
    setLoading(false)
  }, [])

  useEffect(() => {
    const task = window.setTimeout(() => void loadData(), 0)
    return () => window.clearTimeout(task)
  }, [loadData])

  useEffect(() => {
    const client = supabase
    if (!client || !orgId) return
    const channel = client
      .channel(`maintenance-${orgId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'maintenance_records', filter: `org_id=eq.${orgId}` }, () => void loadData())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'maintenance_plans', filter: `org_id=eq.${orgId}` }, () => void loadData())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'assets', filter: `org_id=eq.${orgId}` }, () => void loadData())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'drone_details', filter: `org_id=eq.${orgId}` }, () => void loadData())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'inventory_items', filter: `org_id=eq.${orgId}` }, () => void loadData())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'inventory_movements', filter: `org_id=eq.${orgId}` }, () => void loadData())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'inventory_location_balances', filter: `org_id=eq.${orgId}` }, () => void loadData())
      .subscribe((status, subscriptionError) => {
        if ((status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') && subscriptionError) {
          setError(subscriptionError.message)
        }
      })
    return () => {
      void client.removeChannel(channel)
    }
  }, [loadData, orgId])

  const filteredRecords = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase()
    if (!normalized) return records
    return records.filter((record) => [
      assetNames[record.asset_id],
      record.diagnosis,
      record.activities,
      record.external_company,
      record.external_technician,
      record.maintenance_type,
    ].some((value) => value?.toLocaleLowerCase().includes(normalized)))
  }, [assetNames, query, records])
  const openCount = records.filter((record) => record.status === 'open' || record.status === 'in_progress').length
  const completedCount = records.filter((record) => record.status === 'completed').length
  const unavailableCount = assets.filter((asset) => asset.status === 'maintenance' || asset.status === 'repair').length
  const urgentAlertCount = maintenanceAlerts.filter((alert) => alert.alert_status === 'overdue' || alert.alert_status === 'due').length
  const selectedAsset = assets.find((asset) => asset.id === draft.asset_id)
  const filteredPlans = plans.filter((plan) => plan.asset_type_code === selectedAsset?.asset_type_code)
  const memberNames = new Map(members.map((member) => [member.user_id, member.display_name]))
  const stockOptions = new Map(inventoryOptions.map((option) => [stockKey(option), option]))
  const incompleteParts = completionDraft.parts.some((part) =>
    !part.stock_key || !stockOptions.has(part.stock_key) || !Number.isFinite(Number(part.quantity)) || Number(part.quantity) <= 0)

  async function createMaintenance(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!supabase || !orgId) return
    setSaving(true)
    setError('')
    setNotice('')
    const { error: createError } = await supabase.rpc('start_maintenance', {
      p_org_id: orgId,
      p_asset_id: draft.asset_id,
      p_maintenance_type: draft.maintenance_type,
      p_plan_id: draft.plan_id || null,
      p_performed_at: new Date(draft.performed_at).toISOString(),
      p_technician_user_id: draft.technician_user_id || null,
      p_external_company: draft.external_company.trim() || null,
      p_external_technician: draft.external_technician.trim() || null,
      p_diagnosis: draft.diagnosis.trim() || null,
      p_notes: draft.notes.trim() || null,
    })
    if (createError) {
      setError(createError.message)
    } else {
      setCreateOpen(false)
      setNotice('Mantenimiento creado; el activo quedó fuera de servicio hasta su cierre.')
      setDraft((current) => ({ ...current, diagnosis: '', notes: '', external_company: '', external_technician: '', plan_id: '' }))
      await loadData()
    }
    setSaving(false)
  }

  async function completeMaintenance(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!supabase || !orgId || !completing) return
    const parts: Array<{
      item_id: string
      source_location_id: string
      quantity: number
      movement_type: 'installation' | 'consumption'
    }> = []
    for (const part of completionDraft.parts) {
      const option = stockOptions.get(part.stock_key)
      if (!option) {
        setError('Selecciona un repuesto y ubicación válidos en cada línea.')
        return
      }
      parts.push({
        item_id: option.item_id,
        source_location_id: option.location_id,
        quantity: Number(part.quantity),
        movement_type: part.movement_type,
      })
    }
    setSaving(true)
    setError('')
    setNotice('')
    const { error: completeError } = await supabase.rpc('complete_maintenance_with_parts', {
      p_org_id: orgId,
      p_maintenance_record_id: completing.id,
      p_activities: completionDraft.activities.trim(),
      p_outcome: completionDraft.outcome.trim(),
      p_release_asset_status: completionDraft.release_asset_status,
      p_cost: completionDraft.cost === '' ? null : Number(completionDraft.cost),
      p_next_intervention_at: completionDraft.next_intervention_at || null,
      p_parts: parts,
    })
    if (completeError) {
      setError(completeError.message)
    } else {
      setCompleting(null)
      setNotice('Intervención finalizada; el resultado y el estado del activo quedaron registrados.')
      setCompletionDraft({ activities: '', outcome: '', release_asset_status: 'available', cost: '', next_intervention_at: '', parts: [] })
      await loadData()
    }
    setSaving(false)
  }

  async function createPlan(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!supabase || !orgId) return
    setSaving(true)
    setError('')
    const { error: planError } = await supabase.from('maintenance_plans').insert({
      org_id: orgId,
      asset_type_code: planDraft.asset_type_code,
      name: planDraft.name.trim(),
      interval_flight_hours: planDraft.interval_flight_hours === '' ? null : Number(planDraft.interval_flight_hours),
      interval_days: planDraft.interval_days === '' ? null : Number(planDraft.interval_days),
    })
    if (planError) {
      setError(planError.message)
    } else {
      setPlanOpen(false)
      setPlanDraft({ asset_type_code: '', name: '', interval_flight_hours: '', interval_days: '' })
      setNotice('Plan preventivo creado.')
      await loadData()
    }
    setSaving(false)
  }

  return (
    <motion.section className="maintenance-page" initial={reduceMotion ? false : { opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
      <div className="maintenance-toolbar">
        <div>
          <strong>Seguimiento técnico</strong>
          <span>Intervenciones y programación preventiva</span>
        </div>
        <div className="maintenance-actions">
          <input className="maintenance-search" aria-label="Buscar mantenimientos" placeholder="Buscar por equipo, técnico o diagnóstico" value={query} onChange={(event) => setQuery(event.target.value)} />
          <button className="icon-button" type="button" aria-label="Actualizar mantenimientos" onClick={() => { setLoading(true); void loadData() }} disabled={loading}><RefreshCw size={17} /></button>
          {canManagePlans && <button className="secondary-button" type="button" onClick={() => setPlanOpen(true)}><CalendarClock size={16} /> Nuevo plan</button>}
          {canManage && <button className="primary-button" type="button" onClick={() => setCreateOpen(true)}><Plus size={16} /> Registrar intervención</button>}
        </div>
      </div>

      {error && <div className="inline-error" role="alert"><AlertTriangle size={17} />{error}</div>}
      {notice && <div className="inline-success" role="status"><Check size={16} />{notice}</div>}

      <div className="maintenance-stats">
        <article><span className="maintenance-stat-icon maintenance-icon-blue"><Wrench size={17} /></span><div><strong>{loading ? '…' : openCount}</strong><small>Intervenciones abiertas</small></div></article>
        <article><span className="maintenance-stat-icon maintenance-icon-amber"><AlertTriangle size={17} /></span><div><strong>{loading ? '…' : unavailableCount}</strong><small>Activos en mantenimiento o reparación</small></div></article>
        <article><span className="maintenance-stat-icon maintenance-icon-green"><ClipboardCheck size={17} /></span><div><strong>{loading ? '…' : completedCount}</strong><small>Intervenciones finalizadas</small></div></article>
      </div>

      <section className="maintenance-section maintenance-alert-section">
        <div className="maintenance-section-heading">
          <div><h2><AlertTriangle size={15} /> Alertas preventivas</h2><p>Vencidas, próximas y pendientes de una referencia de cálculo</p></div>
          <span className={urgentAlertCount ? 'maintenance-alert-count' : ''}>{loading ? '…' : `${maintenanceAlerts.length} alertas`}</span>
        </div>
        {loading ? (
          <div className="maintenance-empty compact">Calculando próximos mantenimientos…</div>
        ) : maintenanceAlerts.length === 0 ? (
          <div className="maintenance-empty compact"><Check size={18} /><span>No hay mantenimientos próximos o vencidos con los intervalos configurados.</span></div>
        ) : (
          <div className="maintenance-alert-list">
            {maintenanceAlerts.map((alert) => {
              const details: string[] = []
              if (alert.hours_remaining !== null) {
                if (alert.hours_remaining < 0) details.push(`Vencido por ${Math.abs(alert.hours_remaining).toFixed(1)} h`)
                else if (alert.hours_remaining === 0) details.push('Alcanzó el intervalo de horas')
                else details.push(`${alert.hours_remaining.toFixed(1)} h restantes`)
              }
              if (alert.due_date && alert.days_remaining !== null) {
                if (alert.days_remaining < 0) details.push(`Vencido desde ${formatDate(alert.due_date)}`)
                else if (alert.days_remaining === 0) details.push('Programado para hoy')
                else details.push(`${alert.days_remaining} días · ${formatDate(alert.due_date)}`)
              }
              if (alert.alert_status === 'untracked') {
                details.push(alert.interval_flight_hours !== null
                  ? alert.asset_type_code === 'drone'
                    ? 'Faltan registros de horas de mantenimiento para calcular el intervalo'
                    : 'Las horas de operación de este tipo de activo no se registran en el sistema'
                  : 'Registra la fecha de adquisición o una intervención para calcular la fecha')
              }
              const statusLabel = alert.alert_status === 'overdue'
                ? 'Vencido'
                : alert.alert_status === 'due'
                  ? 'Requiere atención'
                  : alert.alert_status === 'upcoming'
                    ? 'Próximo'
                    : 'Sin referencia'
              return (
                <article className={`maintenance-alert-card maintenance-alert-${alert.alert_status}`} key={`${alert.asset_id}:${alert.plan_id}`}>
                  <span className="maintenance-alert-icon"><AlertTriangle size={17} /></span>
                  <div className="maintenance-alert-copy">
                    <div className="maintenance-alert-title"><strong>{alert.asset_name} · {alert.internal_code}</strong><span>{statusLabel}</span></div>
                    <p>{alert.plan_name}</p>
                    <small>{details.join(' · ')}</small>
                  </div>
                  {canManage && alert.alert_status !== 'untracked' && (
                    <button className="secondary-button" type="button" onClick={() => {
                      setDraft((current) => ({ ...current, asset_id: alert.asset_id, plan_id: alert.plan_id }))
                      setError('')
                      setCreateOpen(true)
                    }}>
                      <Wrench size={14} /> Registrar
                    </button>
                  )}
                </article>
              )
            })}
          </div>
        )}
      </section>

      <section className="maintenance-section">
        <div className="maintenance-section-heading"><div><h2>Historial de intervenciones</h2><p>Registro técnico por activo</p></div><span>{filteredRecords.length} registros</span></div>
        {loading ? (
          <div className="maintenance-empty">Cargando historial…</div>
        ) : filteredRecords.length === 0 ? (
          <div className="maintenance-empty"><Wrench size={22} /><strong>{records.length ? 'Sin coincidencias' : 'Aún no hay intervenciones'}</strong><span>Las intervenciones y reparaciones registradas aparecerán aquí.</span></div>
        ) : (
          <div className="maintenance-record-list">
            {filteredRecords.map((record, index) => {
              const isOpen = record.status === 'open' || record.status === 'in_progress'
              const technician = record.technician_user_id ? memberNames.get(record.technician_user_id) : null
              return (
                <motion.article className="maintenance-record-card" key={record.id} initial={reduceMotion ? false : { opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={reduceMotion ? { duration: 0 } : { delay: Math.min(index * 0.025, 0.18) }}>
                  <div className="maintenance-record-top">
                    <div className="maintenance-record-title">
                      <span className={`maintenance-record-status record-${record.status}`}>{statusLabel(record.status)}</span>
                      <h3>{assetNames[record.asset_id] ?? 'Activo'}</h3>
                      <p>{maintenanceTypes.find(({ code }) => code === record.maintenance_type)?.name ?? record.maintenance_type} · {formatDate(record.performed_at)}</p>
                    </div>
                    {isOpen && canManage && <button className="primary-button" type="button" onClick={() => { setCompletionDraft({ activities: '', outcome: '', release_asset_status: 'available', cost: '', next_intervention_at: '', parts: [] }); setError(''); setCompleting(record) }}><Check size={15} /> Finalizar</button>}
                  </div>
                  <div className="maintenance-record-details">
                    <div><small>Responsable técnico</small><span>{technician ?? record.external_technician ?? 'Sin asignar'}{record.external_company ? ` · ${record.external_company}` : ''}</span></div>
                    {record.diagnosis && <div><small>Diagnóstico</small><span>{record.diagnosis}</span></div>}
                    {record.activities && <div><small>Trabajo realizado</small><span>{record.activities}</span></div>}
                    {record.outcome && <div><small>Resultado</small><span>{record.outcome}</span></div>}
                    <div><small>Costo</small><span>{formatCurrency(record.cost)}</span></div>
                    {record.next_intervention_at && <div><small>Próxima intervención</small><span>{formatDate(record.next_intervention_at)}</span></div>}
                  </div>
                  <button className="secondary-button maintenance-attachments-button" type="button" onClick={() => setAttachmentsRecord(record)}><Paperclip size={14} /> Adjuntos</button>
                </motion.article>
              )
            })}
          </div>
        )}
      </section>

      <section className="maintenance-section">
        <div className="maintenance-section-heading"><div><h2>Planes preventivos</h2><p>Intervalos configurables por tipo de activo</p></div><span>{plans.length} planes</span></div>
        {plans.length === 0 ? (
          <div className="maintenance-empty compact"><CalendarClock size={20} /><span>No hay planes programados. {canManagePlans ? 'Crea intervalos por horas o días.' : 'Solicita al administrador que configure los intervalos.'}</span></div>
        ) : (
          <div className="maintenance-plan-grid">
            {plans.map((plan) => (
              <article className="maintenance-plan-card" key={plan.id}>
                <span className="maintenance-stat-icon maintenance-icon-blue"><CalendarClock size={16} /></span>
                <div><strong>{plan.name}</strong><small>{assetTypes.find(({ code }) => code === plan.asset_type_code)?.name ?? plan.asset_type_code}</small></div>
                <span className="plan-interval">{[
                  plan.interval_flight_hours !== null ? `${plan.interval_flight_hours} h` : '',
                  plan.interval_days !== null ? `${plan.interval_days} días` : '',
                ].filter(Boolean).join(' · ')}</span>
              </article>
            ))}
          </div>
        )}
      </section>

      <AnimatePresence>
        {attachmentsRecord && (
          <DocumentAttachments
            orgId={orgId}
            entityId={attachmentsRecord.id}
            entityName={`${assetNames[attachmentsRecord.asset_id] ?? 'Activo'} · ${formatDate(attachmentsRecord.performed_at)}`}
            targetField="maintenance_record_id"
            canUpload={canManage}
            onClose={() => setAttachmentsRecord(null)}
          />
        )}
        {createOpen && (
          <MaintenanceModal title="Registrar intervención" onClose={() => setCreateOpen(false)} reducedMotion={Boolean(reduceMotion)}>
            <form className="maintenance-form" onSubmit={(event) => void createMaintenance(event)}>
              <label>Activo<select required value={draft.asset_id} onChange={(event) => setDraft((current) => ({ ...current, asset_id: event.target.value, plan_id: '' }))}><option value="">Selecciona un activo</option>{assets.map((asset) => <option key={asset.id} value={asset.id}>{asset.name} · {asset.internal_code} · {asset.status}</option>)}</select></label>
              <div className="maintenance-form-grid">
                <label>Tipo de mantenimiento<select required value={draft.maintenance_type} onChange={(event) => setDraft((current) => ({ ...current, maintenance_type: event.target.value }))}><option value="">Selecciona un tipo</option>{maintenanceTypes.map((type) => <option key={type.code} value={type.code}>{type.name}</option>)}</select></label>
                <label>Plan preventivo<select value={draft.plan_id} onChange={(event) => setDraft((current) => ({ ...current, plan_id: event.target.value }))}><option value="">Sin plan asociado</option>{filteredPlans.map((plan) => <option key={plan.id} value={plan.id}>{plan.name}</option>)}</select></label>
              </div>
              <label>Fecha de inicio<input type="datetime-local" required value={draft.performed_at} onChange={(event) => setDraft((current) => ({ ...current, performed_at: event.target.value }))} /></label>
              <label>Técnico interno (opcional)<select value={draft.technician_user_id} onChange={(event) => setDraft((current) => ({ ...current, technician_user_id: event.target.value }))}><option value="">No aplica / servicio externo</option>{members.map((member) => <option key={member.user_id} value={member.user_id}>{member.display_name}</option>)}</select></label>
              <div className="maintenance-form-grid">
                <label>Empresa externa (opcional)<input maxLength={150} value={draft.external_company} onChange={(event) => setDraft((current) => ({ ...current, external_company: event.target.value }))} /></label>
                <label>Técnico externo (opcional)<input maxLength={150} value={draft.external_technician} onChange={(event) => setDraft((current) => ({ ...current, external_technician: event.target.value }))} /></label>
              </div>
              <label>Diagnóstico<textarea rows={3} value={draft.diagnosis} onChange={(event) => setDraft((current) => ({ ...current, diagnosis: event.target.value }))} /></label>
              <label>Observaciones<textarea rows={2} value={draft.notes} onChange={(event) => setDraft((current) => ({ ...current, notes: event.target.value }))} /></label>
              <div className="maintenance-form-footer"><button className="secondary-button" type="button" onClick={() => setCreateOpen(false)}>Cancelar</button><button className="primary-button" type="submit" disabled={saving || !draft.asset_id || !draft.maintenance_type || (!draft.technician_user_id && !draft.external_company.trim() && !draft.external_technician.trim())}>{saving ? 'Guardando…' : 'Iniciar mantenimiento'}</button></div>
            </form>
          </MaintenanceModal>
        )}
        {planOpen && (
          <MaintenanceModal title="Nuevo plan preventivo" onClose={() => setPlanOpen(false)} reducedMotion={Boolean(reduceMotion)}>
            <form className="maintenance-form" onSubmit={(event) => void createPlan(event)}>
              <label>Tipo de activo<select required value={planDraft.asset_type_code} onChange={(event) => setPlanDraft((current) => ({ ...current, asset_type_code: event.target.value }))}><option value="">Selecciona un tipo</option>{assetTypes.map((type) => <option key={type.code} value={type.code}>{type.name}</option>)}</select></label>
              <label>Nombre del plan<input required maxLength={120} value={planDraft.name} onChange={(event) => setPlanDraft((current) => ({ ...current, name: event.target.value }))} placeholder="Ej. Inspección preventiva" /></label>
              <div className="maintenance-form-grid">
                <label>Intervalo en horas de vuelo<input type="number" min="0.01" step="0.01" value={planDraft.interval_flight_hours} onChange={(event) => setPlanDraft((current) => ({ ...current, interval_flight_hours: event.target.value }))} placeholder="Opcional" /></label>
                <label>Intervalo en días<input type="number" min="1" step="1" value={planDraft.interval_days} onChange={(event) => setPlanDraft((current) => ({ ...current, interval_days: event.target.value }))} placeholder="Opcional" /></label>
              </div>
              <p className="maintenance-form-hint">Indica al menos un intervalo. Ambos pueden usarse si aplica mantenimiento por horas o calendario.</p>
              <div className="maintenance-form-footer"><button className="secondary-button" type="button" onClick={() => setPlanOpen(false)}>Cancelar</button><button className="primary-button" type="submit" disabled={saving || (!planDraft.interval_flight_hours && !planDraft.interval_days)}>{saving ? 'Guardando…' : 'Crear plan'}</button></div>
            </form>
          </MaintenanceModal>
        )}
        {completing && (
          <MaintenanceModal title={`Finalizar · ${assetNames[completing.asset_id] ?? 'Activo'}`} onClose={() => { if (!saving) setCompleting(null) }} reducedMotion={Boolean(reduceMotion)}>
            <form className="maintenance-form" onSubmit={(event) => void completeMaintenance(event)}>
              <label>Actividades realizadas<textarea required rows={3} value={completionDraft.activities} onChange={(event) => setCompletionDraft((current) => ({ ...current, activities: event.target.value }))} /></label>
              <label>Resultado<textarea required rows={2} value={completionDraft.outcome} onChange={(event) => setCompletionDraft((current) => ({ ...current, outcome: event.target.value }))} /></label>
              {error && <div className="inline-error" role="alert"><AlertTriangle size={16} />{error}</div>}
              <div className="maintenance-form-grid">
                <label>Estado del activo al salir<select required value={completionDraft.release_asset_status} onChange={(event) => setCompletionDraft((current) => ({ ...current, release_asset_status: event.target.value }))}>{assetStatuses.map((status) => <option key={status.code} value={status.code}>{status.name}</option>)}</select></label>
                <label>Costo (COP)<input type="number" min="0" step="1" value={completionDraft.cost} onChange={(event) => setCompletionDraft((current) => ({ ...current, cost: event.target.value }))} placeholder="Opcional" /></label>
              </div>
              <label>Próxima intervención (opcional)<input type="date" value={completionDraft.next_intervention_at} onChange={(event) => setCompletionDraft((current) => ({ ...current, next_intervention_at: event.target.value }))} /></label>
              <section className="maintenance-parts-section" aria-labelledby="maintenance-parts-title">
                <div className="maintenance-parts-heading">
                  <div><h3 id="maintenance-parts-title">Repuestos utilizados</h3><p>El stock se descuenta solo al confirmar el cierre.</p></div>
                  <button className="secondary-button" type="button" onClick={() => setCompletionDraft((current) => ({ ...current, parts: [...current.parts, { stock_key: '', quantity: '', movement_type: 'installation' }] }))} disabled={!inventoryOptions.length || saving}><Plus size={14} /> Agregar repuesto</button>
                </div>
                {inventoryOptionsError && <p className="maintenance-form-hint" role="status">No se pudo cargar el stock disponible: {inventoryOptionsError}</p>}
                {!inventoryOptionsError && !inventoryOptions.length && <p className="maintenance-form-hint">No hay repuestos con existencia en ubicaciones activas.</p>}
                {completionDraft.parts.map((part, index) => {
                  const selectedOption = stockOptions.get(part.stock_key)
                  const remainingQuantity = selectedOption
                    ? Math.max(0, Number(selectedOption.quantity_available) - completionDraft.parts.reduce((sum, other, otherIndex) =>
                      otherIndex !== index && other.stock_key === part.stock_key ? sum + (Number(other.quantity) || 0) : sum, 0))
                    : 0
                  return (
                    <div className="maintenance-part-row" key={`maintenance-part-${index}`}>
                      <label>Repuesto y ubicación<select required value={part.stock_key} onChange={(event) => setCompletionDraft((current) => ({ ...current, parts: current.parts.map((entry, entryIndex) => entryIndex === index ? { ...entry, stock_key: event.target.value, quantity: '' } : entry) }))}><option value="">Selecciona repuesto</option>{inventoryOptions.map((option) => <option key={stockKey(option)} value={stockKey(option)}>{option.internal_code} · {option.item_name} · {option.location_name} · {option.quantity_available} {option.unit}</option>)}</select></label>
                      <label>Tipo<select value={part.movement_type} onChange={(event) => setCompletionDraft((current) => ({ ...current, parts: current.parts.map((entry, entryIndex) => entryIndex === index ? { ...entry, movement_type: event.target.value === 'consumption' ? 'consumption' : 'installation' } : entry) }))}><option value="installation">Instalado</option><option value="consumption">Consumido</option></select></label>
                      <label>Cantidad{selectedOption ? ` (${selectedOption.unit})` : ''}<input required type="number" min={selectedOption?.is_serialized ? '1' : '0.001'} max={selectedOption ? remainingQuantity : undefined} step={selectedOption?.is_serialized ? '1' : '0.001'} value={part.quantity} onChange={(event) => setCompletionDraft((current) => ({ ...current, parts: current.parts.map((entry, entryIndex) => entryIndex === index ? { ...entry, quantity: event.target.value } : entry) }))} /></label>
                      <button className="icon-button maintenance-part-remove" type="button" aria-label="Quitar repuesto" onClick={() => setCompletionDraft((current) => ({ ...current, parts: current.parts.filter((_, entryIndex) => entryIndex !== index) }))}><Trash2 size={15} /></button>
                      {selectedOption && <small className="maintenance-part-availability">Disponible para esta intervención: {remainingQuantity} {selectedOption.unit}</small>}
                    </div>
                  )
                })}
              </section>
              <div className="maintenance-form-footer"><button className="secondary-button" type="button" onClick={() => setCompleting(null)} disabled={saving}>Cancelar</button><button className="primary-button" type="submit" disabled={saving || incompleteParts}>{saving ? 'Finalizando…' : 'Confirmar cierre'}</button></div>
            </form>
          </MaintenanceModal>
        )}
      </AnimatePresence>
    </motion.section>
  )
}

function MaintenanceModal({
  title,
  children,
  onClose,
  reducedMotion,
}: {
  title: string
  children: React.ReactNode
  onClose: () => void
  reducedMotion: boolean
}) {
  return (
    <motion.div className="maintenance-modal-backdrop" role="presentation" initial={reducedMotion ? false : { opacity: 0 }} animate={{ opacity: 1 }} exit={reducedMotion ? undefined : { opacity: 0 }} onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <motion.section className="maintenance-modal" role="dialog" aria-modal="true" aria-label={title} initial={reducedMotion ? false : { opacity: 0, y: 12, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={reducedMotion ? undefined : { opacity: 0, y: 8, scale: 0.98 }}>
        <div className="maintenance-modal-heading"><div><span className="eyebrow">SKY LOGIC · MANTENIMIENTO</span><h2>{title}</h2></div><button className="icon-button" type="button" aria-label="Cerrar" onClick={onClose}><X size={18} /></button></div>
        {children}
      </motion.section>
    </motion.div>
  )
}
