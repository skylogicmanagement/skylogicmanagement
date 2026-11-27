import { useCallback, useEffect, useMemo, useState } from 'react'
import { AlertTriangle, Check, MapPin, Pencil, Plus, RefreshCw, X } from 'lucide-react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { supabase } from '../../lib/supabase'
import './farms.css'

type Farm = {
  id: string
  name: string
  municipality: string | null
  department: string | null
  address: string | null
  owner_or_customer: string | null
  contact_name: string | null
  phone: string | null
  notes: string | null
  active: boolean
}
type FarmOperation = { id: string; farm_id: string; departure_at: string | null }
type FlightLog = { farm_id: string; flight_hours: number }
type FarmDraft = {
  name: string
  municipality: string
  department: string
  address: string
  owner_or_customer: string
  contact_name: string
  phone: string
  notes: string
}

const emptyDraft: FarmDraft = {
  name: '',
  municipality: '',
  department: '',
  address: '',
  owner_or_customer: '',
  contact_name: '',
  phone: '',
  notes: '',
}

function formatHours(hours: number) {
  return `${new Intl.NumberFormat('es-CO', { maximumFractionDigits: 2 }).format(hours)} h`
}

function formatDate(value: string | null) {
  if (!value) return 'Sin operaciones'
  return new Intl.DateTimeFormat('es-CO', { dateStyle: 'medium' }).format(new Date(value))
}

