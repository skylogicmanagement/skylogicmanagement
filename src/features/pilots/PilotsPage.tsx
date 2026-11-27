import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle, Pencil, Plus, RefreshCw, ShieldCheck, UserRound, X } from 'lucide-react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { supabase } from '../../lib/supabase'
import './pilots.css'

type Pilot = {
  id: string
  full_name: string
  phone: string | null
  license_number: string | null
  notes: string | null
  active: boolean
  created_at: string
}

type PilotDraft = {
  full_name: string
  phone: string
  license_number: string
  notes: string
}
type PilotSummary = {
  operationCount: number
  flightCount: number
  totalHours: number
  lastFlightAt: string | null
  currentOperation: { operationNumber: number; farmName: string } | null
  flights: Array<{ id: string; operationNumber: number; farmName: string; droneName: string; loggedAt: string; hours: number }>
}

const emptyDraft: PilotDraft = { full_name: '', phone: '', license_number: '', notes: '' }

export function PilotsPage({ userId }: { userId: string }) {
  const reduceMotion = useReducedMotion()
  const [pilots, setPilots] = useState<Pilot[]>([])
  const [pilotSummaries, setPilotSummaries] = useState<Record<string, PilotSummary>>({})
  const [orgId, setOrgId] = useState('')
  const [canManage, setCanManage] = useState(false)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [loadError, setLoadError] = useState('')
  const [formError, setFormError] = useState('')
  const [notice, setNotice] = useState('')
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<Pilot | null>(null)
  const [historyPilot, setHistoryPilot] = useState<Pilot | null>(null)
  const [draft, setDraft] = useState(emptyDraft)

  const loadData = useCallback(async () => {
    if (!supabase) return
    setLoadError('')
    const { data: membership, error: membershipError } = await supabase
      .from('memberships')
      .select('org_id')
      .eq('user_id', userId)
      .eq('active', true)
      .limit(1)
      .maybeSingle()
    if (membershipError) {
      setLoadError(membershipError.message)
      setLoading(false)
      return
    }
    if (!membership) {
      setLoadError('Tu cuenta no tiene una membresía activa en Sky Logic.')
      setLoading(false)
      return
    }

    setOrgId(membership.org_id)
    const [pilotsResult, manageResult, operationsResult, assignmentsResult, flightsResult, farmsResult, dronesResult] = await Promise.all([
      supabase.from('pilots')
        .select('id, full_name, phone, license_number, notes, active, created_at')
        .eq('org_id', membership.org_id)
        .order('full_name'),
      supabase.rpc('has_org_permission', {
        target_org: membership.org_id,
        permission: 'operations.manage',
      }),
      supabase.from('operations')
        .select('id, operation_number, status, farm_id')
        .eq('org_id', membership.org_id)
        .order('id')
        .range(0, 999),
      supabase.from('operation_assets')
        .select('operation_id, asset_id, pilot_id, returned_at')
        .eq('org_id', membership.org_id)
        .not('pilot_id', 'is', null)
        .order('operation_id')
        .order('asset_id')
        .range(0, 999),
      supabase.from('flight_logs')
        .select('id, operation_id, drone_asset_id, logged_at, flight_hours')
        .eq('org_id', membership.org_id)
        .order('logged_at', { ascending: false })
        .order('id')
        .range(0, 999),
      supabase.from('farms')
        .select('id, name')
        .eq('org_id', membership.org_id),
      supabase.from('assets')
        .select('id, name')
        .eq('org_id', membership.org_id)
        .eq('asset_type_code', 'drone'),
    ])
    const error = pilotsResult.error ?? manageResult.error ?? operationsResult.error
      ?? assignmentsResult.error ?? flightsResult.error ?? farmsResult.error ?? dronesResult.error
    if (error) {
      setLoadError(error.message)
    } else {
      const operationRows = [...(operationsResult.data ?? [])]
      for (let offset = operationRows.length; operationRows.length > 0 && operationRows.length % 1000 === 0; offset += 1000) {
        const { data, error: pageError } = await supabase.from('operations')
          .select('id, operation_number, status, farm_id')
          .eq('org_id', membership.org_id)
          .order('id')
          .range(offset, offset + 999)
        if (pageError) {
          setLoadError(pageError.message)
          setLoading(false)
          return
        }
        operationRows.push(...(data ?? []))
        if (!data || data.length < 1000) break
      }

      const assignmentRows = [...(assignmentsResult.data ?? [])]
      for (let offset = assignmentRows.length; assignmentRows.length > 0 && assignmentRows.length % 1000 === 0; offset += 1000) {
        const { data, error: pageError } = await supabase.from('operation_assets')
          .select('operation_id, asset_id, pilot_id, returned_at')
          .eq('org_id', membership.org_id)
          .not('pilot_id', 'is', null)
          .order('operation_id')
          .order('asset_id')
          .range(offset, offset + 999)
        if (pageError) {
          setLoadError(pageError.message)
          setLoading(false)
          return
        }
        assignmentRows.push(...(data ?? []))
        if (!data || data.length < 1000) break
      }

      const flightRows = [...(flightsResult.data ?? [])]
      for (let offset = flightRows.length; flightRows.length > 0 && flightRows.length % 1000 === 0; offset += 1000) {
        const { data, error: pageError } = await supabase.from('flight_logs')
          .select('id, operation_id, drone_asset_id, logged_at, flight_hours')
          .eq('org_id', membership.org_id)
          .order('logged_at', { ascending: false })
          .order('id')
          .range(offset, offset + 999)
        if (pageError) {
          setLoadError(pageError.message)
          setLoading(false)
          return
        }
        flightRows.push(...(data ?? []))
        if (!data || data.length < 1000) break
      }

      const pilotRows = pilotsResult.data ?? []
      const operationById = new Map(operationRows.map((operation) => [operation.id, operation]))
      const farmNames = new Map((farmsResult.data ?? []).map((farm) => [farm.id, farm.name]))
      const droneNames = new Map((dronesResult.data ?? []).map((drone) => [drone.id, drone.name]))
      const assignmentByOperationDrone = new Map(assignmentRows.map((assignment) => [`${assignment.operation_id}:${assignment.asset_id}`, assignment]))
      const summaries: Record<string, PilotSummary> = Object.fromEntries(pilotRows.map((pilot) => [pilot.id, {
        operationCount: 0,
        flightCount: 0,
        totalHours: 0,
        lastFlightAt: null,
        currentOperation: null,
        flights: [],
      }]))
      for (const assignment of assignmentRows) {
        if (!assignment.pilot_id) continue
        const summary = summaries[assignment.pilot_id]
        const operation = operationById.get(assignment.operation_id)
        if (!summary || !operation) continue
        summary.operationCount += 1
        if (!assignment.returned_at && ['preparing', 'in_transit', 'in_operation'].includes(operation.status)) {
          summary.currentOperation = {
            operationNumber: operation.operation_number,
            farmName: farmNames.get(operation.farm_id) ?? 'Finca sin nombre',
          }
        }
      }
      for (const flight of flightRows) {
        const assignment = assignmentByOperationDrone.get(`${flight.operation_id}:${flight.drone_asset_id}`)
        const operation = operationById.get(flight.operation_id)
        if (!assignment?.pilot_id || !operation) continue
        const summary = summaries[assignment.pilot_id]
        if (!summary) continue
        const hours = Number(flight.flight_hours)
        summary.flightCount += 1
        summary.totalHours += hours
        summary.lastFlightAt ??= flight.logged_at
        summary.flights.push({
          id: flight.id,
          operationNumber: operation.operation_number,
          farmName: farmNames.get(operation.farm_id) ?? 'Finca sin nombre',
          droneName: droneNames.get(flight.drone_asset_id) ?? 'Dron',
          loggedAt: flight.logged_at,
          hours,
        })
      }
      setPilots(pilotRows)
      setPilotSummaries(summaries)
      setCanManage(manageResult.data === true)
    }
    setLoading(false)
  }, [userId])

  useEffect(() => {
    const timeout = window.setTimeout(() => void loadData(), 0)
    return () => window.clearTimeout(timeout)
  }, [loadData])

  useEffect(() => {
    const client = supabase
    if (!client || !orgId) return
    const channel = client
      .channel(`pilots-${orgId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'pilots', filter: `org_id=eq.${orgId}` }, () => void loadData())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'operations', filter: `org_id=eq.${orgId}` }, () => void loadData())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'operation_assets', filter: `org_id=eq.${orgId}` }, () => void loadData())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'flight_logs', filter: `org_id=eq.${orgId}` }, () => void loadData())
      .subscribe((status, error) => {
        if ((status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') && error) {
          setLoadError(error.message)
        }
      })
    return () => {
      void client.removeChannel(channel)
    }
  }, [loadData, orgId])

  function openCreate() {
    setEditing(null)
    setDraft(emptyDraft)
    setFormError('')
    setNotice('')
    setFormOpen(true)
  }

  function openEdit(pilot: Pilot) {
    setEditing(pilot)
    setDraft({
      full_name: pilot.full_name,
      phone: pilot.phone ?? '',
      license_number: pilot.license_number ?? '',
      notes: pilot.notes ?? '',
    })
    setFormError('')
    setNotice('')
    setFormOpen(true)
  }

  async function savePilot(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!supabase || !orgId) return
    setSaving(true)
    setFormError('')
    const values = {
      full_name: draft.full_name.trim(),
      phone: draft.phone.trim() || null,
      license_number: draft.license_number.trim() || null,
      notes: draft.notes.trim() || null,
      updated_at: new Date().toISOString(),
    }
    const query = editing
      ? supabase.from('pilots').update(values).eq('id', editing.id).eq('org_id', orgId).select('id').maybeSingle()
      : supabase.from('pilots').insert({ ...values, org_id: orgId }).select('id').single()
    const { data, error } = await query
    if (error) {
      setFormError(error.message)
      setSaving(false)
      return
    }
    if (!data) {
      setFormError('No fue posible guardar el piloto. Verifica tus permisos.')
      setSaving(false)
      return
    }
    setNotice(editing ? 'Datos del piloto actualizados.' : 'Piloto registrado. Ya puedes asignarlo en una operación.')
    setEditing(null)
    setDraft(emptyDraft)
    setFormOpen(false)
    await loadData()
    setSaving(false)
  }

  async function toggleActive(pilot: Pilot) {
    if (!supabase || !orgId) return
    setLoadError('')
    setNotice('')
    const { data, error } = await supabase.from('pilots')
      .update({ active: !pilot.active, updated_at: new Date().toISOString() })
      .eq('id', pilot.id)
      .eq('org_id', orgId)
      .select('id')
      .maybeSingle()
    if (error) {
      setLoadError(error.message)
    } else if (!data) {
      setLoadError('No fue posible cambiar el estado del piloto. Verifica tus permisos.')
    } else {
      setNotice(pilot.active ? 'Piloto desactivado; sus operaciones anteriores se conservan.' : 'Piloto reactivado.')
      await loadData()
    }
  }

  return (
    <motion.section className="pilots-page" initial={reduceMotion ? false : { opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
      <div className="pilots-toolbar">
        <div className="pilots-count"><strong>{loading ? '…' : pilots.length}</strong><span>pilotos registrados</span></div>
        <div className="pilots-toolbar-actions">
          <button className="assets-refresh" type="button" aria-label="Actualizar pilotos" onClick={() => { setLoading(true); void loadData() }} disabled={loading}><RefreshCw size={16} /></button>
          {canManage && <button className="primary-button" type="button" onClick={openCreate}><Plus size={16} /> Registrar piloto</button>}
        </div>
      </div>

      <div className="pilot-access-note"><ShieldCheck size={17} /><span>Los pilotos son personal operativo sin cuenta de acceso. El administrador registra sus datos y los asigna a un dron en cada operación.</span></div>
      {loadError && <div className="inline-error" role="alert"><AlertTriangle size={17} />{loadError}</div>}
      {notice && <div className="inline-success" role="status">{notice}</div>}

      {loading ? (
        <div className="pilots-empty"><span className="asset-loading-mark" /><strong>Cargando pilotos…</strong></div>
      ) : pilots.length ? (
        <div className="pilots-grid">
          {pilots.map((pilot) => {
            const summary = pilotSummaries[pilot.id]
            return (
              <article className={`pilot-card${pilot.active ? '' : ' pilot-card-inactive'}`} key={pilot.id}>
                <div className="pilot-card-top">
                  <span className="pilot-avatar"><UserRound size={18} /></span>
                  <span className={`pilot-status${summary?.currentOperation ? ' pilot-status-busy' : pilot.active ? ' pilot-status-active' : ''}`}><i />{summary?.currentOperation ? 'Ocupado' : pilot.active ? 'Disponible' : 'Inactivo'}</span>
                </div>
                <h2>{pilot.full_name}</h2>
                {summary?.currentOperation && <p className="pilot-current-operation">En operación #{summary.currentOperation.operationNumber} · {summary.currentOperation.farmName}</p>}
                <dl>
                  <div><dt>Teléfono</dt><dd>{pilot.phone || 'No registrado'}</dd></div>
                  <div><dt>Licencia</dt><dd>{pilot.license_number || 'No registrada'}</dd></div>
                  {pilot.notes && <div className="pilot-notes"><dt>Observaciones</dt><dd>{pilot.notes}</dd></div>}
                </dl>
                <div className="pilot-flight-summary"><div><strong>{summary?.flightCount ?? 0}</strong><span>vuelos registrados</span></div><div><strong>{new Intl.NumberFormat('es-CO', { maximumFractionDigits: 2 }).format(summary?.totalHours ?? 0)} h</strong><span>horas de vuelo</span></div><div><strong>{summary?.operationCount ?? 0}</strong><span>operaciones</span></div></div>
                <button className="pilot-history-button" type="button" onClick={() => setHistoryPilot(pilot)}>Ver hoja de vida</button>
                {canManage && (
                  <div className="pilot-card-actions">
                    <button className="pilot-edit-button" type="button" onClick={() => openEdit(pilot)}><Pencil size={14} /> Editar</button>
                    <button className={pilot.active ? 'pilot-deactivate-button' : 'pilot-reactivate-button'} type="button" onClick={() => void toggleActive(pilot)}>{pilot.active ? 'Desactivar' : 'Reactivar'}</button>
                  </div>
                )}
              </article>
            )
          })}
        </div>
      ) : (
        <div className="pilots-empty">
          <span className="pilots-empty-icon"><UserRound size={22} /></span>
          <strong>Aún no hay pilotos registrados</strong>
          <p>Agrega al personal que opera los drones. No necesita cuenta de usuario ni acceso al sistema.</p>
          {canManage && <button className="primary-button" type="button" onClick={openCreate}><Plus size={16} /> Registrar primer piloto</button>}
        </div>
      )}

      <AnimatePresence>
        {canManage && formOpen && (
          <PilotForm
            draft={draft}
            editing={Boolean(editing)}
            saving={saving}
            error={formError}
            reduceMotion={Boolean(reduceMotion)}
            onChange={setDraft}
            onClose={() => { setFormOpen(false); setEditing(null); setDraft(emptyDraft); setFormError('') }}
            onSubmit={savePilot}
          />
        )}
      </AnimatePresence>
      <AnimatePresence>
        {historyPilot && (
          <PilotHistoryModal
            pilot={historyPilot}
            summary={pilotSummaries[historyPilot.id]}
            reduceMotion={Boolean(reduceMotion)}
            onClose={() => setHistoryPilot(null)}
          />
        )}
      </AnimatePresence>
    </motion.section>
  )
}

function PilotHistoryModal({
  pilot,
  summary,
  reduceMotion,
  onClose,
}: {
  pilot: Pilot
  summary: PilotSummary | undefined
  reduceMotion: boolean
  onClose: () => void
}) {
  const flights = summary?.flights ?? []
  return (
    <div className="pilot-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <motion.section className="pilot-modal pilot-history-modal" role="dialog" aria-modal="true" aria-labelledby="pilot-history-title" initial={reduceMotion ? false : { opacity: 0, y: 12, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={reduceMotion ? undefined : { opacity: 0, y: 8, scale: 0.98 }}>
        <div className="pilot-modal-heading"><div><span className="eyebrow">HOJA DE VIDA</span><h2 id="pilot-history-title">{pilot.full_name}</h2><p>Resumen de vuelos y operaciones asignadas.</p></div><button className="icon-button" type="button" aria-label="Cerrar hoja de vida" onClick={onClose}><X size={18} /></button></div>
        <div className="pilot-history-stats"><div><strong>{summary?.flightCount ?? 0}</strong><span>vuelos</span></div><div><strong>{new Intl.NumberFormat('es-CO', { maximumFractionDigits: 2 }).format(summary?.totalHours ?? 0)} h</strong><span>horas acumuladas</span></div><div><strong>{summary?.operationCount ?? 0}</strong><span>operaciones</span></div></div>
        {flights.length ? <div className="pilot-history-list">{flights.map((flight) => <article key={flight.id}><div><strong>Operación #{flight.operationNumber} · {flight.farmName}</strong><span>{flight.droneName} · {new Intl.DateTimeFormat('es-CO', { dateStyle: 'medium' }).format(new Date(flight.loggedAt))}</span></div><b>{new Intl.NumberFormat('es-CO', { maximumFractionDigits: 2 }).format(flight.hours)} h</b></article>)}</div> : <div className="pilots-empty"><strong>Sin vuelos registrados</strong><p>Al regresar un dron de una operación, las horas aparecerán en esta hoja de vida.</p></div>}
        <div className="pilot-form-actions"><button className="secondary-button" type="button" onClick={onClose}>Cerrar</button></div>
      </motion.section>
    </div>
  )
}

function PilotForm({
  draft,
  editing,
  saving,
  error,
  reduceMotion,
  onChange,
  onClose,
  onSubmit,
}: {
  draft: PilotDraft
  editing: boolean
  saving: boolean
  error: string
  reduceMotion: boolean
  onChange: (draft: PilotDraft) => void
  onClose: () => void
  onSubmit: (event: React.FormEvent<HTMLFormElement>) => void
}) {
  return (
    <div className="pilot-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !saving) onClose() }}>
      <motion.section className="pilot-modal" role="dialog" aria-modal="true" aria-labelledby="pilot-form-title"
        initial={reduceMotion ? false : { opacity: 0, y: 12, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={reduceMotion ? undefined : { opacity: 0, y: 8, scale: 0.98 }}>
        <div className="pilot-modal-heading">
          <div><span className="eyebrow">PERSONAL OPERATIVO</span><h2 id="pilot-form-title">{editing ? 'Editar piloto' : 'Registrar piloto'}</h2><p>No se creará una cuenta ni se enviará una invitación.</p></div>
          <button className="icon-button" type="button" aria-label="Cerrar formulario" onClick={onClose} disabled={saving}><X size={18} /></button>
        </div>
        <form className="pilot-form" onSubmit={onSubmit}>
          <label>Nombre completo<input required maxLength={120} autoFocus value={draft.full_name} onChange={(event) => onChange({ ...draft, full_name: event.target.value })} /></label>
          <div className="pilot-form-grid">
            <label>Teléfono <span className="optional-label">Opcional</span><input type="tel" maxLength={40} value={draft.phone} onChange={(event) => onChange({ ...draft, phone: event.target.value })} /></label>
            <label>Licencia de piloto <span className="optional-label">Opcional</span><input maxLength={80} value={draft.license_number} onChange={(event) => onChange({ ...draft, license_number: event.target.value })} /></label>
          </div>
          <label>Observaciones <span className="optional-label">Opcional</span><textarea rows={3} maxLength={1000} value={draft.notes} onChange={(event) => onChange({ ...draft, notes: event.target.value })} /></label>
          {error && <div className="form-error" role="alert">{error}</div>}
          <div className="pilot-form-actions"><button className="secondary-button" type="button" onClick={onClose} disabled={saving}>Cancelar</button><button className="primary-button" type="submit" disabled={saving}>{saving ? 'Guardando…' : editing ? 'Guardar cambios' : 'Registrar piloto'}</button></div>
        </form>
      </motion.section>
    </div>
  )
}
