import { useCallback, useEffect, useMemo, useState } from 'react'
import { AlertTriangle, Box, Plus, RefreshCw, Search, X } from 'lucide-react'
import { motion } from 'motion/react'
import { supabase } from '../../lib/supabase'

type AssetType = { code: string; name: string }
type AssetStatusOption = { code: string; name: string }
type AssetLocation = { id: string; name: string }
type AssetRow = {
  id: string
  internal_code: string
  name: string
  asset_type_code: string
  serial_number: string | null
  brand: string | null
  model: string | null
  status: string
  location_id: string | null
  updated_at: string
}

type AssetDraft = {
  internal_code: string
  name: string
  asset_type_code: string
  serial_number: string
  brand: string
  model: string
}

const emptyDraft: AssetDraft = {
  internal_code: '',
  name: '',
  asset_type_code: '',
  serial_number: '',
  brand: '',
  model: '',
}

export function AssetsPage({ userId }: { userId: string }) {
  const [assets, setAssets] = useState<AssetRow[]>([])
  const [types, setTypes] = useState<AssetType[]>([])
  const [statuses, setStatuses] = useState<AssetStatusOption[]>([])
  const [locations, setLocations] = useState<Record<string, string>>({})
  const [statusNames, setStatusNames] = useState<Record<string, string>>({})
  const [orgId, setOrgId] = useState('')
  const [canManage, setCanManage] = useState(false)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [formError, setFormError] = useState('')
  const [notice, setNotice] = useState('')
  const [query, setQuery] = useState('')
  const [formOpen, setFormOpen] = useState(false)
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
    const [assetsResult, typesResult, statusesResult, locationsResult, permissionResult] = await Promise.all([
      supabase
        .from('assets')
        .select('id, internal_code, name, asset_type_code, serial_number, brand, model, status, location_id, updated_at')
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
        .select('id, name')
        .eq('org_id', membership.org_id)
        .eq('active', true),
      supabase.rpc('has_org_permission', {
        target_org: membership.org_id,
        permission: 'assets.manage',
      }),
    ])

    const error = assetsResult.error ?? typesResult.error ?? statusesResult.error ?? locationsResult.error ?? permissionResult.error
    if (error) {
      setLoadError(error.message)
    } else {
      setAssets(assetsResult.data ?? [])
      setTypes(typesResult.data ?? [])
      setStatuses(statusesResult.data ?? [])
      setStatusNames(Object.fromEntries((statusesResult.data ?? []).map((status) => [status.code, status.name])))
      setLocations(Object.fromEntries((locationsResult.data ?? []).map((location: AssetLocation) => [location.id, location.name])))
      setCanManage(permissionResult.data === true)
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
          <motion.section className="asset-form-card" role="dialog" aria-modal="true" aria-labelledby="asset-form-title" initial={{ opacity: 0, y: 12, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }}>
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
              <div className="asset-unverified-note"><AlertTriangle size={16} /><span>El registro comenzará como <strong>Sin verificar</strong>. No se asignará a operaciones hasta confirmar su estado.</span></div>
              {formError && <div className="form-error" role="alert">{formError}</div>}
              <div className="asset-form-actions"><button className="secondary-button" type="button" onClick={() => setFormOpen(false)}>Cancelar</button><button className="primary-button" type="submit" disabled={saving}>{saving ? 'Guardando…' : 'Guardar activo'}</button></div>
            </form>
          </motion.section>
        </div>
      )}

      <div className="assets-panel">
        <div className="assets-panel-heading"><div><h2>Inventario de activos</h2><p>Registros de la organización con estado y número de serie</p></div><span className="assets-total">{filteredAssets.length} registros</span></div>
        {loading ? (
          <div className="assets-empty"><div className="asset-loading-mark" /><strong>Cargando activos…</strong></div>
        ) : filteredAssets.length ? (
          <div className="assets-table-wrap">
            <table className="assets-table">
              <thead><tr><th>Activo</th><th>Tipo</th><th>Número de serie</th><th>Ubicación</th><th>Estado</th></tr></thead>
              <tbody>
                {filteredAssets.map((asset) => (
                  <tr key={asset.id}>
                    <td><span className="asset-name-cell"><span className="asset-row-icon"><Box size={16} /></span><span><strong>{asset.name}</strong><small>{asset.internal_code}</small></span></span></td>
                    <td>{types.find((type) => type.code === asset.asset_type_code)?.name ?? asset.asset_type_code}</td>
                    <td>{asset.serial_number || <span className="unknown-value">Pendiente</span>}</td>
                    <td>{asset.location_id ? locations[asset.location_id] ?? <span className="unknown-value">Ubicación no disponible</span> : <span className="unknown-value">Sin ubicación confirmada</span>}</td>
                    <td>{canManage ? (
                      <select className="asset-status-select" aria-label={`Cambiar estado de ${asset.name}`} value={asset.status} onChange={(event) => void handleStatusChange(asset.id, event.target.value)}>
                        {statuses.filter((status) => !['in_transit', 'in_operation'].includes(status.code)).map((status) => <option value={status.code} key={status.code}>{status.name}</option>)}
                      </select>
                    ) : <span className={`asset-status-pill asset-status-${asset.status}`}><i />{statusNames[asset.status] ?? asset.status}</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="assets-mobile-list">
              {filteredAssets.map((asset) => (
                <article className="asset-mobile-card" key={asset.id}>
                  <div className="asset-mobile-top"><span className="asset-row-icon"><Box size={16} /></span><span><strong>{asset.name}</strong><small>{asset.internal_code}</small></span></div>
                  <div className="asset-mobile-meta"><span>{types.find((type) => type.code === asset.asset_type_code)?.name ?? asset.asset_type_code}</span><span>{asset.serial_number || 'Serial pendiente'}</span></div>
                  {canManage ? (
                    <select className="asset-status-select" aria-label={`Cambiar estado de ${asset.name}`} value={asset.status} onChange={(event) => void handleStatusChange(asset.id, event.target.value)}>
                      {statuses.filter((status) => !['in_transit', 'in_operation'].includes(status.code)).map((status) => <option value={status.code} key={status.code}>{status.name}</option>)}
                    </select>
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
