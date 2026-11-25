import { useCallback, useEffect, useMemo, useState } from 'react'
import { AlertTriangle, Check, ChevronDown, Clock3, MapPin, Plus, RefreshCw, Truck, X } from 'lucide-react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { supabase } from '../../lib/supabase'
import './operations.css'

type Farm = { id: string; name: string; municipality: string | null }
type Asset = { id: string; internal_code: string; name: string; asset_type_code: string; status: string }
type Member = { user_id: string; display_name: string }
type Location = { id: string; name: string }
type Operation = {
  id: string
  operation_number: number
  status: string
  farm_id: string
  municipality: string | null
  field_location: string | null
  departure_at: string | null
  returned_at: string | null
  created_at: string
}
type OperationAsset = {
  id: string
  operation_id: string
  asset_id: string
  returned_at: string | null
  return_condition: string | null
}
type OperationAssetView = OperationAsset & { asset: Asset | null }

const returnConditions = [
  { code: 'good', label: 'En buen estado' },
  { code: 'damaged', label: 'Dañado' },
  { code: 'missing', label: 'Faltante' },
  { code: 'needs_inspection', label: 'Requiere inspección' },
] as const

function localDateTimeValue() {
  const date = new Date(Date.now() - new Date().getTimezoneOffset() * 60_000)
  return date.toISOString().slice(0, 16)
}

function formatDate(value: string | null) {
  if (!value) return 'Pendiente'
  return new Intl.DateTimeFormat('es-CO', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value))
}

