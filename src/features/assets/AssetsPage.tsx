import { useCallback, useEffect, useMemo, useState } from 'react'
import { AlertTriangle, Box, CalendarDays, Pencil, Plus, RefreshCw, Search, X } from 'lucide-react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { supabase } from '../../lib/supabase'

type AssetType = { code: string; name: string }
type AssetStatusOption = { code: string; name: string }
type AssetLocation = { id: string; name: string; active: boolean }
type Supplier = { id: string; name: string; active: boolean }
type Member = { user_id: string; display_name: string }
type DroneDetails = {
  asset_id: string
  total_flight_hours: number | null
  hours_since_maintenance: number | null
  last_maintenance_at: string | null
  next_maintenance_hours: number | null
}
type BatteryDetails = { asset_id: string; charge_cycles: number | null; technical_notes: string | null }
type AssetRow = {
  id: string
  org_id: string
  internal_code: string
  name: string
  asset_type_code: string
  serial_number: string | null
  brand: string | null
  model: string | null
  acquired_at: string | null
  supplier_id: string | null
  purchase_document_path: string | null
  acquisition_value: number | null
  status: string
  location_id: string | null
  responsible_user_id: string | null
  notes: string | null
  updated_at: string
}

type AssetDraft = {
  internal_code: string
  name: string
  asset_type_code: string
  serial_number: string
  brand: string
  model: string
  acquired_at: string
  supplier_id: string
  acquisition_value: string
  location_id: string
  responsible_user_id: string
  notes: string
  battery_charge_cycles: string
  battery_technical_notes: string
}

const emptyDraft: AssetDraft = {
  internal_code: '',
  name: '',
  asset_type_code: '',
  serial_number: '',
  brand: '',
  model: '',
  acquired_at: '',
  supplier_id: '',
  acquisition_value: '',
  location_id: '',
  responsible_user_id: '',
  notes: '',
  battery_charge_cycles: '',
  battery_technical_notes: '',
}

