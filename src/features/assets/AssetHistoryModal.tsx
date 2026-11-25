import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, Box, CalendarDays, Clock3, FileClock, MapPin, X } from 'lucide-react'
import { motion, useReducedMotion } from 'motion/react'
import { supabase } from '../../lib/supabase'

type AssetHistoryAsset = {
  id: string
  org_id: string
  name: string
  internal_code: string
  asset_type_code: string
  serial_number: string | null
  brand: string | null
  model: string | null
  status: string
  acquired_at: string | null
  acquisition_value: number | null
  location_id: string | null
  responsible_user_id: string | null
  notes: string | null
}
type AssetHistoryEvent = {
  id: string
  occurredAt: string
  category: 'asset' | 'operation' | 'maintenance' | 'flight' | 'inventory' | 'assignment'
  title: string
  detail: string
  actorId?: string | null
}
type RelatedAsset = { id: string; name: string; internal_code: string }
type Member = { user_id: string; display_name: string }
type Location = { id: string; name: string }

function formatDate(value: string) {
  return new Intl.DateTimeFormat('es-CO', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value))
}

function formatCurrency(value: number | null) {
  if (value === null) return 'Sin registrar'
  return new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(value)
}

function describeChanges(before: Record<string, unknown> | null, after: Record<string, unknown> | null) {
  if (!before || !after) return 'Registro inicial de la ficha'
  const fields: Record<string, string> = {
    name: 'nombre',
    internal_code: 'código interno',
    serial_number: 'número de serie',
    brand: 'marca',
    model: 'modelo',
    acquired_at: 'fecha de adquisición',
    acquisition_value: 'valor de adquisición',
    status: 'estado',
    location_id: 'ubicación',
    responsible_user_id: 'responsable',
    notes: 'observaciones',
  }
  const changed = Object.keys(fields).filter((key) => JSON.stringify(before[key]) !== JSON.stringify(after[key]))
  if (!changed.length) return 'Cambio registrado en la ficha'
  return `Se actualizaron: ${changed.map((key) => fields[key]).join(', ')}`
}