export function OperationsPage({ userId }: { userId: string }) {
  const reduceMotion = useReducedMotion()
  const [orgId, setOrgId] = useState('')
  const [operations, setOperations] = useState<Operation[]>([])
  const [operationAssets, setOperationAssets] = useState<OperationAssetView[]>([])
  const [farms, setFarms] = useState<Farm[]>([])
  const [assets, setAssets] = useState<Asset[]>([])
  const [members, setMembers] = useState<Member[]>([])
  const [locations, setLocations] = useState<Location[]>([])
  const [canManage, setCanManage] = useState(false)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [query, setQuery] = useState('')
  const [createOpen, setCreateOpen] = useState(false)
  const [farmOpen, setFarmOpen] = useState(false)
  const [returning, setReturning] = useState<OperationAssetView | null>(null)
  const [profileName, setProfileName] = useState('')
  const [needsProfile, setNeedsProfile] = useState(false)
  const [draft, setDraft] = useState({
    farm_id: '',
    municipality: '',
    field_location: '',
    departure_at: localDateTimeValue(),
    operator_user_id: userId,
    responsible_user_id: userId,
    delivered_by_user_id: userId,
    received_by_user_id: userId,
    asset_ids: [] as string[],
    departure_condition: '',
    notes: '',
  })
  const [farmDraft, setFarmDraft] = useState({ name: '', municipality: '' })
  const [returnDraft, setReturnDraft] = useState({
    condition: 'good',
    returned_by_user_id: userId,
    received_by_user_id: userId,
    location_id: '',
    notes: '',
    hour_meter_start: '',
    hour_meter_end: '',
  })

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

    const currentOrgId = membership.org_id
    setOrgId(currentOrgId)
    const [operationsResult, farmsResult, assetsResult, membershipsResult, profilesResult, locationsResult, permissionResult] =
      await Promise.all([
        supabase
          .from('operations')
          .select('id, operation_number, status, farm_id, municipality, field_location, departure_at, returned_at, created_at')
          .eq('org_id', currentOrgId)
          .order('created_at', { ascending: false })
          .limit(50),
        supabase
          .from('farms')
          .select('id, name, municipality')
          .eq('org_id', currentOrgId)
          .eq('active', true)
          .order('name'),
        supabase
          .from('assets')
          .select('id, internal_code, name, asset_type_code, status')
          .eq('org_id', currentOrgId)
          .eq('active', true)
          .in('status', ['available', 'preparing'])
          .order('internal_code'),
        supabase
          .from('memberships')
          .select('user_id')
          .eq('org_id', currentOrgId)
          .eq('active', true),
        supabase
          .from('user_profiles')
          .select('user_id, display_name')
          .eq('org_id', currentOrgId),
        supabase
          .from('locations')
          .select('id, name')
          .eq('org_id', currentOrgId)
          .eq('active', true)
          .order('name'),
        supabase.rpc('has_org_permission', {
          target_org: currentOrgId,
          permission: 'operations.manage',
        }),
      ])

    const firstError = operationsResult.error
      ?? farmsResult.error
      ?? assetsResult.error
      ?? membershipsResult.error
      ?? profilesResult.error
      ?? locationsResult.error
      ?? permissionResult.error
    if (firstError) {
      setError(firstError.message)
      setLoading(false)
      return
    }

    const profileById = new Map((profilesResult.data ?? []).map((profile) => [profile.user_id, profile.display_name]))
    const activeMembers = (membershipsResult.data ?? []).map(({ user_id }) => ({
      user_id,
      display_name: profileById.get(user_id) ?? `Usuario ${user_id.slice(0, 8)}`,
    }))
    const operationRows = operationsResult.data ?? []
    const operationIds = operationRows.map(({ id }) => id)
    const openAssetsResult = operationIds.length
      ? await supabase
        .from('operation_assets')
        .select('id, operation_id, asset_id, returned_at, return_condition')
        .eq('org_id', currentOrgId)
        .in('operation_id', operationIds)
      : { data: [], error: null }

    if (openAssetsResult.error) {
      setError(openAssetsResult.error.message)
      setLoading(false)
      return
    }

    const assetRows = openAssetsResult.data ?? []
    const assetIds = [...new Set(assetRows.map(({ asset_id }) => asset_id))]
    const relatedAssetsResult = assetIds.length
      ? await supabase
        .from('assets')
        .select('id, internal_code, name, asset_type_code, status')
        .eq('org_id', currentOrgId)
        .in('id', assetIds)
      : { data: [], error: null }

    if (relatedAssetsResult.error) {
      setError(relatedAssetsResult.error.message)
      setLoading(false)
      return
    }

    const assetById = new Map((relatedAssetsResult.data ?? []).map((asset) => [asset.id, asset]))
    setOperations(operationRows)
    setOperationAssets(assetRows.map((row) => ({ ...row, asset: assetById.get(row.asset_id) ?? null })))
    setFarms(farmsResult.data ?? [])
    setAssets(assetsResult.data ?? [])
    setMembers(activeMembers)
    setLocations(locationsResult.data ?? [])
    setCanManage(permissionResult.data === true)
    setNeedsProfile(!profileById.has(userId))
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
      .channel(`operations-${orgId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'operations', filter: `org_id=eq.${orgId}` }, () => void loadData())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'operation_assets', filter: `org_id=eq.${orgId}` }, () => void loadData())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'assets', filter: `org_id=eq.${orgId}` }, () => void loadData())
      .subscribe((status, subscriptionError) => {
        if ((status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') && subscriptionError) {
          setError(subscriptionError.message)
        }
      })
    return () => {
      void client.removeChannel(channel)
    }
  }, [loadData, orgId])

  const farmNames = useMemo(() => new Map(farms.map((farm) => [farm.id, farm.name])), [farms])
  const assetsByOperation = useMemo(() => {
    const grouped = new Map<string, OperationAssetView[]>()
    for (const asset of operationAssets) {
      const current = grouped.get(asset.operation_id) ?? []
      current.push(asset)
      grouped.set(asset.operation_id, current)
    }
    return grouped
  }, [operationAssets])
  const visibleOperations = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase()
    if (!normalized) return operations
    return operations.filter((operation) => {
      const searchable = [
        String(operation.operation_number),
        farmNames.get(operation.farm_id),
        operation.municipality,
        operation.field_location,
      ].join(' ').toLocaleLowerCase()
      return searchable.includes(normalized)
    })
  }, [farmNames, operations, query])
  const drones = assets.filter((asset) => asset.asset_type_code === 'drone')
  const currentUser = members.find((member) => member.user_id === userId)

  async function saveProfile(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!supabase || !orgId) return
    setSaving(true)
    setError('')
    const { error: saveError } = await supabase.from('user_profiles').upsert({
      org_id: orgId,
      user_id: userId,
      display_name: profileName.trim(),
      updated_at: new Date().toISOString(),
    }, { onConflict: 'org_id,user_id' })
    if (saveError) {
      setError(saveError.message)
    } else {
      setNotice('Tu perfil operativo quedó actualizado.')
      await loadData()
    }
    setSaving(false)
  }

  async function createFarm(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!supabase || !orgId) return
    setSaving(true)
    setError('')
    const { data, error: createError } = await supabase
      .from('farms')
      .insert({
        org_id: orgId,
        name: farmDraft.name.trim(),
        municipality: farmDraft.municipality.trim() || null,
      })
      .select('id')
      .single()
    if (createError) {
      setError(createError.message)
    } else {
      setFarmDraft({ name: '', municipality: '' })
      setFarmOpen(false)
      setDraft((current) => ({ ...current, farm_id: data.id, municipality: farmDraft.municipality.trim() }))
      setNotice('Finca registrada.')
      await loadData()
    }
    setSaving(false)
  }

  async function createOperation(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!supabase || !orgId) return
    setSaving(true)
    setError('')
    setNotice('')
    const departureAt = new Date(draft.departure_at)
    const { error: createError } = await supabase.rpc('create_operation_with_assets', {
      p_org_id: orgId,
      p_farm_id: draft.farm_id,
      p_asset_ids: draft.asset_ids,
      p_operator_user_id: draft.operator_user_id,
      p_responsible_user_id: draft.responsible_user_id,
      p_delivered_by_user_id: draft.delivered_by_user_id,
      p_received_by_user_id: draft.received_by_user_id,
      p_departure_condition: draft.departure_condition.trim(),
      p_municipality: draft.municipality.trim() || null,
      p_field_location: draft.field_location.trim() || null,
      p_departure_at: departureAt.toISOString(),
      p_notes: draft.notes.trim() || null,
    })
    if (createError) {
      setError(createError.message)
    } else {
      setCreateOpen(false)
      setDraft((current) => ({
        ...current,
        asset_ids: [],
        departure_condition: '',
        departure_at: localDateTimeValue(),
        notes: '',
      }))
      setNotice('Operación creada y activos asignados en una sola transacción.')
      await loadData()
    }
    setSaving(false)
  }

  async function returnAsset(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!supabase || !orgId || !returning) return
    setSaving(true)
    setError('')
    setNotice('')
    const { error: returnError } = await supabase.rpc('return_operation_asset', {
      p_org_id: orgId,
      p_operation_asset_id: returning.id,
      p_return_condition: returnDraft.condition,
      p_returned_by_user_id: returnDraft.returned_by_user_id,
      p_return_received_by_user_id: returnDraft.received_by_user_id,
      p_return_location_id: returnDraft.location_id || null,
      p_return_notes: returnDraft.notes.trim() || null,
      p_hour_meter_start: returning.asset?.asset_type_code === 'drone' && returnDraft.hour_meter_start !== ''
        ? Number(returnDraft.hour_meter_start)
        : null,
      p_hour_meter_end: returning.asset?.asset_type_code === 'drone' && returnDraft.hour_meter_end !== ''
        ? Number(returnDraft.hour_meter_end)
        : null,
    })
    if (returnError) {
      setError(returnError.message)
    } else {
      setReturning(null)
      setReturnDraft((current) => ({ ...current, notes: '', condition: 'good', location_id: '', hour_meter_start: '', hour_meter_end: '' }))
      setNotice('Regreso registrado. El estado y la disponibilidad del activo se actualizaron.')
      await loadData()
    }
    setSaving(false)
  }

  function toggleAsset(assetId: string) {
    setDraft((current) => ({
      ...current,
      asset_ids: current.asset_ids.includes(assetId)
        ? current.asset_ids.filter((id) => id !== assetId)
        : [...current.asset_ids, assetId],
    }))
  }

  return (
    <motion.section className="operations-page" initial={reduceMotion ? false : { opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
      <div className="operations-toolbar">
        <div className="operations-summary">
          <strong>{loading ? '…' : visibleOperations.length}</strong>
          <span>operaciones recientes</span>
        </div>
        <div className="operations-actions">
          <input
            aria-label="Buscar operaciones"
            className="operations-search"
            placeholder="Buscar por número, finca o municipio"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <button className="icon-button" type="button" aria-label="Actualizar operaciones" onClick={() => { setLoading(true); void loadData() }} disabled={loading}>
            <RefreshCw size={17} />
          </button>
          {canManage && (
            <>
              <button className="secondary-button" type="button" onClick={() => setFarmOpen(true)}><MapPin size={16} /> Nueva finca</button>
              <button className="primary-button" type="button" onClick={() => setCreateOpen(true)}><Plus size={16} /> Nueva operación</button>
            </>
          )}
        </div>
      </div>

      {error && <div className="inline-error" role="alert"><AlertTriangle size={17} />{error}</div>}
      {notice && <div className="inline-success" role="status"><Check size={16} />{notice}</div>}

      {needsProfile && (
        <form className="profile-setup-card" onSubmit={(event) => void saveProfile(event)}>
          <div><strong>Completa tu perfil operativo</strong><p>Tu nombre aparecerá como responsable en las salidas y devoluciones.</p></div>
          <input aria-label="Nombre para mostrar" required maxLength={100} placeholder="Nombre y apellido" value={profileName} onChange={(event) => setProfileName(event.target.value)} />
          <button className="primary-button" type="submit" disabled={saving}>{saving ? 'Guardando…' : 'Guardar perfil'}</button>
        </form>
      )}

      {loading ? (
        <div className="operations-empty"><span className="loading-spinner" />Cargando operaciones…</div>
      ) : visibleOperations.length === 0 ? (
        <div className="operations-empty">
          <span className="operations-empty-icon"><Truck size={23} /></span>
          <strong>{operations.length === 0 ? 'Aún no hay operaciones' : 'No encontramos coincidencias'}</strong>
          <p>{operations.length === 0 ? 'Al registrar una salida, aquí aparecerá su trazabilidad y estado de regreso.' : 'Prueba con otro número, finca o municipio.'}</p>
        </div>
      ) : (
        <div className="operations-list">
          {visibleOperations.map((operation, index) => {
            const listedAssets = assetsByOperation.get(operation.id) ?? []
            const returnedCount = listedAssets.filter((asset) => asset.returned_at).length
            const isOpen = operation.status !== 'completed' && operation.status !== 'cancelled'
            return (
              <motion.article className="operation-card" key={operation.id} initial={reduceMotion ? false : { opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={reduceMotion ? { duration: 0 } : { delay: Math.min(index * 0.035, 0.2) }}>
                <div className="operation-card-header">
                  <div>
                    <span className={`operation-status status-${operation.status}`}>{operation.status === 'completed' ? 'Finalizada' : operation.status === 'cancelled' ? 'Cancelada' : 'En campo'}</span>
                    <h2>Operación #{operation.operation_number}</h2>
                    <p><MapPin size={14} />{farmNames.get(operation.farm_id) ?? 'Finca sin nombre'}{operation.municipality ? ` · ${operation.municipality}` : ''}</p>
                  </div>
                  <div className="operation-date"><Clock3 size={15} /><span>Salida</span><strong>{formatDate(operation.departure_at)}</strong></div>
                </div>
                {operation.field_location && <p className="operation-field-location">{operation.field_location}</p>}
                <div className="operation-assets-list">
                  {listedAssets.map((item) => (
                    <div className="operation-asset-row" key={item.id}>
                      <div className="operation-asset-name">
                        <span className={`asset-type-mark ${item.asset?.asset_type_code === 'drone' ? 'drone-mark' : ''}`}>{item.asset?.asset_type_code === 'drone' ? 'DR' : 'EQ'}</span>
                        <span><strong>{item.asset?.name ?? 'Activo'}</strong><small>{item.asset?.internal_code ?? item.asset_id.slice(0, 8)}</small></span>
                      </div>
                      {item.returned_at ? (
                        <span className={`return-chip return-${item.return_condition ?? 'good'}`}>{returnConditions.find(({ code }) => code === item.return_condition)?.label ?? 'Recibido'} · {formatDate(item.returned_at)}</span>
                      ) : (
                        <div className="operation-return-action">
                          <span className="return-pending">Pendiente de regreso</span>
                          {canManage && <button className="text-button" type="button" onClick={() => { setReturnDraft((current) => ({ ...current, returned_by_user_id: userId, received_by_user_id: userId })); setReturning(item) }}>Registrar regreso <ChevronDown size={14} /></button>}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
                <div className="operation-card-footer">
                  <span>{returnedCount} de {listedAssets.length} activos recibidos</span>
                  {operation.returned_at && <span>Finalizó {formatDate(operation.returned_at)}</span>}
                </div>
                {!isOpen && <span className="sr-only">Operación cerrada</span>}
              </motion.article>
            )
          })}
        </div>
      )}

      <AnimatePresence>
        {createOpen && (
          <Modal title="Registrar salida" onClose={() => setCreateOpen(false)}>
            <form className="operation-form" onSubmit={(event) => void createOperation(event)}>
              <label>Finca<select required value={draft.farm_id} onChange={(event) => {
                const farm = farms.find(({ id }) => id === event.target.value)
                setDraft((current) => ({ ...current, farm_id: event.target.value, municipality: farm?.municipality ?? current.municipality }))
              }}><option value="">Selecciona una finca</option>{farms.map((farm) => <option key={farm.id} value={farm.id}>{farm.name}{farm.municipality ? ` · ${farm.municipality}` : ''}</option>)}</select></label>
              <div className="operation-form-grid">
                <label>Municipio<input value={draft.municipality} onChange={(event) => setDraft((current) => ({ ...current, municipality: event.target.value }))} /></label>
                <label>Ubicación en finca<input value={draft.field_location} onChange={(event) => setDraft((current) => ({ ...current, field_location: event.target.value }))} placeholder="Lote o referencia" /></label>
              </div>
              <label>Fecha y hora de salida<input type="datetime-local" required value={draft.departure_at} onChange={(event) => setDraft((current) => ({ ...current, departure_at: event.target.value }))} /></label>
              <AssetChecklist assets={assets} selected={draft.asset_ids} onToggle={toggleAsset} />
              <label>Condición al salir<textarea rows={2} required maxLength={500} value={draft.departure_condition} onChange={(event) => setDraft((current) => ({ ...current, departure_condition: event.target.value }))} placeholder="Describe la condición de los activos seleccionados" /></label>
              <PeopleFields members={members} values={draft} onChange={(key, value) => setDraft((current) => ({ ...current, [key]: value }))} />
              <label>Observaciones<textarea rows={3} value={draft.notes} onChange={(event) => setDraft((current) => ({ ...current, notes: event.target.value }))} /></label>
              <div className="operation-form-footer"><button className="secondary-button" type="button" onClick={() => setCreateOpen(false)}>Cancelar</button><button className="primary-button" type="submit" disabled={saving || !draft.asset_ids.some((id) => drones.some((drone) => drone.id === id))}>{saving ? 'Registrando…' : 'Confirmar salida'}</button></div>
              {farms.length === 0 && <p className="form-hint">Registra una finca antes de crear una operación.</p>}
            </form>
          </Modal>
        )}
        {farmOpen && (
          <Modal title="Registrar finca" onClose={() => setFarmOpen(false)}>
            <form className="operation-form" onSubmit={(event) => void createFarm(event)}>
              <label>Nombre de la finca<input autoFocus required maxLength={120} value={farmDraft.name} onChange={(event) => setFarmDraft((current) => ({ ...current, name: event.target.value }))} /></label>
              <label>Municipio<input maxLength={100} value={farmDraft.municipality} onChange={(event) => setFarmDraft((current) => ({ ...current, municipality: event.target.value }))} /></label>
              <div className="operation-form-footer"><button className="secondary-button" type="button" onClick={() => setFarmOpen(false)}>Cancelar</button><button className="primary-button" type="submit" disabled={saving}>{saving ? 'Guardando…' : 'Guardar finca'}</button></div>
            </form>
          </Modal>
        )}
        {returning && (
          <Modal title={`Recibir ${returning.asset?.name ?? 'activo'}`} onClose={() => setReturning(null)}>
            <form className="operation-form" onSubmit={(event) => void returnAsset(event)}>
              <label>Condición al regreso<select required value={returnDraft.condition} onChange={(event) => setReturnDraft((current) => ({ ...current, condition: event.target.value }))}>{returnConditions.map((condition) => <option key={condition.code} value={condition.code}>{condition.label}</option>)}</select></label>
              <label>Ubicación de regreso<select value={returnDraft.location_id} onChange={(event) => setReturnDraft((current) => ({ ...current, location_id: event.target.value }))}><option value="">Mantener ubicación actual</option>{locations.map((location) => <option key={location.id} value={location.id}>{location.name}</option>)}</select></label>
              {returning.asset?.asset_type_code === 'drone' && (
                <div className="operation-form-grid">
                  <label>Horómetro inicial<input type="number" min="0" step="0.01" required value={returnDraft.hour_meter_start} onChange={(event) => setReturnDraft((current) => ({ ...current, hour_meter_start: event.target.value }))} /></label>
                  <label>Horómetro final<input type="number" min="0" step="0.01" required value={returnDraft.hour_meter_end} onChange={(event) => setReturnDraft((current) => ({ ...current, hour_meter_end: event.target.value }))} /></label>
                </div>
              )}
              <PeopleFields members={members} values={{ returned_by_user_id: returnDraft.returned_by_user_id, received_by_user_id: returnDraft.received_by_user_id }} onChange={(key, value) => setReturnDraft((current) => ({ ...current, [key === 'returned_by_user_id' ? 'returned_by_user_id' : 'received_by_user_id']: value }))} returning />
              <label>Observaciones<textarea rows={3} value={returnDraft.notes} onChange={(event) => setReturnDraft((current) => ({ ...current, notes: event.target.value }))} /></label>
              <div className="operation-form-footer"><button className="secondary-button" type="button" onClick={() => setReturning(null)}>Cancelar</button><button className="primary-button" type="submit" disabled={saving}>{saving ? 'Registrando…' : 'Confirmar regreso'}</button></div>
            </form>
          </Modal>
        )}
      </AnimatePresence>
      {!currentUser && !loading && <p className="form-hint">Crea tu perfil para que tu nombre aparezca en los registros de operación.</p>}
    </motion.section>
  )
}

function AssetChecklist({ assets, selected, onToggle }: { assets: Asset[]; selected: string[]; onToggle: (id: string) => void }) {
  const drones = assets.filter(({ asset_type_code }) => asset_type_code === 'drone')
  const additional = assets.filter(({ asset_type_code }) => asset_type_code !== 'drone')
  return (
    <fieldset className="asset-checklist">
      <legend>Activos que salen <span>· Selecciona al menos un dron</span></legend>
      {assets.length === 0 ? <p>No hay activos disponibles. Verifica que estén habilitados y en base.</p> : (
        <>
          <div className="asset-checklist-grid">{drones.map((asset) => <AssetCheckbox key={asset.id} asset={asset} selected={selected.includes(asset.id)} onToggle={onToggle} />)}</div>
          {additional.length > 0 && <details className="additional-assets"><summary>Equipos auxiliares y componentes <ChevronDown size={14} /></summary><div className="asset-checklist-grid">{additional.map((asset) => <AssetCheckbox key={asset.id} asset={asset} selected={selected.includes(asset.id)} onToggle={onToggle} />)}</div></details>}
        </>
      )}
    </fieldset>
  )
}

function AssetCheckbox({ asset, selected, onToggle }: { asset: Asset; selected: boolean; onToggle: (id: string) => void }) {
  return (
    <label className={`asset-checkbox ${selected ? 'asset-checkbox-selected' : ''}`}>
      <input type="checkbox" checked={selected} onChange={() => onToggle(asset.id)} />
      <span className="asset-checkbox-copy"><strong>{asset.name}</strong><small>{asset.internal_code} · {asset.status === 'preparing' ? 'En preparación' : 'Disponible'}</small></span>
      {selected && <Check size={16} />}
    </label>
  )
}

function PeopleFields({
  members,
  values,
  onChange,
  returning = false,
}: {
  members: Member[]
  values: Record<string, string | string[]>
  onChange: (key: string, value: string) => void
  returning?: boolean
}) {
  const fields = returning
    ? [['returned_by_user_id', 'Entrega'], ['received_by_user_id', 'Recibe']]
    : [['operator_user_id', 'Operador'], ['responsible_user_id', 'Responsable'], ['delivered_by_user_id', 'Entrega'], ['received_by_user_id', 'Recibe']]
  return (
    <div className="people-fields-grid">
      {fields.map(([key, label]) => (
        <label key={key}>{label}<select required value={typeof values[key] === 'string' ? values[key] : ''} onChange={(event) => onChange(key, event.target.value)}><option value="">Selecciona una persona</option>{members.map((member) => <option key={member.user_id} value={member.user_id}>{member.display_name}</option>)}</select></label>
      ))}
    </div>
  )
}

function Modal({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) {
  const reduceMotion = useReducedMotion()
  return (
    <motion.div className="operation-modal-backdrop" role="presentation" initial={reduceMotion ? false : { opacity: 0 }} animate={{ opacity: 1 }} exit={reduceMotion ? undefined : { opacity: 0 }} onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <motion.section className="operation-modal" role="dialog" aria-modal="true" aria-label={title} initial={reduceMotion ? false : { opacity: 0, y: 14, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={reduceMotion ? undefined : { opacity: 0, y: 10, scale: 0.98 }}>
        <div className="operation-modal-heading"><div><span className="eyebrow">SKY LOGIC · OPERACIONES</span><h2>{title}</h2></div><button className="icon-button" type="button" aria-label="Cerrar" onClick={onClose}><X size={18} /></button></div>
        {children}
      </motion.section>
    </motion.div>
  )
}
