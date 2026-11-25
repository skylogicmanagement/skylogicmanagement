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

const emptyDraft: PilotDraft = { full_name: '', phone: '', license_number: '', notes: '' }

export function PilotsPage({ userId }: { userId: string }) {
  const reduceMotion = useReducedMotion()
  const [pilots, setPilots] = useState<Pilot[]>([])
  const [orgId, setOrgId] = useState('')
  const [canManage, setCanManage] = useState(false)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [loadError, setLoadError] = useState('')
  const [formError, setFormError] = useState('')
  const [notice, setNotice] = useState('')
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<Pilot | null>(null)
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
    const [pilotsResult, manageResult] = await Promise.all([
      supabase.from('pilots')
        .select('id, full_name, phone, license_number, notes, active, created_at')
        .eq('org_id', membership.org_id)
        .order('full_name'),
      supabase.rpc('has_org_permission', {
        target_org: membership.org_id,
        permission: 'operations.manage',
      }),
    ])
    const error = pilotsResult.error ?? manageResult.error
    if (error) {
      setLoadError(error.message)
    } else {
      setPilots(pilotsResult.data ?? [])
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
          {pilots.map((pilot) => (
            <article className={`pilot-card${pilot.active ? '' : ' pilot-card-inactive'}`} key={pilot.id}>
              <div className="pilot-card-top">
                <span className="pilot-avatar"><UserRound size={18} /></span>
                <span className={`pilot-status${pilot.active ? ' pilot-status-active' : ''}`}><i />{pilot.active ? 'Activo' : 'Inactivo'}</span>
              </div>
              <h2>{pilot.full_name}</h2>
              <dl>
                <div><dt>Teléfono</dt><dd>{pilot.phone || 'No registrado'}</dd></div>
                <div><dt>Licencia</dt><dd>{pilot.license_number || 'No registrada'}</dd></div>
                {pilot.notes && <div className="pilot-notes"><dt>Observaciones</dt><dd>{pilot.notes}</dd></div>}
              </dl>
              {canManage && (
                <div className="pilot-card-actions">
                  <button className="pilot-edit-button" type="button" onClick={() => openEdit(pilot)}><Pencil size={14} /> Editar</button>
                  <button className={pilot.active ? 'pilot-deactivate-button' : 'pilot-reactivate-button'} type="button" onClick={() => void toggleActive(pilot)}>{pilot.active ? 'Desactivar' : 'Reactivar'}</button>
                </div>
              )}
            </article>
          ))}
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
    </motion.section>
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
