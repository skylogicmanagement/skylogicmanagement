import { useCallback, useEffect, useMemo, useState } from 'react'
import { AlertTriangle, Check, ChevronLeft, ChevronRight, RefreshCw, ShieldCheck } from 'lucide-react'
import { motion, useReducedMotion } from 'motion/react'
import { supabase } from '../../lib/supabase'
import './audit.css'

const pageSize = 30
const entityOptions = [
  ['assets', 'Activos'],
  ['operations', 'Operaciones'],
  ['operation_assets', 'Activos en operaciones'],
  ['flight_logs', 'Vuelos'],
  ['maintenance_records', 'Mantenimientos'],
  ['inventory_items', 'Artículos de inventario'],
  ['inventory_movements', 'Movimientos de inventario'],
  ['pilots', 'Pilotos'],
  ['asset_assignments', 'Asignaciones'],
  ['user_profiles', 'Perfiles'],
  ['memberships', 'Membresías'],
  ['farms', 'Fincas'],
] as const

type AuditEvent = {
  id: number
  occurred_at: string
  actor_user_id: string | null
  event_type: string
  entity_table: string
  entity_id: string | null
  before_state: Record<string, unknown> | null
  after_state: Record<string, unknown> | null
  correction_of: number | null
  correction_reason: string | null
  transaction_id: number
  event_hash: string
}

type AuditFilter = {
  entity: string
  action: string
  from: string
  to: string
}

const emptyFilter: AuditFilter = { entity: '', action: '', from: '', to: '' }

function formatDate(value: string) {
  return new Intl.DateTimeFormat('es-CO', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'America/Bogota',
  }).format(new Date(value))
}