export function FarmsPage({ userId }: { userId: string }) {
  const reduceMotion = useReducedMotion()
  const [farms, setFarms] = useState<Farm[]>([])
  const [operations, setOperations] = useState<FarmOperation[]>([])
  const [flightLogs, setFlightLogs] = useState<FlightLog[]>([])
  const [orgId, setOrgId] = useState('')
  const [canManage, setCanManage] = useState(false)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [query, setQuery] = useState('')
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<Farm | null>(null)
  const [draft, setDraft] = useState<FarmDraft>(emptyDraft)

  const loadData = useCallback(async () => {
    if (!supabase) return
    setError('')
    const { data: membership, error: membershipError } = await supabase
      .from('memberships')
      .select('org_id')
      .eq('user_id', userId)
      .eq('active', true)
      .limit(1)
      .maybeSingle()
    if (membershipError || !membership) {
      setError(membershipError?.message ?? 'Tu cuenta no tiene una membresía activa en Sky Logic.')
      setLoading(false)
      return
    }

    setOrgId(membership.org_id)
    const [farmsResult, operationsResult, manageResult, flightReadResult] = await Promise.all([
      supabase.from('farms')
        .select('id, name, municipality, department, address, owner_or_customer, contact_name, phone, notes, active')
        .eq('org_id', membership.org_id)
        .order('name'),
      supabase.from('operations')
        .select('id, farm_id, departure_at')
        .eq('org_id', membership.org_id)
        .order('departure_at', { ascending: false, nullsFirst: false })
        .order('id')
        .range(0, 999),
      supabase.rpc('has_org_permission', { target_org: membership.org_id, permission: 'operations.manage' }),
      supabase.rpc('has_org_permission', { target_org: membership.org_id, permission: 'assets.read' }),
    ])
    const firstError = farmsResult.error ?? operationsResult.error ?? manageResult.error ?? flightReadResult.error
    if (firstError) {
      setError(firstError.message)
      setLoading(false)
      return
    }

    const operationRows = [...(operationsResult.data ?? [])]
    for (let offset = operationRows.length; operationRows.length > 0 && operationRows.length % 1000 === 0; offset += 1000) {
      const { data, error: pageError } = await supabase.from('operations')
        .select('id, farm_id, departure_at')
        .eq('org_id', membership.org_id)
        .order('departure_at', { ascending: false, nullsFirst: false })
        .order('id')
        .range(offset, offset + 999)
      if (pageError) {
        setError(pageError.message)
        setLoading(false)
        return
      }
      operationRows.push(...(data ?? []))
      if (!data || data.length < 1000) break
    }

    const farmRows = farmsResult.data ?? []
    setFarms(farmRows)
    setOperations(operationRows)
    setCanManage(manageResult.data === true)
    if (flightReadResult.data === true) {
      const flightRows: FlightLog[] = []
      let offset = 0
      while (true) {
        const { data, error: flightError } = await supabase
          .from('flight_logs')
          .select('farm_id, flight_hours')
          .eq('org_id', membership.org_id)
          .order('id')
          .range(offset, offset + 999)
        if (flightError) {
          setError(flightError.message)
          setLoading(false)
          return
        }
        flightRows.push(...(data ?? []))
        if (!data || data.length < 1000) break
        offset += 1000
      }
      setFlightLogs(flightRows)
    } else {
      setFlightLogs([])
    }
    setLoading(false)
  }, [userId])

  useEffect(() => {
    const timeout = window.setTimeout(() => void loadData(), 0)
    return () => window.clearTimeout(timeout)
  }, [loadData])

  const operationStats = useMemo(() => {
    const stats = new Map<string, { count: number; lastDate: string | null }>()
    for (const operation of operations) {
      const current = stats.get(operation.farm_id) ?? { count: 0, lastDate: null }
      current.count += 1
      if (operation.departure_at && (!current.lastDate || operation.departure_at > current.lastDate)) current.lastDate = operation.departure_at
      stats.set(operation.farm_id, current)
    }
    return stats
  }, [operations])
  const hourStats = useMemo(() => {
    const totals = new Map<string, number>()
    for (const log of flightLogs) totals.set(log.farm_id, (totals.get(log.farm_id) ?? 0) + Number(log.flight_hours))
    return totals
  }, [flightLogs])
  const visibleFarms = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase()
    if (!normalized) return farms
    return farms.filter((farm) => [farm.name, farm.municipality, farm.department, farm.owner_or_customer]
      .some((value) => value?.toLocaleLowerCase().includes(normalized)))
  }, [farms, query])

  function openCreate() {
    setEditing(null)
    setDraft(emptyDraft)
    setError('')
    setFormOpen(true)
  }

  function openEdit(farm: Farm) {
    setEditing(farm)
    setDraft({
      name: farm.name,
      municipality: farm.municipality ?? '',
      department: farm.department ?? '',
      address: farm.address ?? '',
      owner_or_customer: farm.owner_or_customer ?? '',
      contact_name: farm.contact_name ?? '',
      phone: farm.phone ?? '',
      notes: farm.notes ?? '',
    })
    setError('')
    setFormOpen(true)
  }

  async function saveFarm(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!supabase || !orgId) return
    setSaving(true)
    setError('')
    setNotice('')
    const values = {
      name: draft.name.trim(),
      municipality: draft.municipality.trim() || null,
      department: draft.department.trim() || null,
      address: draft.address.trim() || null,
      owner_or_customer: draft.owner_or_customer.trim() || null,
      contact_name: draft.contact_name.trim() || null,
      phone: draft.phone.trim() || null,
      notes: draft.notes.trim() || null,
    }
    const result = editing
      ? await supabase.from('farms').update(values).eq('id', editing.id).eq('org_id', orgId).select('id').maybeSingle()
      : await supabase.from('farms').insert({ ...values, org_id: orgId }).select('id').single()
    if (result.error) {
      setError(result.error.message)
    } else if (!result.data) {
      setError('No fue posible guardar la finca. Verifica tus permisos.')
    } else {
      setNotice(editing ? 'Datos de la finca actualizados.' : 'Finca registrada.')
      setFormOpen(false)
      setEditing(null)
      await loadData()
    }
    setSaving(false)
  }

  async function toggleActive(farm: Farm) {
    if (!supabase || !orgId) return
    setError('')
    setNotice('')
    const { data, error: updateError } = await supabase.from('farms')
      .update({ active: !farm.active })
      .eq('id', farm.id)
      .eq('org_id', orgId)
      .select('id')
      .maybeSingle()
    if (updateError) setError(updateError.message)
    else if (!data) setError('No fue posible cambiar el estado de la finca. Verifica tus permisos.')
    else {
      setNotice(farm.active ? 'Finca desactivada; su historial de operaciones se conservó.' : 'Finca reactivada.')
      await loadData()
    }
  }

  return (
    <motion.section className="farms-page" initial={reduceMotion ? false : { opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
      <div className="farms-toolbar">
        <div className="farms-count"><strong>{loading ? '…' : farms.length}</strong><span>fincas registradas</span></div>
        <div className="farms-toolbar-actions">
          <input className="farms-search" aria-label="Buscar fincas" placeholder="Buscar finca, municipio o cliente" value={query} onChange={(event) => setQuery(event.target.value)} />
          <button className="icon-button" type="button" aria-label="Actualizar fincas" onClick={() => { setLoading(true); void loadData() }} disabled={loading}><RefreshCw size={16} /></button>
          {canManage && <button className="primary-button" type="button" onClick={openCreate}><Plus size={16} /> Registrar finca</button>}
        </div>
      </div>
      {error && <div className="inline-error" role="alert"><AlertTriangle size={17} />{error}</div>}
      {notice && <div className="inline-success" role="status"><Check size={16} />{notice}</div>}

      {loading ? <div className="farms-empty">Cargando fincas…</div> : visibleFarms.length ? (
        <div className="farms-grid">
          {visibleFarms.map((farm, index) => {
            const stats = operationStats.get(farm.id) ?? { count: 0, lastDate: null }
            return (
              <motion.article className={`farm-card${farm.active ? '' : ' farm-card-inactive'}`} key={farm.id} initial={reduceMotion ? false : { opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={reduceMotion ? { duration: 0 } : { delay: Math.min(index * 0.035, 0.2) }}>
                <div className="farm-card-heading"><span className="farm-icon"><MapPin size={17} /></span><span className={`farm-status${farm.active ? ' farm-status-active' : ''}`}><i />{farm.active ? 'Activa' : 'Inactiva'}</span></div>
                <h2>{farm.name}</h2>
                <p className="farm-location">{[farm.municipality, farm.department].filter(Boolean).join(' · ') || 'Ubicación sin registrar'}</p>
                <div className="farm-stat-grid"><div><strong>{stats.count}</strong><span>operaciones</span></div><div><strong>{formatHours(hourStats.get(farm.id) ?? 0)}</strong><span>horas de vuelo</span></div></div>
                <div className="farm-card-meta"><span>Última salida</span><strong>{formatDate(stats.lastDate)}</strong></div>
                {farm.owner_or_customer && <div className="farm-card-meta"><span>Cliente / propietario</span><strong>{farm.owner_or_customer}</strong></div>}
                {farm.address && <div className="farm-card-meta"><span>Dirección</span><strong>{farm.address}</strong></div>}
                {farm.notes && <p className="farm-notes">{farm.notes}</p>}
                {canManage && <div className="farm-card-actions"><button className="farm-edit-button" type="button" onClick={() => openEdit(farm)}><Pencil size={14} /> Editar finca</button><button className={farm.active ? 'farm-deactivate-button' : 'farm-reactivate-button'} type="button" onClick={() => void toggleActive(farm)}>{farm.active ? 'Desactivar' : 'Reactivar'}</button></div>}
              </motion.article>
            )
          })}
        </div>
      ) : (
        <div className="farms-empty"><span className="farm-icon"><MapPin size={20} /></span><strong>{query ? 'Sin resultados' : 'Aún no hay fincas'}</strong><p>{query ? 'Prueba con otro nombre, municipio o cliente.' : 'Registra tus fincas para consultar las operaciones y horas de vuelo asociadas.'}</p>{canManage && !query && <button className="primary-button" type="button" onClick={openCreate}><Plus size={16} /> Registrar primera finca</button>}</div>
      )}

      <AnimatePresence>
        {formOpen && (
          <motion.div className="farm-modal-backdrop" role="presentation" initial={reduceMotion ? false : { opacity: 0 }} animate={{ opacity: 1 }} exit={reduceMotion ? undefined : { opacity: 0 }} onMouseDown={(event) => { if (event.target === event.currentTarget && !saving) setFormOpen(false) }}>
            <motion.section className="farm-modal" role="dialog" aria-modal="true" aria-labelledby="farm-form-title" initial={reduceMotion ? false : { opacity: 0, y: 12, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={reduceMotion ? undefined : { opacity: 0, y: 8, scale: 0.98 }}>
              <div className="farm-modal-heading"><div><span className="eyebrow">GESTIÓN DE FINCAS</span><h2 id="farm-form-title">{editing ? 'Editar finca' : 'Registrar finca'}</h2></div><button className="icon-button" type="button" aria-label="Cerrar formulario" onClick={() => setFormOpen(false)} disabled={saving}><X size={18} /></button></div>
              <form className="farm-form" onSubmit={(event) => void saveFarm(event)}>
                <label>Nombre de la finca<input autoFocus required maxLength={120} value={draft.name} onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))} /></label>
                <div className="farm-form-grid"><label>Municipio<input maxLength={100} value={draft.municipality ?? ''} onChange={(event) => setDraft((current) => ({ ...current, municipality: event.target.value }))} /></label><label>Departamento<input maxLength={100} value={draft.department ?? ''} onChange={(event) => setDraft((current) => ({ ...current, department: event.target.value }))} /></label></div>
                <label>Dirección o ubicación<input maxLength={240} value={draft.address ?? ''} onChange={(event) => setDraft((current) => ({ ...current, address: event.target.value }))} /></label>
                <div className="farm-form-grid"><label>Cliente / propietario<input maxLength={160} value={draft.owner_or_customer ?? ''} onChange={(event) => setDraft((current) => ({ ...current, owner_or_customer: event.target.value }))} /></label><label>Persona de contacto<input maxLength={120} value={draft.contact_name ?? ''} onChange={(event) => setDraft((current) => ({ ...current, contact_name: event.target.value }))} /></label></div>
                <label>Teléfono de contacto<input type="tel" maxLength={40} value={draft.phone ?? ''} onChange={(event) => setDraft((current) => ({ ...current, phone: event.target.value }))} /></label>
                <label>Observaciones<textarea rows={3} maxLength={1000} value={draft.notes ?? ''} onChange={(event) => setDraft((current) => ({ ...current, notes: event.target.value }))} /></label>
                {error && <div className="form-error" role="alert">{error}</div>}
                <div className="farm-form-actions"><button className="secondary-button" type="button" onClick={() => setFormOpen(false)} disabled={saving}>Cancelar</button><button className="primary-button" type="submit" disabled={saving}>{saving ? 'Guardando…' : editing ? 'Guardar cambios' : 'Registrar finca'}</button></div>
              </form>
            </motion.section>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.section>
  )
}