export function AssetsPage({ userId }: { userId: string }) {
  const reduceMotion = useReducedMotion()
  const [assets, setAssets] = useState<AssetRow[]>([])
  const [types, setTypes] = useState<AssetType[]>([])
  const [statuses, setStatuses] = useState<AssetStatusOption[]>([])
  const [locations, setLocations] = useState<Record<string, string>>({})
  const [locationOptions, setLocationOptions] = useState<AssetLocation[]>([])
  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [members, setMembers] = useState<Member[]>([])
  const [statusNames, setStatusNames] = useState<Record<string, string>>({})
  const [batteryDetails, setBatteryDetails] = useState<Record<string, { charge_cycles: number | null; technical_notes: string | null }>>({})
  const [droneDetails, setDroneDetails] = useState<Record<string, { total_flight_hours: number | null; hours_since_maintenance: number | null; last_maintenance_at: string | null; next_maintenance_hours: number | null }>>({})
  const [orgId, setOrgId] = useState('')
  const [canManage, setCanManage] = useState(false)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [formError, setFormError] = useState('')
  const [notice, setNotice] = useState('')
  const [query, setQuery] = useState('')
  const [formOpen, setFormOpen] = useState(false)
  const [editingAsset, setEditingAsset] = useState<AssetRow | null>(null)
  const [saving, setSaving] = useState(false)
  const [draft, setDraft] = useState(emptyDraft)

  const loadData = useCallback(async () => {
    if (!supabase) return

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
    const [assetsResult, typesResult, statusesResult, locationsResult, suppliersResult, profilesResult, permissionResult] = await Promise.all([
      supabase
        .from('assets')
        .select('id, org_id, internal_code, name, asset_type_code, serial_number, brand, model, acquired_at, supplier_id, purchase_document_path, acquisition_value, status, location_id, responsible_user_id, notes, updated_at')
        .eq('org_id', membership.org_id)
        .eq('active', true)
        .order('internal_code'),
      supabase
        .from('asset_types')
        .select('code, name')
        .eq('org_id', membership.org_id)
        .eq('active', true)
        .order('name'),
      supabase
        .from('asset_statuses')
        .select('code, name')
        .eq('org_id', membership.org_id)
        .eq('active', true),
      supabase
        .from('locations')
        .select('id, name, active')
        .eq('org_id', membership.org_id)
        .order('name'),
      supabase
        .from('suppliers')
        .select('id, name, active')
        .eq('org_id', membership.org_id)
        .order('name'),
      supabase
        .from('user_profiles')
        .select('user_id, display_name')
        .eq('org_id', membership.org_id)
        .order('display_name'),
      supabase.rpc('has_org_permission', {
        target_org: membership.org_id,
        permission: 'assets.manage',
      }),
    ])

    const error = assetsResult.error ?? typesResult.error ?? statusesResult.error ?? locationsResult.error ?? suppliersResult.error ?? profilesResult.error ?? permissionResult.error
    if (error) {
      setLoadError(error.message)
    } else {
      const assetRows = assetsResult.data ?? []
      setAssets(assetRows)
      setTypes(typesResult.data ?? [])
      setStatuses(statusesResult.data ?? [])
      setStatusNames(Object.fromEntries((statusesResult.data ?? []).map((status) => [status.code, status.name])))
      const locationRows = locationsResult.data ?? []
      setLocationOptions(locationRows)
      setLocations(Object.fromEntries(locationRows.map((location: AssetLocation) => [location.id, `${location.name}${location.active ? '' : ' (inactiva)'}`])))
      setSuppliers(suppliersResult.data ?? [])
      setMembers(profilesResult.data ?? [])
      setCanManage(permissionResult.data === true)

      const droneIds = assetRows.filter((asset) => asset.asset_type_code === 'drone').map((asset) => asset.id)
      const batteryIds = assetRows.filter((asset) => asset.asset_type_code === 'battery').map((asset) => asset.id)
      const droneDetailsQuery = droneIds.length
        ? supabase.from('drone_details').select('asset_id, total_flight_hours, hours_since_maintenance, last_maintenance_at, next_maintenance_hours').in('asset_id', droneIds)
        : Promise.resolve({ data: [] as DroneDetails[], error: null })
      const batteryDetailsQuery = batteryIds.length
        ? supabase.from('battery_details').select('asset_id, charge_cycles, technical_notes').in('asset_id', batteryIds)
        : Promise.resolve({ data: [] as BatteryDetails[], error: null })
      const [dronesResult, batteriesResult] = await Promise.all([
        droneDetailsQuery,
        batteryDetailsQuery,
      ])
      if (dronesResult.error || batteriesResult.error) {
        setLoadError(dronesResult.error?.message ?? batteriesResult.error?.message ?? 'No fue posible cargar los datos técnicos.')
      } else {
        setDroneDetails(Object.fromEntries((dronesResult.data ?? []).map((detail) => [detail.asset_id, detail])))
        setBatteryDetails(Object.fromEntries((batteriesResult.data ?? []).map((detail) => [detail.asset_id, detail])))
      }
    }
    setLoading(false)
  }, [userId])

  useEffect(() => {
    const task = window.setTimeout(() => {
      void loadData()
    }, 0)
    return () => window.clearTimeout(task)
  }, [loadData])

  const filteredAssets = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase()
    if (!normalizedQuery) return assets
    return assets.filter((asset) =>
      [asset.internal_code, asset.name, asset.serial_number, asset.brand, asset.model]
        .some((value) => value?.toLocaleLowerCase().includes(normalizedQuery)),
    )
  }, [assets, query])

  async function handleCreate(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!supabase || !orgId) return

    setSaving(true)
    setFormError('')
    setNotice('')
    const { error } = await supabase.from('assets').insert({
      org_id: orgId,
      internal_code: draft.internal_code.trim(),
      name: draft.name.trim(),
      asset_type_code: draft.asset_type_code,
      serial_number: draft.serial_number.trim() || null,
      brand: draft.brand.trim() || null,
      model: draft.model.trim() || null,
      status: 'unverified',
      acquired_at: draft.acquired_at || null,
      supplier_id: draft.supplier_id || null,
      acquisition_value: draft.acquisition_value === '' ? null : Number(draft.acquisition_value),
      location_id: draft.location_id || null,
      responsible_user_id: draft.responsible_user_id || null,
      notes: draft.notes.trim() || null,
    })

    if (error) {
      setFormError(error.message)
      setSaving(false)
      return
    }

    setDraft(emptyDraft)
    setFormOpen(false)
    setNotice('Activo registrado con estado inicial “Sin verificar”. Confirma sus datos antes de asignarlo.')
    setLoading(true)
    setLoadError('')
    await loadData()
    setSaving(false)
  }

  function openEditForm(asset: AssetRow) {
    const battery = batteryDetails[asset.id]
    setFormError('')
    setEditingAsset(asset)
    setDraft({
      internal_code: asset.internal_code,
      name: asset.name,
      asset_type_code: asset.asset_type_code,
      serial_number: asset.serial_number ?? '',
      brand: asset.brand ?? '',
      model: asset.model ?? '',
      acquired_at: asset.acquired_at ?? '',
      supplier_id: asset.supplier_id ?? '',
      acquisition_value: asset.acquisition_value === null ? '' : String(asset.acquisition_value),
      location_id: asset.location_id ?? '',
      responsible_user_id: asset.responsible_user_id ?? '',
      notes: asset.notes ?? '',
      battery_charge_cycles: battery?.charge_cycles === null || battery?.charge_cycles === undefined ? '' : String(battery.charge_cycles),
      battery_technical_notes: battery?.technical_notes ?? '',
    })
  }

  async function handleEdit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!supabase || !orgId || !editingAsset) return
    setSaving(true)
    setFormError('')
    setNotice('')
    const { error } = await supabase.rpc('update_asset_profile', {
      p_org_id: orgId,
      p_asset_id: editingAsset.id,
      p_internal_code: draft.internal_code.trim(),
      p_name: draft.name.trim(),
      p_serial_number: draft.serial_number.trim() || null,
      p_brand: draft.brand.trim() || null,
      p_model: draft.model.trim() || null,
      p_acquired_at: draft.acquired_at || null,
      p_supplier_id: draft.supplier_id || null,
      p_acquisition_value: draft.acquisition_value === '' ? null : Number(draft.acquisition_value),
      p_location_id: draft.location_id || null,
      p_responsible_user_id: draft.responsible_user_id || null,
      p_notes: draft.notes.trim() || null,
      p_battery_charge_cycles: editingAsset.asset_type_code === 'battery' && draft.battery_charge_cycles !== '' ? Number(draft.battery_charge_cycles) : null,
      p_battery_technical_notes: editingAsset.asset_type_code === 'battery' ? draft.battery_technical_notes.trim() || null : null,
    })
    if (error) {
      setFormError(error.message)
      setSaving(false)
      return
    }

    setEditingAsset(null)
    setNotice('Ficha del activo actualizada. El cambio quedó registrado en el historial.')
    setLoading(true)
    await loadData()
    setSaving(false)
  }

  async function handleStatusChange(assetId: string, status: string) {
    if (!supabase || !orgId) return
    setLoadError('')
    setNotice('')
    const { data, error } = await supabase
      .from('assets')
      .update({ status })
      .eq('id', assetId)
      .eq('org_id', orgId)
      .select('id')
      .maybeSingle()

    if (error) {
      setLoadError(error.message)
      return
    }
    if (!data) {
      setLoadError('No fue posible actualizar el estado. Verifica tus permisos.')
      return
    }

    setAssets((current) => current.map((asset) => asset.id === assetId ? { ...asset, status } : asset))
    setNotice('Estado actualizado. El cambio quedó registrado en el historial.')
  }

  return (
    <motion.section className="assets-page" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
      <div className="assets-toolbar">
        <div className="assets-count"><strong>{loading ? '…' : assets.length}</strong><span>registros activos</span></div>
        <div className="assets-toolbar-actions">
          <label className="asset-search">
            <Search size={16} />
            <input aria-label="Buscar activos" placeholder="Buscar por nombre, código o serial" value={query} onChange={(event) => setQuery(event.target.value)} />
          </label>
          <button className="assets-refresh" type="button" aria-label="Actualizar lista" onClick={() => { setLoading(true); setLoadError(''); void loadData() }} disabled={loading}><RefreshCw size={16} /></button>
          {canManage && <button className="primary-button" type="button" onClick={() => { setFormError(''); setFormOpen(true) }}><Plus size={16} /> Registrar activo</button>}
        </div>
      </div>

      {loadError && <div className="inline-error" role="alert"><AlertTriangle size={17} />{loadError}</div>}
      {notice && <div className="inline-success" role="status">{notice}</div>}

      {formOpen && (
        <div className="asset-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setFormOpen(false) }}>
          <motion.section className="asset-form-card asset-form-card-wide" role="dialog" aria-modal="true" aria-labelledby="asset-form-title" initial={reduceMotion ? false : { opacity: 0, y: 12, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }}>
            <div className="asset-form-heading">
              <div><span className="eyebrow">NUEVO REGISTRO</span><h2 id="asset-form-title">Registrar activo</h2><p>Los datos desconocidos se pueden completar más adelante.</p></div>
              <button className="icon-button" type="button" aria-label="Cerrar formulario" onClick={() => setFormOpen(false)}><X size={18} /></button>
            </div>
            <form className="asset-form" onSubmit={(event) => void handleCreate(event)}>
              <label>Código interno<input required maxLength={60} value={draft.internal_code} onChange={(event) => setDraft({ ...draft, internal_code: event.target.value })} /></label>
              <label>Nombre del activo<input required maxLength={120} value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} /></label>
              <label>Tipo de activo<select required value={draft.asset_type_code} onChange={(event) => setDraft({ ...draft, asset_type_code: event.target.value })}><option value="">Selecciona un tipo</option>{types.map((type) => <option value={type.code} key={type.code}>{type.name}</option>)}</select></label>
              <label>Número de serie <span className="optional-label">Opcional</span><input maxLength={120} value={draft.serial_number} onChange={(event) => setDraft({ ...draft, serial_number: event.target.value })} /></label>
              <label>Marca <span className="optional-label">Opcional</span><input maxLength={100} value={draft.brand} onChange={(event) => setDraft({ ...draft, brand: event.target.value })} /></label>
              <label>Modelo <span className="optional-label">Opcional</span><input maxLength={100} value={draft.model} onChange={(event) => setDraft({ ...draft, model: event.target.value })} /></label>
              <label>Fecha de adquisición <span className="optional-label">Opcional</span><input type="date" value={draft.acquired_at} onChange={(event) => setDraft({ ...draft, acquired_at: event.target.value })} /></label>
              <label>Proveedor <span className="optional-label">Opcional</span><select value={draft.supplier_id} onChange={(event) => setDraft({ ...draft, supplier_id: event.target.value })}><option value="">Sin especificar</option>{suppliers.filter((supplier) => supplier.active).map((supplier) => <option value={supplier.id} key={supplier.id}>{supplier.name}</option>)}</select></label>
              <label>Valor de adquisición (COP) <span className="optional-label">Opcional</span><input type="number" min="0" step="0.01" value={draft.acquisition_value} onChange={(event) => setDraft({ ...draft, acquisition_value: event.target.value })} /></label>
              <label>Ubicación actual <span className="optional-label">Opcional</span><select value={draft.location_id} onChange={(event) => setDraft({ ...draft, location_id: event.target.value })}><option value="">Sin ubicación confirmada</option>{locationOptions.filter((location) => location.active).map((location) => <option value={location.id} key={location.id}>{location.name}</option>)}</select></label>
              <label>Responsable actual <span className="optional-label">Opcional</span><select value={draft.responsible_user_id} onChange={(event) => setDraft({ ...draft, responsible_user_id: event.target.value })}><option value="">Sin responsable asignado</option>{members.map((member) => <option value={member.user_id} key={member.user_id}>{member.display_name}</option>)}</select></label>
              <label className="asset-form-wide">Observaciones<textarea rows={3} value={draft.notes} onChange={(event) => setDraft({ ...draft, notes: event.target.value })} /></label>
              <div className="asset-unverified-note"><AlertTriangle size={16} /><span>El registro comenzará como <strong>Sin verificar</strong>. No se asignará a operaciones hasta confirmar su estado.</span></div>
              {formError && <div className="form-error" role="alert">{formError}</div>}
              <div className="asset-form-actions"><button className="secondary-button" type="button" onClick={() => setFormOpen(false)}>Cancelar</button><button className="primary-button" type="submit" disabled={saving}>{saving ? 'Guardando…' : 'Guardar activo'}</button></div>
            </form>
          </motion.section>
        </div>
      )}

      <AnimatePresence>
        {editingAsset && (
          <div className="asset-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !saving) setEditingAsset(null) }}>
            <motion.section className="asset-form-card asset-form-card-wide" role="dialog" aria-modal="true" aria-labelledby="asset-edit-title" initial={reduceMotion ? false : { opacity: 0, y: 12, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 8, scale: 0.98 }}>
              <div className="asset-form-heading">
                <div><span className="eyebrow">FICHA DE VIDA</span><h2 id="asset-edit-title">Editar {editingAsset.name}</h2><p>Los cambios se guardan en una transacción y quedan en el historial.</p></div>
                <button className="icon-button" type="button" aria-label="Cerrar edición" onClick={() => setEditingAsset(null)} disabled={saving}><X size={18} /></button>
              </div>
              <form className="asset-form" onSubmit={(event) => void handleEdit(event)}>
                <label>Código interno<input required maxLength={60} value={draft.internal_code} onChange={(event) => setDraft({ ...draft, internal_code: event.target.value })} /></label>
                <label>Nombre del activo<input required maxLength={120} value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} /></label>
                <label>Tipo de activo<input value={types.find((type) => type.code === editingAsset.asset_type_code)?.name ?? editingAsset.asset_type_code} readOnly /></label>
                <label>Número de serie <span className="optional-label">Opcional</span><input maxLength={120} value={draft.serial_number} onChange={(event) => setDraft({ ...draft, serial_number: event.target.value })} /></label>
                <label>Marca <span className="optional-label">Opcional</span><input maxLength={100} value={draft.brand} onChange={(event) => setDraft({ ...draft, brand: event.target.value })} /></label>
                <label>Modelo <span className="optional-label">Opcional</span><input maxLength={100} value={draft.model} onChange={(event) => setDraft({ ...draft, model: event.target.value })} /></label>
                <label>Fecha de adquisición <span className="optional-label">Opcional</span><input type="date" value={draft.acquired_at} onChange={(event) => setDraft({ ...draft, acquired_at: event.target.value })} /></label>
                <label>Proveedor <span className="optional-label">Opcional</span><select value={draft.supplier_id} onChange={(event) => setDraft({ ...draft, supplier_id: event.target.value })}><option value="">Sin especificar</option>{suppliers.filter((supplier) => supplier.active || supplier.id === draft.supplier_id).map((supplier) => <option value={supplier.id} key={supplier.id}>{supplier.name}{supplier.active ? '' : ' (inactivo)'}</option>)}</select></label>
                <label>Valor de adquisición (COP) <span className="optional-label">Opcional</span><input type="number" min="0" step="0.01" value={draft.acquisition_value} onChange={(event) => setDraft({ ...draft, acquisition_value: event.target.value })} /></label>
                <label>Ubicación actual <span className="optional-label">Opcional</span><select value={draft.location_id} onChange={(event) => setDraft({ ...draft, location_id: event.target.value })}><option value="">Sin ubicación confirmada</option>{locationOptions.filter((location) => location.active || location.id === draft.location_id).map((location) => <option value={location.id} key={location.id}>{location.name}{location.active ? '' : ' (inactiva)'}</option>)}</select></label>
                <label>Responsable actual <span className="optional-label">Opcional</span><select value={draft.responsible_user_id} onChange={(event) => setDraft({ ...draft, responsible_user_id: event.target.value })}><option value="">Sin responsable asignado</option>{members.map((member) => <option value={member.user_id} key={member.user_id}>{member.display_name}</option>)}</select></label>
                {editingAsset.asset_type_code === 'battery' && <>
                  <label>Ciclos de carga <span className="optional-label">Opcional</span><input type="number" min="0" step="1" value={draft.battery_charge_cycles} onChange={(event) => setDraft({ ...draft, battery_charge_cycles: event.target.value })} /></label>
                  <label className="asset-form-wide">Datos técnicos de batería<textarea rows={3} value={draft.battery_technical_notes} onChange={(event) => setDraft({ ...draft, battery_technical_notes: event.target.value })} /></label>
                </>}
                {editingAsset.asset_type_code === 'drone' && (
                  <div className="asset-technical-summary asset-form-wide">
                    <CalendarDays size={16} />
                    <span>
                      <strong>Horas acumuladas: {droneDetails[editingAsset.id]?.total_flight_hours ?? 'Sin registros'}</strong>
                      <small>
                        Desde el último mantenimiento: {droneDetails[editingAsset.id]?.hours_since_maintenance ?? 'Sin registros'} h.
                        {droneDetails[editingAsset.id]?.last_maintenance_at ? ` Último mantenimiento: ${droneDetails[editingAsset.id].last_maintenance_at}.` : ''}
                        {droneDetails[editingAsset.id]?.next_maintenance_hours ? ` Próxima intervención: ${droneDetails[editingAsset.id].next_maintenance_hours} h.` : ''}
                        {' '}Las horas se acumulan desde los registros de vuelo y no se editan manualmente.
                      </small>
                    </span>
                  </div>
                )}
                <label className="asset-form-wide">Observaciones<textarea rows={3} value={draft.notes} onChange={(event) => setDraft({ ...draft, notes: event.target.value })} /></label>
                {formError && <div className="form-error" role="alert">{formError}</div>}
                <div className="asset-form-actions">
                  <button className="secondary-button" type="button" onClick={() => setEditingAsset(null)} disabled={saving}>Cancelar</button>
                  <button className="primary-button" type="submit" disabled={saving}>{saving ? 'Guardando…' : 'Guardar cambios'}</button>
                </div>
              </form>
            </motion.section>
          </div>
        )}
      </AnimatePresence>

      <div className="assets-panel">
        <div className="assets-panel-heading"><div><h2>Inventario de activos</h2><p>Registros de la organización con estado y número de serie</p></div><span className="assets-total">{filteredAssets.length} registros</span></div>
        {loading ? (
          <div className="assets-empty"><div className="asset-loading-mark" /><strong>Cargando activos…</strong></div>
        ) : filteredAssets.length ? (
          <div className="assets-table-wrap">
            <table className="assets-table">
              <thead><tr><th>Activo</th><th>Tipo</th><th>Marca / modelo</th><th>Número de serie</th><th>Ubicación</th><th>Dato técnico</th><th>Estado</th>{canManage && <th>Ficha</th>}</tr></thead>
              <tbody>
                {filteredAssets.map((asset) => (
                  <tr key={asset.id}>
                    <td><span className="asset-name-cell"><span className="asset-row-icon"><Box size={16} /></span><span><strong>{asset.name}</strong><small>{asset.internal_code}</small></span></span></td>
                    <td>{types.find((type) => type.code === asset.asset_type_code)?.name ?? asset.asset_type_code}</td>
                    <td>{[asset.brand, asset.model].filter(Boolean).join(' · ') || <span className="unknown-value">Pendiente</span>}</td>
                    <td>{asset.serial_number || <span className="unknown-value">Pendiente</span>}</td>
                    <td>{asset.location_id ? locations[asset.location_id] ?? <span className="unknown-value">Ubicación no disponible</span> : <span className="unknown-value">Sin ubicación confirmada</span>}</td>
                    <td>{asset.asset_type_code === 'battery'
                      ? batteryDetails[asset.id]?.charge_cycles === null || batteryDetails[asset.id]?.charge_cycles === undefined
                        ? <span className="unknown-value">Ciclos pendientes</span>
                        : `${batteryDetails[asset.id].charge_cycles} ciclos`
                      : asset.asset_type_code === 'drone'
                        ? droneDetails[asset.id]?.total_flight_hours === null || droneDetails[asset.id]?.total_flight_hours === undefined
                          ? <span className="unknown-value">Horas pendientes</span>
                          : `${droneDetails[asset.id].total_flight_hours} h`
                        : '—'}</td>
                    <td>{canManage ? (
                      <select className="asset-status-select" aria-label={`Cambiar estado de ${asset.name}`} value={asset.status} onChange={(event) => void handleStatusChange(asset.id, event.target.value)}>
                        {statuses.filter((status) => !['in_transit', 'in_operation'].includes(status.code)).map((status) => <option value={status.code} key={status.code}>{status.name}</option>)}
                      </select>
                    ) : <span className={`asset-status-pill asset-status-${asset.status}`}><i />{statusNames[asset.status] ?? asset.status}</span>}</td>
                    {canManage && <td><button className="asset-edit-button" type="button" onClick={() => openEditForm(asset)} aria-label={`Editar ficha de ${asset.name}`}><Pencil size={14} /> Editar</button></td>}
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="assets-mobile-list">
              {filteredAssets.map((asset) => (
                <article className="asset-mobile-card" key={asset.id}>
                  <div className="asset-mobile-top"><span className="asset-row-icon"><Box size={16} /></span><span><strong>{asset.name}</strong><small>{asset.internal_code}</small></span></div>
                  <div className="asset-mobile-meta"><span>{types.find((type) => type.code === asset.asset_type_code)?.name ?? asset.asset_type_code}</span><span>{asset.serial_number || 'Serial pendiente'}</span></div>
                  <div className="asset-mobile-details">
                    <span><small>Marca / modelo</small>{[asset.brand, asset.model].filter(Boolean).join(' · ') || 'Pendiente'}</span>
                    <span><small>Ubicación</small>{asset.location_id ? locations[asset.location_id] ?? 'No disponible' : 'Sin ubicación confirmada'}</span>
                    {asset.asset_type_code === 'battery' && <span><small>Ciclos de carga</small>{batteryDetails[asset.id]?.charge_cycles ?? 'Sin registrar'}</span>}
                    {asset.asset_type_code === 'drone' && <span><small>Horas de vuelo</small>{droneDetails[asset.id]?.total_flight_hours ?? 'Sin registros'}</span>}
                  </div>
                  {canManage ? (
                    <div className="asset-mobile-actions">
                      <select className="asset-status-select" aria-label={`Cambiar estado de ${asset.name}`} value={asset.status} onChange={(event) => void handleStatusChange(asset.id, event.target.value)}>
                        {statuses.filter((status) => !['in_transit', 'in_operation'].includes(status.code)).map((status) => <option value={status.code} key={status.code}>{status.name}</option>)}
                      </select>
                      <button className="asset-edit-button" type="button" onClick={() => openEditForm(asset)}><Pencil size={14} /> Editar ficha</button>
                    </div>
                  ) : <span className={`asset-status-pill asset-status-${asset.status}`}><i />{statusNames[asset.status] ?? asset.status}</span>}
                </article>
              ))}
            </div>
          </div>
        ) : (
          <div className="assets-empty">
            <div className="assets-empty-icon"><Box size={22} /></div>
            <strong>{query ? 'No hay resultados para esa búsqueda' : 'No hay activos que mostrar'}</strong>
            <span>{query ? 'Prueba con otro código, número de serie o nombre.' : 'Los activos aparecerán aquí al registrarlos en Sky Logic.'}</span>
            {!query && canManage && <button className="text-link" onClick={() => setFormOpen(true)}><Plus size={15} /> Registrar el primer activo</button>}
          </div>
        )}
      </div>
    </motion.section>
  )
}