function displayValue(value: unknown) {
  if (value === null || value === undefined) return 'vacío'
  if (typeof value === 'string') return value || 'vacío'
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

function addDateDays(value: string, days: number) {
  const date = new Date(`${value}T12:00:00.000Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

function describeEvent(event: AuditEvent) {
  if (event.event_type === 'insert') return 'Registro creado'
  if (event.event_type === 'delete') return 'Registro eliminado'
  if (event.correction_of) return `Corrección del evento #${event.correction_of}`
  return 'Registro actualizado'
}

function changedFields(event: AuditEvent) {
  if (!event.before_state || !event.after_state) {
    const state = event.after_state ?? event.before_state
    if (!state) return []
    return Object.entries(state)
      .filter(([, value]) => value !== null && value !== undefined)
      .slice(0, 8)
      .map(([key, value]) => [key, event.before_state ? value : null, event.after_state ? value : null] as [string, unknown, unknown])
  }
  const keys = new Set([...Object.keys(event.before_state), ...Object.keys(event.after_state)])
  return [...keys]
    .filter((key) => JSON.stringify(event.before_state?.[key]) !== JSON.stringify(event.after_state?.[key]))
    .slice(0, 8)
    .map((key) => [key, event.before_state?.[key] ?? null, event.after_state?.[key] ?? null] as [string, unknown, unknown])
}

export function AuditPage({ userId }: { userId: string }) {
  const reduceMotion = useReducedMotion()
  const [orgId, setOrgId] = useState('')
  const [events, setEvents] = useState<AuditEvent[]>([])
  const [actorNames, setActorNames] = useState<Record<string, string>>({})
  const [filter, setFilter] = useState(emptyFilter)
  const [page, setPage] = useState(0)
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [checking, setChecking] = useState(false)
  const [canRead, setCanRead] = useState(false)
  const [error, setError] = useState('')
  const [integrity, setIntegrity] = useState<'valid' | 'invalid' | null>(null)
  const [verifiedAt, setVerifiedAt] = useState('')

  const loadData = useCallback(async () => {
    if (!supabase) return
    setLoading(true)
    setError('')
    const { data: membership, error: membershipError } = await supabase
      .from('memberships')
      .select('org_id')
      .eq('user_id', userId)
      .eq('active', true)
      .limit(1)
      .maybeSingle()
    if (membershipError) {
      setError(membershipError.message)
      setLoading(false)
      return
    }
    if (!membership) {
      setError('Tu cuenta no tiene una membresía activa en Sky Logic.')
      setLoading(false)
      return
    }

    setOrgId(membership.org_id)
    const permissionResult = await supabase.rpc('has_org_permission', {
      target_org: membership.org_id,
      permission: 'audit.read',
    })
    if (permissionResult.error) {
      setError(permissionResult.error.message)
      setLoading(false)
      return
    }
    setCanRead(permissionResult.data === true)
    if (!permissionResult.data) {
      setEvents([])
      setTotal(0)
      setLoading(false)
      return
    }

    let query = supabase.from('audit_events')
      .select('id, occurred_at, actor_user_id, event_type, entity_table, entity_id, before_state, after_state, correction_of, correction_reason, transaction_id, event_hash', { count: 'exact' })
      .eq('org_id', membership.org_id)
      .order('occurred_at', { ascending: false })
      .order('id', { ascending: false })
      .range(page * pageSize, (page + 1) * pageSize - 1)
    if (filter.entity) query = query.eq('entity_table', filter.entity)
    if (filter.action) query = query.eq('event_type', filter.action)
    if (filter.from) query = query.gte('occurred_at', `${filter.from}T05:00:00.000Z`)
    if (filter.to) query = query.lt('occurred_at', `${addDateDays(filter.to, 1)}T05:00:00.000Z`)

    const { data, error: eventsError, count } = await query
    if (eventsError) {
      setError(eventsError.message)
      setLoading(false)
      return
    }
    const rows = data ?? []
    const actorIds = [...new Set(rows.flatMap((row) => row.actor_user_id ? [row.actor_user_id] : []))]
    const actorsResult = actorIds.length
      ? await supabase.from('user_profiles').select('user_id, display_name').eq('org_id', membership.org_id).in('user_id', actorIds)
      : { data: [], error: null }
    if (actorsResult.error) {
      setError(actorsResult.error.message)
      setLoading(false)
      return
    }
    setEvents(rows)
    setTotal(count ?? 0)
    setActorNames(Object.fromEntries((actorsResult.data ?? []).map(({ user_id, display_name }) => [user_id, display_name])))
    setLoading(false)
  }, [filter, page, userId])

  useEffect(() => {
    const timeout = window.setTimeout(() => void loadData(), 0)
    return () => window.clearTimeout(timeout)
  }, [loadData])

  useEffect(() => {
    const client = supabase
    if (!client || !orgId || !canRead) return
    const channel = client
      .channel(`audit-events-${orgId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'audit_events', filter: `org_id=eq.${orgId}` }, () => void loadData())
      .subscribe((status, subscriptionError) => {
        if ((status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') && subscriptionError) {
          setError(subscriptionError.message)
        }
      })
    return () => {
      void client.removeChannel(channel)
    }
  }, [canRead, loadData, orgId])

  const pageCount = Math.ceil(total / pageSize)
  const visibleFrom = total ? page * pageSize + 1 : 0
  const visibleTo = Math.min((page + 1) * pageSize, total)
  const entityNames = useMemo(() => new Map<string, string>(entityOptions), [])

  async function verifyIntegrity() {
    if (!supabase || !orgId || !canRead) return
    setChecking(true)
    setError('')
    setIntegrity(null)
    const { data, error: verifyError } = await supabase.rpc('verify_audit_chain', { target_org: orgId })
    if (verifyError) {
      setError(verifyError.message)
    } else {
      setIntegrity(data ? 'valid' : 'invalid')
      setVerifiedAt(new Date().toISOString())
    }
    setChecking(false)
  }

  function updateFilter(key: keyof AuditFilter, value: string) {
    setFilter((current) => {
      if (key === 'from' && value && current.to && value > current.to) {
        return { ...current, from: value, to: '' }
      }
      if (key === 'to' && value && current.from && value < current.from) {
        return { ...current, from: '', to: value }
      }
      return { ...current, [key]: value }
    })
    setPage(0)
    setIntegrity(null)
  }

  return (
    <motion.section className="audit-page" initial={reduceMotion ? false : { opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
      {!canRead && !loading && !error ? (
        <div className="audit-empty"><ShieldCheck size={23} /><strong>Acceso restringido</strong><p>Tu rol no tiene el permiso de consulta de auditoría.</p></div>
      ) : (
        <>
          <div className="audit-toolbar">
            <div className="audit-count"><strong>{loading ? '…' : total}</strong><span>eventos registrados</span></div>
            <div className="audit-toolbar-actions">
              <button className="assets-refresh" type="button" aria-label="Actualizar auditoría" onClick={() => { setLoading(true); void loadData() }} disabled={loading}><RefreshCw size={16} /></button>
              <button className="primary-button" type="button" onClick={() => void verifyIntegrity()} disabled={checking || loading || !canRead}>
                <ShieldCheck size={15} />{checking ? 'Verificando…' : 'Verificar integridad'}
              </button>
            </div>
          </div>

          {error && <div className="inline-error" role="alert"><AlertTriangle size={17} />{error}</div>}
          {integrity && (
            <div className={`audit-integrity audit-integrity-${integrity}`} role="status">
              {integrity === 'valid' ? <Check size={17} /> : <AlertTriangle size={17} />}
              <span><strong>{integrity === 'valid' ? 'Cadena íntegra' : 'La verificación encontró inconsistencias'}</strong>
                <small>Verificada {formatDate(verifiedAt)} · se comprobó la cadena completa de auditoría.</small>
              </span>
            </div>
          )}

          <div className="audit-filters">
            <label>Entidad<select value={filter.entity} onChange={(event) => updateFilter('entity', event.target.value)}>
              <option value="">Todas las entidades</option>
              {entityOptions.map(([value, label]) => <option value={value} key={value}>{label}</option>)}
            </select></label>
            <label>Acción<select value={filter.action} onChange={(event) => updateFilter('action', event.target.value)}>
              <option value="">Todas las acciones</option><option value="insert">Creación</option><option value="update">Actualización</option><option value="delete">Eliminación</option>
            </select></label>
            <label>Desde<input type="date" value={filter.from} max={filter.to || undefined} onChange={(event) => updateFilter('from', event.target.value)} /></label>
            <label>Hasta<input type="date" value={filter.to} min={filter.from || undefined} onChange={(event) => updateFilter('to', event.target.value)} /></label>
            <button className="secondary-button audit-clear-button" type="button" onClick={() => { setFilter(emptyFilter); setPage(0); setIntegrity(null) }} disabled={Object.values(filter).every((value) => !value)}>Limpiar</button>
          </div>

          {loading ? (
            <div className="audit-empty"><span className="asset-loading-mark" /><strong>Cargando eventos…</strong></div>
          ) : events.length ? (
            <>
              <div className="audit-timeline">
                {events.map((event) => {
                  const fields = changedFields(event)
                  const actor = event.actor_user_id ? actorNames[event.actor_user_id] ?? 'Usuario sin nombre registrado' : 'Sistema / proceso administrativo'
                  return (
                    <article className="audit-event" key={event.id}>
                      <span className={`audit-event-marker audit-event-${event.event_type}`} />
                      <div className="audit-event-content">
                        <div className="audit-event-header">
                          <div><span className={`audit-action-pill audit-action-${event.event_type}`}>{event.event_type}</span><strong>{describeEvent(event)}</strong></div>
                          <time dateTime={event.occurred_at}>{formatDate(event.occurred_at)}</time>
                        </div>
                        <div className="audit-event-meta">
                          <span>{entityNames.get(event.entity_table) ?? event.entity_table}</span>
                          {event.entity_id && <code>{event.entity_id}</code>}
                          <span>Por {actor}</span>
                        </div>
                        {fields.length > 0 && (
                          <details className="audit-event-details">
                            <summary>Ver datos del evento ({fields.length}{event.before_state && event.after_state ? ' cambios' : ' campos'})</summary>
                            <dl>{fields.map(([key, before, after]) => (
                              <div key={key}>
                                <dt>{key}</dt>
                                <dd>{event.event_type === 'update'
                                  ? `Antes: ${displayValue(before).slice(0, 100)} → Ahora: ${displayValue(after).slice(0, 100)}`
                                  : displayValue(after ?? before).slice(0, 200)}</dd>
                              </div>
                            ))}</dl>
                          </details>
                        )}
                        {event.correction_reason && <p className="audit-correction-reason">Motivo de corrección: {event.correction_reason}</p>}
                        <small className="audit-event-reference">Evento #{event.id} · transacción #{event.transaction_id} · SHA-256 {event.event_hash.slice(0, 16)}…</small>
                      </div>
                    </article>
                  )
                })}
              </div>
              <div className="audit-pagination">
                <span>Mostrando {visibleFrom}–{visibleTo} de {total}</span>
                <div>
                  <button className="secondary-button" type="button" aria-label="Página anterior" onClick={() => setPage((current) => Math.max(0, current - 1))} disabled={page === 0 || loading}><ChevronLeft size={15} /> Anterior</button>
                  <span>Página {page + 1} de {Math.max(pageCount, 1)}</span>
                  <button className="secondary-button" type="button" aria-label="Página siguiente" onClick={() => setPage((current) => Math.min(pageCount - 1, current + 1))} disabled={page >= pageCount - 1 || loading}>Siguiente <ChevronRight size={15} /></button>
                </div>
              </div>
            </>
          ) : (
            <div className="audit-empty"><ShieldCheck size={23} /><strong>No hay eventos para estos filtros</strong><p>Prueba cambiando el rango de fechas, la entidad o la acción.</p></div>
          )}
        </>
      )}
    </motion.section>
  )
}