export function AssetHistoryModal({
  asset,
  assets,
  locations,
  members,
  onClose,
}: {
  asset: AssetHistoryAsset
  assets: RelatedAsset[]
  locations: Location[]
  members: Member[]
  onClose: () => void
}) {
  const reduceMotion = useReducedMotion()
  const [events, setEvents] = useState<AssetHistoryEvent[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [sources, setSources] = useState<string[]>([])
  const assetName = useMemo(() => new Map(assets.map((item) => [item.id, `${item.name} · ${item.internal_code}`])), [assets])
  const locationName = useMemo(() => new Map(locations.map((location) => [location.id, location.name])), [locations])
  const memberName = useMemo(() => new Map(members.map((member) => [member.user_id, member.display_name])), [members])

  useEffect(() => {
    let active = true
    async function loadHistory() {
      if (!supabase) {
        setError('La conexión con Supabase no está configurada.')
        setLoading(false)
        return
      }
      setLoading(true)
      setError('')
      setEvents([])
      setSources([])
      const permissions = await Promise.all([
        supabase.rpc('has_org_permission', { target_org: asset.org_id, permission: 'operations.read' }),
        supabase.rpc('has_org_permission', { target_org: asset.org_id, permission: 'operations.manage' }),
        supabase.rpc('has_org_permission', { target_org: asset.org_id, permission: 'maintenance.read' }),
        supabase.rpc('has_org_permission', { target_org: asset.org_id, permission: 'maintenance.manage' }),
        supabase.rpc('has_org_permission', { target_org: asset.org_id, permission: 'inventory.read' }),
        supabase.rpc('has_org_permission', { target_org: asset.org_id, permission: 'inventory.manage' }),
        supabase.rpc('has_org_permission', { target_org: asset.org_id, permission: 'audit.read' }),
      ])
      const permissionError = permissions.find((result) => result.error)?.error
      if (permissionError) {
        if (active) {
          setError(permissionError.message)
          setLoading(false)
        }
        return
      }

      const canReadOperations = permissions[0].data === true || permissions[1].data === true
      const canReadMaintenance = permissions[2].data === true || permissions[3].data === true
      const canReadInventory = permissions[4].data === true || permissions[5].data === true
      const canReadAudit = permissions[6].data === true
      const visibleSources = ['Ficha y datos técnicos']
      if (canReadOperations) visibleSources.push('operaciones y asignaciones')
      if (canReadMaintenance) visibleSources.push('mantenimientos')
      if (canReadInventory) visibleSources.push('repuestos')
      if (canReadAudit) visibleSources.push('auditoría de la ficha')
      setSources(visibleSources)

      const [operationAssetsResult, assignmentsResult, maintenanceResult, flightsResult, movementsResult, auditResult] = await Promise.all([
        canReadOperations
          ? supabase.from('operation_assets')
            .select('id, operation_id, departure_at, returned_at, departure_condition, return_condition, return_notes, created_by, returned_by_user_id')
            .eq('org_id', asset.org_id)
            .eq('asset_id', asset.id)
            .order('departure_at', { ascending: false })
            .limit(100)
          : Promise.resolve({ data: [], error: null }),
        canReadOperations
          ? supabase.from('asset_assignments')
            .select('id, assignment_type, assigned_asset_id, assigned_user_id, operation_id, started_at, ended_at, reason, created_by')
            .eq('org_id', asset.org_id)
            .eq('asset_id', asset.id)
            .order('started_at', { ascending: false })
            .limit(100)
          : Promise.resolve({ data: [], error: null }),
        canReadMaintenance
          ? supabase.from('maintenance_records')
            .select('id, maintenance_type, status, performed_at, completed_at, diagnosis, activities, outcome, next_intervention_at, technician_user_id, external_company, external_technician, created_by')
            .eq('org_id', asset.org_id)
            .eq('asset_id', asset.id)
            .order('performed_at', { ascending: false })
            .limit(100)
          : Promise.resolve({ data: [], error: null }),
        asset.asset_type_code === 'drone'
          ? supabase.from('flight_logs')
            .select('id, operation_id, farm_id, logged_at, hour_meter_start, hour_meter_end, flight_hours, recorded_by')
            .eq('org_id', asset.org_id)
            .eq('drone_asset_id', asset.id)
            .order('logged_at', { ascending: false })
            .limit(100)
          : Promise.resolve({ data: [], error: null }),
        canReadInventory
          ? supabase.from('inventory_movements')
            .select('id, item_id, movement_type, quantity_delta, created_at, reason, created_by')
            .eq('org_id', asset.org_id)
            .eq('asset_id', asset.id)
            .order('created_at', { ascending: false })
            .limit(100)
          : Promise.resolve({ data: [], error: null }),
        canReadAudit
          ? supabase.from('audit_events')
            .select('id, occurred_at, actor_user_id, event_type, before_state, after_state')
            .eq('org_id', asset.org_id)
            .eq('entity_table', 'assets')
            .eq('entity_id', asset.id)
            .order('occurred_at', { ascending: false })
            .limit(100)
          : Promise.resolve({ data: [], error: null }),
      ])

      const sourceError = operationAssetsResult.error
        ?? assignmentsResult.error
        ?? maintenanceResult.error
        ?? flightsResult.error
        ?? movementsResult.error
        ?? auditResult.error
      if (sourceError) {
        if (active) {
          setError(sourceError.message)
          setLoading(false)
        }
        return
      }

      const operationIds = [...new Set((operationAssetsResult.data ?? []).map((row) => row.operation_id))]
      const operationsResult = canReadOperations && operationIds.length
        ? await supabase.from('operations').select('id, operation_number').eq('org_id', asset.org_id).in('id', operationIds)
        : { data: [], error: null }
      if (operationsResult.error) {
        if (active) {
          setError(operationsResult.error.message)
          setLoading(false)
        }
        return
      }
      const operationNumber = new Map((operationsResult.data ?? []).map((row) => [row.id, row.operation_number]))

      const itemIds = [...new Set((movementsResult.data ?? []).map((row) => row.item_id))]
      const itemsResult = canReadInventory && itemIds.length
        ? await supabase.from('inventory_items').select('id, name, internal_code').eq('org_id', asset.org_id).in('id', itemIds)
        : { data: [], error: null }
      if (itemsResult.error) {
        if (active) {
          setError(itemsResult.error.message)
          setLoading(false)
        }
        return
      }
      const itemNames = new Map((itemsResult.data ?? []).map((item) => [item.id, `${item.name} · ${item.internal_code}`]))
      const rows: AssetHistoryEvent[] = []

      for (const event of auditResult.data ?? []) {
        rows.push({
          id: `audit-${event.id}`,
          occurredAt: event.occurred_at,
          category: 'asset',
          title: event.event_type === 'insert' ? 'Activo registrado' : 'Ficha actualizada',
          detail: describeChanges(event.before_state, event.after_state),
          actorId: event.actor_user_id,
        })
      }
      for (const row of operationAssetsResult.data ?? []) {
        const operation = `Operación #${operationNumber.get(row.operation_id) ?? row.operation_id.slice(0, 8)}`
        rows.push({
          id: `departure-${row.id}`,
          occurredAt: row.departure_at,
          category: 'operation',
          title: `Salida en ${operation}`,
          detail: row.departure_condition ? `Condición de salida: ${row.departure_condition}` : 'Salida registrada',
          actorId: row.created_by,
        })
        if (row.returned_at) {
          rows.push({
            id: `return-${row.id}`,
            occurredAt: row.returned_at,
            category: 'operation',
            title: `Regreso de ${operation}`,
            detail: [row.return_condition ? `Condición: ${row.return_condition}` : '', row.return_notes ?? ''].filter(Boolean).join(' · ') || 'Recepción registrada',
            actorId: row.returned_by_user_id,
          })
        }
      }
      for (const row of assignmentsResult.data ?? []) {
        const assignee = row.assignment_type === 'user'
          ? memberName.get(row.assigned_user_id ?? '') ?? 'Usuario'
          : row.assignment_type === 'asset'
            ? assetName.get(row.assigned_asset_id ?? '') ?? 'Activo relacionado'
            : `Operación #${operationNumber.get(row.operation_id ?? '') ?? row.operation_id?.slice(0, 8) ?? ''}`
        rows.push({
          id: `assignment-${row.id}`,
          occurredAt: row.ended_at ?? row.started_at,
          category: 'assignment',
          title: row.ended_at ? 'Asignación finalizada' : 'Asignación iniciada',
          detail: `${row.assignment_type === 'user' ? 'Responsable' : row.assignment_type === 'asset' ? 'Componente asociado' : 'Operación'}: ${assignee}${row.reason ? ` · ${row.reason}` : ''}`,
          actorId: row.created_by,
        })
      }
      for (const row of maintenanceResult.data ?? []) {
        rows.push({
          id: `maintenance-${row.id}`,
          occurredAt: row.completed_at ?? row.performed_at,
          category: 'maintenance',
          title: `Mantenimiento ${row.status === 'completed' ? 'finalizado' : row.status === 'cancelled' ? 'cancelado' : 'iniciado'}`,
          detail: [
            row.maintenance_type,
            row.diagnosis,
            row.activities,
            row.outcome,
            row.technician_user_id ? memberName.get(row.technician_user_id) : '',
            row.external_technician,
            row.external_company,
            row.next_intervention_at ? `Próximo: ${row.next_intervention_at}` : '',
          ].filter(Boolean).join(' · ') || 'Sin detalles adicionales',
          actorId: row.created_by,
        })
      }
      for (const row of flightsResult.data ?? []) {
        rows.push({
          id: `flight-${row.id}`,
          occurredAt: row.logged_at,
          category: 'flight',
          title: `Vuelo registrado · ${Number(row.flight_hours).toFixed(2)} h`,
          detail: `Horómetro ${row.hour_meter_start}–${row.hour_meter_end} · Operación #${operationNumber.get(row.operation_id) ?? row.operation_id.slice(0, 8)}`,
          actorId: row.recorded_by,
        })
      }
      for (const row of movementsResult.data ?? []) {
        rows.push({
          id: `inventory-${row.id}`,
          occurredAt: row.created_at,
          category: 'inventory',
          title: `Repuesto ${row.movement_type}`,
          detail: `${itemNames.get(row.item_id) ?? 'Artículo'} · ${row.quantity_delta > 0 ? '+' : ''}${row.quantity_delta}${row.reason ? ` · ${row.reason}` : ''}`,
          actorId: row.created_by,
        })
      }
      rows.sort((a, b) => new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime())
      if (active) {
        setEvents(rows)
        setLoading(false)
      }
    }

    void loadHistory()
    return () => { active = false }
  }, [asset, assetName, locationName, memberName])

  return (
    <div className="asset-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <motion.section
        className="asset-history-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="asset-history-title"
        initial={reduceMotion ? false : { opacity: 0, y: 12, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={reduceMotion ? undefined : { opacity: 0, y: 8, scale: 0.98 }}
      >
        <header className="asset-history-heading">
          <div>
            <span className="eyebrow">HOJA DE VIDA</span>
            <h2 id="asset-history-title">{asset.name}</h2>
            <p>{asset.internal_code} · {asset.serial_number || 'Serial pendiente'}</p>
          </div>
          <button className="icon-button" type="button" aria-label="Cerrar hoja de vida" onClick={onClose}><X size={18} /></button>
        </header>

        <div className="asset-history-summary">
          <div><small>Tipo y estado</small><span>{asset.asset_type_code} · {asset.status}</span></div>
          <div><small>Marca / modelo</small><span>{[asset.brand, asset.model].filter(Boolean).join(' · ') || 'Sin registrar'}</span></div>
          <div><small>Adquisición</small><span>{asset.acquired_at ?? 'Sin fecha'} · {formatCurrency(asset.acquisition_value)}</span></div>
          <div><small>Ubicación actual</small><span>{asset.location_id ? locationName.get(asset.location_id) ?? 'Ubicación registrada' : 'Sin confirmar'}</span></div>
          <div><small>Responsable actual</small><span>{asset.responsible_user_id ? memberName.get(asset.responsible_user_id) ?? 'Usuario registrado' : 'Sin asignar'}</span></div>
          {asset.notes && <div className="asset-history-summary-wide"><small>Observaciones</small><span>{asset.notes}</span></div>}
        </div>

        <section className="asset-history-timeline-section">
          <div className="asset-history-timeline-heading">
            <div><h3><FileClock size={15} /> Historial cronológico</h3><p>Fuentes visibles según tus permisos: {sources.join(', ')}.</p></div>
            <span>{events.length} eventos</span>
          </div>
          {loading ? (
            <div className="asset-history-empty">Cargando hoja de vida…</div>
          ) : error ? (
            <div className="asset-history-error" role="alert"><AlertTriangle size={16} />{error}</div>
          ) : events.length === 0 ? (
            <div className="asset-history-empty"><Box size={20} /><strong>Aún no hay eventos relacionados</strong><span>Las salidas, vuelos, mantenimientos y cambios aparecerán aquí al registrarlos.</span></div>
          ) : (
            <ol className="asset-history-timeline">
              {events.map((event) => (
                <li className={`asset-history-event event-${event.category}`} key={event.id}>
                  <span className="asset-history-event-icon">{event.category === 'flight' ? <Clock3 size={15} /> : event.category === 'operation' ? <MapPin size={15} /> : <CalendarDays size={15} />}</span>
                  <div>
                    <div className="asset-history-event-top"><strong>{event.title}</strong><time>{formatDate(event.occurredAt)}</time></div>
                    <p>{event.detail}</p>
                    {event.actorId && <small>Registrado por {memberName.get(event.actorId) ?? `usuario ${event.actorId.slice(0, 8)}`}</small>}
                  </div>
                </li>
              ))}
            </ol>
          )}
        </section>
      </motion.section>
    </div>
  )
}
