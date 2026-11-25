import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  AlertTriangle,
  ArrowDownLeft,
  ArrowLeftRight,
  ArrowUpRight,
  Check,
  CircleDollarSign,
  Package,
  Plus,
  RefreshCw,
  Search,
  X,
} from 'lucide-react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { supabase } from '../../lib/supabase'
import './inventory.css'

type InventoryItem = {
  id: string
  internal_code: string
  name: string
  category: string
  manufacturer_reference: string | null
  unit: string
  quantity_on_hand: number
  location_id: string | null
  supplier_id: string | null
  unit_value: number | null
  active: boolean
  notes: string | null
  is_serialized: boolean
  serial_number: string | null
  manufacturer: string | null
  model: string | null
  acquired_on: string | null
}

type InventoryBalance = { item_id: string; location_id: string | null; quantity_on_hand: number }
type Location = { id: string; name: string; active: boolean }
type Supplier = { id: string; name: string }
type Asset = { id: string; internal_code: string; name: string }
type MaintenanceRecord = { id: string; asset_id: string; performed_at: string; status: string }
type InventoryMovement = {
  id: string
  item_id: string
  movement_type: string
  quantity_delta: number
  maintenance_record_id: string | null
  asset_id: string | null
  source_location_id: string | null
  target_location_id: string | null
  reason: string | null
  created_by: string
  created_at: string
}

type ItemDraft = {
  internal_code: string
  name: string
  category: string
  unit: string
  opening_quantity: string
  location_id: string
  is_serialized: boolean
  serial_number: string
  manufacturer: string
  model: string
  manufacturer_reference: string
  acquired_on: string
  supplier_id: string
  unit_value: string
  notes: string
}

type MovementDraft = {
  item_id: string
  movement_type: string
  quantity: string
  source_location_id: string
  target_location_id: string
  asset_id: string
  maintenance_record_id: string
  reason: string
}

const emptyItemDraft: ItemDraft = {
  internal_code: '',
  name: '',
  category: '',
  unit: 'unidad',
  opening_quantity: '0',
  location_id: '',
  is_serialized: false,
  serial_number: '',
  manufacturer: '',
  model: '',
  manufacturer_reference: '',
  acquired_on: '',
  supplier_id: '',
  unit_value: '',
  notes: '',
}

const emptyMovementDraft: MovementDraft = {
  item_id: '',
  movement_type: 'purchase',
  quantity: '',
  source_location_id: '',
  target_location_id: '',
  asset_id: '',
  maintenance_record_id: '',
  reason: '',
}

const movementOptions = [
  { code: 'purchase', label: 'Entrada por compra', direction: 'in' },
  { code: 'return', label: 'Devolución', direction: 'in' },
  { code: 'repair_return', label: 'Retorno de reparación', direction: 'in' },
  { code: 'installation', label: 'Instalación en activo', direction: 'out' },
  { code: 'consumption', label: 'Salida por consumo', direction: 'out' },
  { code: 'repair_sent', label: 'Envío a reparación', direction: 'out' },
  { code: 'write_off', label: 'Baja', direction: 'out' },
  { code: 'transfer', label: 'Traslado entre ubicaciones', direction: 'transfer' },
]

function formatQuantity(value: number, unit: string) {
  return `${new Intl.NumberFormat('es-CO', { maximumFractionDigits: 3 }).format(value)} ${unit}`
}

function formatCurrency(value: number | null) {
  if (value === null) return 'Sin valor'
  return new Intl.NumberFormat('es-CO', {
    style: 'currency',
    currency: 'COP',
    maximumFractionDigits: 0,
  }).format(value)
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat('es-CO', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value))
}

function movementLabel(code: string) {
  return movementOptions.find((option) => option.code === code)?.label ?? code
}

function getErrorMessage(error: { message: string }) {
  if (error.message.includes('Inventory movement exceeds')) return 'La cantidad supera las existencias disponibles en esa ubicación.'
  if (error.message.includes('Transfer exceeds')) return 'No hay suficiente existencia en la ubicación de origen.'
  if (error.message.includes('duplicate key')) return 'El código interno o número de serie ya está registrado.'
  return error.message
}

export function InventoryPage() {
  const reduceMotion = useReducedMotion()
  const [orgId, setOrgId] = useState('')
  const [items, setItems] = useState<InventoryItem[]>([])
  const [balances, setBalances] = useState<InventoryBalance[]>([])
  const [locations, setLocations] = useState<Location[]>([])
  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [assets, setAssets] = useState<Asset[]>([])
  const [maintenanceRecords, setMaintenanceRecords] = useState<MaintenanceRecord[]>([])
  const [movements, setMovements] = useState<InventoryMovement[]>([])
  const [canManage, setCanManage] = useState(false)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [query, setQuery] = useState('')
  const [itemModalOpen, setItemModalOpen] = useState(false)
  const [movementModalOpen, setMovementModalOpen] = useState(false)
  const [itemDraft, setItemDraft] = useState<ItemDraft>(emptyItemDraft)
  const [movementDraft, setMovementDraft] = useState<MovementDraft>(emptyMovementDraft)

  const loadData = useCallback(async () => {
    if (!supabase) return
    setError('')
    const { data: userData, error: userError } = await supabase.auth.getUser()
    if (userError || !userData.user) {
      setError(userError?.message ?? 'No se encontró una sesión activa.')
      setLoading(false)
      return
    }

    const { data: membership, error: membershipError } = await supabase
      .from('memberships')
      .select('org_id')
      .eq('user_id', userData.user.id)
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
    const [readPermission, managePermission] = await Promise.all([
      supabase.rpc('has_org_permission', { target_org: currentOrgId, permission: 'inventory.read' }),
      supabase.rpc('has_org_permission', { target_org: currentOrgId, permission: 'inventory.manage' }),
    ])
    if (readPermission.error || managePermission.error) {
      setError(readPermission.error?.message ?? managePermission.error?.message ?? 'No fue posible consultar tus permisos.')
      setLoading(false)
      return
    }
    if (!readPermission.data && !managePermission.data) {
      setError('Tu rol no tiene permiso para consultar el inventario.')
      setLoading(false)
      return
    }

    const [
      itemsResult,
      balancesResult,
      locationsResult,
      suppliersResult,
      movementsResult,
      assetsResult,
      maintenanceResult,
    ] = await Promise.all([
      supabase.from('inventory_items')
        .select('id, internal_code, name, category, manufacturer_reference, unit, quantity_on_hand, location_id, supplier_id, unit_value, active, notes, is_serialized, serial_number, manufacturer, model, acquired_on')
        .eq('org_id', currentOrgId)
        .eq('active', true)
        .order('internal_code'),
      supabase.from('inventory_location_balances')
        .select('item_id, location_id, quantity_on_hand')
        .eq('org_id', currentOrgId),
      supabase.from('locations')
        .select('id, name, active')
        .eq('org_id', currentOrgId)
        .order('name'),
      supabase.from('suppliers')
        .select('id, name')
        .eq('org_id', currentOrgId)
        .eq('active', true)
        .order('name'),
      supabase.from('inventory_movements')
        .select('id, item_id, movement_type, quantity_delta, maintenance_record_id, asset_id, source_location_id, target_location_id, reason, created_by, created_at')
        .eq('org_id', currentOrgId)
        .order('created_at', { ascending: false })
        .limit(60),
      supabase.from('assets')
        .select('id, internal_code, name')
        .eq('org_id', currentOrgId)
        .eq('active', true)
        .order('internal_code'),
      supabase.from('maintenance_records')
        .select('id, asset_id, performed_at, status')
        .eq('org_id', currentOrgId)
        .order('performed_at', { ascending: false })
        .limit(100),
    ])
    const firstError = itemsResult.error
      ?? balancesResult.error
      ?? locationsResult.error
      ?? suppliersResult.error
      ?? movementsResult.error
      ?? assetsResult.error
      ?? maintenanceResult.error
    if (firstError) {
      setError(firstError.message)
      setLoading(false)
      return
    }
    setItems(itemsResult.data ?? [])
    setBalances(balancesResult.data ?? [])
    setLocations(locationsResult.data ?? [])
    setSuppliers(suppliersResult.data ?? [])
    setMovements(movementsResult.data ?? [])
    setAssets(assetsResult.data ?? [])
    setMaintenanceRecords(maintenanceResult.data ?? [])
    setCanManage(managePermission.data === true)
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
      .channel(`inventory-${orgId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'inventory_items', filter: `org_id=eq.${orgId}` }, () => void loadData())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'inventory_movements', filter: `org_id=eq.${orgId}` }, () => void loadData())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'inventory_location_balances', filter: `org_id=eq.${orgId}` }, () => void loadData())
      .subscribe((status, subscriptionError) => {
        if ((status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') && subscriptionError) {
          setError(subscriptionError.message)
        }
      })
    return () => { void client.removeChannel(channel) }
  }, [loadData, orgId])

  const itemNames = useMemo(() => new Map(items.map((item) => [item.id, `${item.name} · ${item.internal_code}`])), [items])
  const locationNames = useMemo(() => new Map(locations.map((location) => [location.id, location.name])), [locations])
  const supplierNames = useMemo(() => new Map(suppliers.map((supplier) => [supplier.id, supplier.name])), [suppliers])
  const assetNames = useMemo(() => new Map(assets.map((asset) => [asset.id, `${asset.name} · ${asset.internal_code}`])), [assets])
  const filteredItems = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase()
    if (!normalized) return items
    return items.filter((item) => [
      item.internal_code,
      item.name,
      item.category,
      item.serial_number,
      item.manufacturer,
      item.model,
      item.manufacturer_reference,
    ].some((value) => value?.toLocaleLowerCase().includes(normalized)))
  }, [items, query])
  const selectedItem = items.find((item) => item.id === movementDraft.item_id)
  const selectedMovement = movementOptions.find((option) => option.code === movementDraft.movement_type)
  const selectedItemBalances = balances.filter((balance) => balance.item_id === selectedItem?.id && balance.quantity_on_hand > 0)
  const availableSourceLocations = selectedItemBalances
  const destinationLocations = locations.filter((location) => location.active && location.id !== movementDraft.source_location_id)
  const linkedMaintenanceRecords = maintenanceRecords.filter((record) =>
    (!movementDraft.asset_id || record.asset_id === movementDraft.asset_id)
      && (record.status === 'open' || record.status === 'in_progress' || record.status === 'completed'))
  const itemsWithStock = items.filter((item) => Number(item.quantity_on_hand) > 0).length
  const totalValue = items.reduce((sum, item) => sum + Number(item.quantity_on_hand) * Number(item.unit_value ?? 0), 0)
  const serializedCount = items.filter((item) => item.is_serialized).length
  const emptyCount = items.filter((item) => Number(item.quantity_on_hand) === 0).length

  function openMovementForm(itemId = '') {
    setMovementDraft({ ...emptyMovementDraft, item_id: itemId })
    setError('')
    setNotice('')
    setMovementModalOpen(true)
  }

  async function createItem(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!supabase || !orgId) return
    setSaving(true)
    setError('')
    setNotice('')
    const { error: createError } = await supabase.rpc('create_inventory_item', {
      p_org_id: orgId,
      p_internal_code: itemDraft.internal_code.trim(),
      p_name: itemDraft.name.trim(),
      p_category: itemDraft.category.trim(),
      p_unit: itemDraft.unit.trim(),
      p_opening_quantity: Number(itemDraft.opening_quantity),
      p_location_id: itemDraft.location_id || null,
      p_is_serialized: itemDraft.is_serialized,
      p_serial_number: itemDraft.serial_number.trim() || null,
      p_manufacturer: itemDraft.manufacturer.trim() || null,
      p_model: itemDraft.model.trim() || null,
      p_manufacturer_reference: itemDraft.manufacturer_reference.trim() || null,
      p_acquired_on: itemDraft.acquired_on || null,
      p_supplier_id: itemDraft.supplier_id || null,
      p_unit_value: itemDraft.unit_value === '' ? null : Number(itemDraft.unit_value),
      p_notes: itemDraft.notes.trim() || null,
    })
    if (createError) {
      setError(getErrorMessage(createError))
    } else {
      setItemModalOpen(false)
      setItemDraft(emptyItemDraft)
      setNotice('Artículo registrado. La existencia inicial quedó guardada como movimiento.')
      await loadData()
    }
    setSaving(false)
  }

  async function recordMovement(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!supabase || !orgId || !selectedMovement) return
    setSaving(true)
    setError('')
    setNotice('')
    const { error: movementError } = await supabase.rpc('record_inventory_movement', {
      p_org_id: orgId,
      p_item_id: movementDraft.item_id,
      p_movement_type: movementDraft.movement_type,
      p_quantity: Number(movementDraft.quantity),
      p_reason: movementDraft.reason.trim() || null,
      p_source_location_id: movementDraft.source_location_id === '__unassigned__' ? null : movementDraft.source_location_id || null,
      p_target_location_id: movementDraft.target_location_id || null,
      p_asset_id: movementDraft.asset_id || null,
      p_maintenance_record_id: movementDraft.maintenance_record_id || null,
    })
    if (movementError) {
      setError(getErrorMessage(movementError))
    } else {
      setMovementModalOpen(false)
      setMovementDraft(emptyMovementDraft)
      setNotice('Movimiento registrado y existencias actualizadas de forma transaccional.')
      await loadData()
    }
    setSaving(false)
  }

  return (
    <motion.section className="inventory-page" initial={reduceMotion ? false : { opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
      <div className="inventory-toolbar">
        <div>
          <strong>Control de repuestos</strong>
          <span>Existencias por ubicación y trazabilidad de movimientos</span>
        </div>
        <div className="inventory-actions">
          <label className="inventory-search">
            <Search size={16} />
            <input aria-label="Buscar artículos" placeholder="Buscar código, nombre o serie" value={query} onChange={(event) => setQuery(event.target.value)} />
          </label>
          <button className="icon-button" type="button" aria-label="Actualizar inventario" onClick={() => { setLoading(true); void loadData() }} disabled={loading}><RefreshCw size={17} /></button>
          {canManage && <>
            <button className="secondary-button" type="button" onClick={() => openMovementForm()}><ArrowLeftRight size={16} /> Registrar movimiento</button>
            <button className="primary-button" type="button" onClick={() => { setError(''); setNotice(''); setItemModalOpen(true) }}><Plus size={16} /> Nuevo artículo</button>
          </>}
        </div>
      </div>

      {error && <div className="inline-error" role="alert"><AlertTriangle size={17} />{error}</div>}
      {notice && <div className="inline-success" role="status"><Check size={16} />{notice}</div>}

      <div className="inventory-stats">
        <article><span className="inventory-stat-icon inventory-stat-blue"><Package size={18} /></span><div><strong>{items.length}</strong><small>Artículos activos</small></div></article>
        <article><span className="inventory-stat-icon inventory-stat-green"><ArrowDownLeft size={18} /></span><div><strong>{itemsWithStock}</strong><small>Artículos con existencia</small></div></article>
        <article><span className="inventory-stat-icon inventory-stat-amber"><CircleDollarSign size={18} /></span><div><strong>{formatCurrency(totalValue)}</strong><small>Valor estimado del stock</small></div></article>
        <article><span className="inventory-stat-icon inventory-stat-purple"><AlertTriangle size={18} /></span><div><strong>{emptyCount}</strong><small>Sin existencias</small></div></article>
      </div>

      <section className="inventory-section">
        <div className="inventory-section-heading">
          <div><h2>Artículos</h2><p>El stock se modifica únicamente mediante movimientos registrados.</p></div>
          <span>{serializedCount} serializados</span>
        </div>
        {loading ? <div className="inventory-empty">Cargando inventario…</div> : filteredItems.length === 0 ? (
          <div className="inventory-empty"><Package size={26} /><strong>{query ? 'Sin resultados' : 'Aún no hay artículos'}</strong><span>{query ? 'Prueba con otro código, nombre o número de serie.' : 'Registra el primer repuesto para comenzar a controlar existencias.'}</span></div>
        ) : (
          <div className="inventory-item-list">
            {filteredItems.map((item) => {
              const itemBalances = balances.filter((balance) => balance.item_id === item.id && balance.quantity_on_hand > 0)
              const locationSummary = itemBalances.length
                ? itemBalances.map((balance) => `${locationNames.get(balance.location_id ?? '') ?? 'Sin ubicación'} · ${formatQuantity(Number(balance.quantity_on_hand), item.unit)}`).join(' / ')
                : 'Sin ubicación con existencias'
              return (
                <article className="inventory-item-card" key={item.id}>
                  <div className="inventory-item-identity">
                    <span className="inventory-item-icon"><Package size={18} /></span>
                    <div><strong>{item.name}</strong><span>{item.internal_code} · {item.category}{item.is_serialized ? ' · Serializado' : ''}</span></div>
                  </div>
                  <div className="inventory-item-details">
                    {item.serial_number && <span><small>N.º de serie</small><strong>{item.serial_number}</strong></span>}
                    <span><small>Existencia</small><strong>{formatQuantity(Number(item.quantity_on_hand), item.unit)}</strong></span>
                    <span><small>Ubicación(es)</small><strong>{locationSummary}</strong></span>
                    <span><small>Fabricante / modelo</small><strong>{[item.manufacturer, item.model, item.manufacturer_reference].filter(Boolean).join(' · ') || '—'}</strong></span>
                    <span><small>Proveedor</small><strong>{supplierNames.get(item.supplier_id ?? '') ?? '—'}</strong></span>
                    <span><small>Valor unitario</small><strong>{formatCurrency(item.unit_value)}</strong></span>
                  </div>
                  {canManage && <button className="inventory-item-move" type="button" onClick={() => openMovementForm(item.id)} aria-label={`Registrar movimiento de ${item.name}`}><ArrowLeftRight size={16} /><span>Movimiento</span></button>}
                </article>
              )
            })}
          </div>
        )}
      </section>

      <section className="inventory-section">
        <div className="inventory-section-heading">
          <div><h2>Movimientos recientes</h2><p>Registro histórico de entradas, consumos, instalaciones y traslados.</p></div>
          <span>Últimos {movements.length}</span>
        </div>
        {movements.length === 0 ? <div className="inventory-empty">Los movimientos aparecerán aquí al registrar entradas o salidas.</div> : (
          <div className="inventory-movement-list">
            {movements.slice(0, 30).map((movement) => {
              const transfer = movement.movement_type === 'transfer'
              return (
                <article className="inventory-movement-row" key={movement.id}>
                  <span className={`inventory-movement-icon ${Number(movement.quantity_delta) > 0 ? 'is-incoming' : transfer ? 'is-transfer' : 'is-outgoing'}`}>
                    {Number(movement.quantity_delta) > 0 ? <ArrowDownLeft size={16} /> : transfer ? <ArrowLeftRight size={16} /> : <ArrowUpRight size={16} />}
                  </span>
                  <div className="inventory-movement-main">
                    <strong>{movementLabel(movement.movement_type)} · {itemNames.get(movement.item_id) ?? 'Artículo'}</strong>
                    <span>{movement.reason || (movement.asset_id ? `Activo: ${assetNames.get(movement.asset_id) ?? 'Activo'}` : 'Sin observaciones')}</span>
                  </div>
                  <span className={`inventory-movement-quantity ${Number(movement.quantity_delta) > 0 ? 'quantity-positive' : transfer ? 'quantity-neutral' : 'quantity-negative'}`}>
                    {transfer ? `${new Intl.NumberFormat('es-CO', { maximumFractionDigits: 3 }).format(Math.abs(Number(movement.quantity_delta)))} trasladadas` : `${Number(movement.quantity_delta) > 0 ? '+' : ''}${new Intl.NumberFormat('es-CO', { maximumFractionDigits: 3 }).format(Number(movement.quantity_delta))}`}
                  </span>
                  <div className="inventory-movement-meta"><span>{formatDate(movement.created_at)}</span><small>{movement.source_location_id ? locationNames.get(movement.source_location_id) : ''}{transfer ? ` → ${locationNames.get(movement.target_location_id ?? '') ?? 'Destino'}` : movement.target_location_id ? locationNames.get(movement.target_location_id) : ''}</small></div>
                </article>
              )
            })}
          </div>
        )}
      </section>

      <AnimatePresence>
        {itemModalOpen && (
          <div className="inventory-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !saving) setItemModalOpen(false) }}>
            <motion.section className="inventory-modal" role="dialog" aria-modal="true" aria-labelledby="inventory-item-title" initial={reduceMotion ? false : { opacity: 0, y: 12, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 8, scale: 0.98 }}>
              <div className="inventory-modal-header"><div><span className="eyebrow">INVENTARIO</span><h2 id="inventory-item-title">Registrar artículo</h2></div><button className="icon-button" type="button" aria-label="Cerrar" onClick={() => setItemModalOpen(false)} disabled={saving}><X size={18} /></button></div>
              <form className="inventory-form" onSubmit={createItem}>
                <div className="inventory-form-grid">
                  <label>Código interno<input required maxLength={60} value={itemDraft.internal_code} onChange={(event) => setItemDraft({ ...itemDraft, internal_code: event.target.value })} /></label>
                  <label>Nombre<input required maxLength={120} value={itemDraft.name} onChange={(event) => setItemDraft({ ...itemDraft, name: event.target.value })} /></label>
                  <label>Categoría<input required maxLength={80} placeholder="Ej. hélice, filtro, herramienta" value={itemDraft.category} onChange={(event) => setItemDraft({ ...itemDraft, category: event.target.value })} /></label>
                  <label>Unidad de medida<input required maxLength={24} placeholder="unidad, litro, kg…" value={itemDraft.unit} onChange={(event) => setItemDraft({ ...itemDraft, unit: event.target.value })} /></label>
                  <label>Marca / fabricante<input maxLength={100} value={itemDraft.manufacturer} onChange={(event) => setItemDraft({ ...itemDraft, manufacturer: event.target.value })} /></label>
                  <label>Modelo<input maxLength={100} value={itemDraft.model} onChange={(event) => setItemDraft({ ...itemDraft, model: event.target.value })} /></label>
                  <label>Referencia del fabricante<input maxLength={100} value={itemDraft.manufacturer_reference} onChange={(event) => setItemDraft({ ...itemDraft, manufacturer_reference: event.target.value })} /></label>
                  <label>Número de serie<input maxLength={120} required={itemDraft.is_serialized} value={itemDraft.serial_number} onChange={(event) => setItemDraft({ ...itemDraft, serial_number: event.target.value })} /></label>
                  <label>Fecha de compra<input type="date" value={itemDraft.acquired_on} onChange={(event) => setItemDraft({ ...itemDraft, acquired_on: event.target.value })} /></label>
                  <label>Proveedor<select value={itemDraft.supplier_id} onChange={(event) => setItemDraft({ ...itemDraft, supplier_id: event.target.value })}><option value="">Sin especificar</option>{suppliers.map((supplier) => <option key={supplier.id} value={supplier.id}>{supplier.name}</option>)}</select></label>
                  <label>Valor unitario (COP)<input type="number" min="0" step="0.01" value={itemDraft.unit_value} onChange={(event) => setItemDraft({ ...itemDraft, unit_value: event.target.value })} /></label>
                  <label>Existencia inicial<input required type="number" min="0" max={itemDraft.is_serialized ? '1' : undefined} step={itemDraft.is_serialized ? '1' : '0.001'} value={itemDraft.opening_quantity} onChange={(event) => setItemDraft({ ...itemDraft, opening_quantity: event.target.value })} /></label>
                  <label>Ubicación inicial<select required={Number(itemDraft.opening_quantity) > 0} value={itemDraft.location_id} onChange={(event) => setItemDraft({ ...itemDraft, location_id: event.target.value })}><option value="">Sin ubicación</option>{locations.map((location) => <option key={location.id} value={location.id}>{location.name}</option>)}</select></label>
                  <label className="inventory-checkbox"><input type="checkbox" checked={itemDraft.is_serialized} onChange={(event) => setItemDraft({ ...itemDraft, is_serialized: event.target.checked, opening_quantity: event.target.checked && Number(itemDraft.opening_quantity) > 1 ? '1' : itemDraft.opening_quantity })} /><span>Artículo serializado (una unidad por ficha)</span></label>
                  <label className="inventory-form-wide">Observaciones<textarea rows={3} value={itemDraft.notes} onChange={(event) => setItemDraft({ ...itemDraft, notes: event.target.value })} /></label>
                </div>
                {error && <p className="form-error" role="alert">{error}</p>}
                <div className="inventory-modal-footer"><button className="secondary-button" type="button" onClick={() => setItemModalOpen(false)} disabled={saving}>Cancelar</button><button className="primary-button" type="submit" disabled={saving}>{saving ? 'Guardando…' : 'Registrar artículo'}</button></div>
              </form>
            </motion.section>
          </div>
        )}
        {movementModalOpen && (
          <div className="inventory-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !saving) setMovementModalOpen(false) }}>
            <motion.section className="inventory-modal inventory-modal-compact" role="dialog" aria-modal="true" aria-labelledby="inventory-movement-title" initial={reduceMotion ? false : { opacity: 0, y: 12, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 8, scale: 0.98 }}>
              <div className="inventory-modal-header"><div><span className="eyebrow">TRAZABILIDAD</span><h2 id="inventory-movement-title">Registrar movimiento</h2></div><button className="icon-button" type="button" aria-label="Cerrar" onClick={() => setMovementModalOpen(false)} disabled={saving}><X size={18} /></button></div>
              <form className="inventory-form" onSubmit={recordMovement}>
                <div className="inventory-form-grid">
                  <label className="inventory-form-wide">Artículo<select required value={movementDraft.item_id} onChange={(event) => setMovementDraft({ ...emptyMovementDraft, item_id: event.target.value })}><option value="">Selecciona un artículo</option>{items.map((item) => <option key={item.id} value={item.id}>{item.internal_code} · {item.name} ({formatQuantity(Number(item.quantity_on_hand), item.unit)})</option>)}</select></label>
                  <label>Tipo de movimiento<select value={movementDraft.movement_type} onChange={(event) => setMovementDraft({ ...movementDraft, movement_type: event.target.value, source_location_id: '', target_location_id: '' })}>{movementOptions.map((option) => <option key={option.code} value={option.code}>{option.label}</option>)}</select></label>
                  <label>Cantidad ({selectedItem?.unit ?? 'unidad'})<input required type="number" min="0.001" max={selectedItem?.is_serialized ? '1' : undefined} step={selectedItem?.is_serialized ? '1' : '0.001'} value={movementDraft.quantity} onChange={(event) => setMovementDraft({ ...movementDraft, quantity: event.target.value })} /></label>
                  {selectedMovement?.direction !== 'in' && <label>Ubicación de origen<select required value={movementDraft.source_location_id} onChange={(event) => setMovementDraft({ ...movementDraft, source_location_id: event.target.value, target_location_id: movementDraft.target_location_id === event.target.value ? '' : movementDraft.target_location_id })}><option value="">Selecciona origen</option>{availableSourceLocations.map((balance) => { const location = locations.find((entry) => entry.id === balance.location_id); return <option key={`${balance.item_id}-${balance.location_id ?? 'none'}`} value={balance.location_id ?? '__unassigned__'} disabled={!balance.location_id && selectedMovement?.direction === 'transfer'}>{location ? `${location.name}${location.active ? '' : ' (inactiva)'}` : 'Sin ubicación'} · {formatQuantity(Number(balance.quantity_on_hand), selectedItem?.unit ?? '')}</option> })}</select></label>}
                  {selectedMovement?.direction !== 'out' && <label>Ubicación de destino<select required={selectedMovement?.direction === 'transfer' || Number(movementDraft.quantity) > 0} value={movementDraft.target_location_id} onChange={(event) => setMovementDraft({ ...movementDraft, target_location_id: event.target.value })}><option value="">Selecciona destino</option>{destinationLocations.map((location) => <option key={location.id} value={location.id}>{location.name}</option>)}</select></label>}
                  {(movementDraft.movement_type === 'installation' || movementDraft.movement_type === 'consumption') && <>
                    <label>Activo relacionado<select required={movementDraft.movement_type === 'installation'} value={movementDraft.asset_id} onChange={(event) => setMovementDraft({ ...movementDraft, asset_id: event.target.value, maintenance_record_id: '' })}><option value="">No especificado</option>{assets.map((asset) => <option key={asset.id} value={asset.id}>{assetNames.get(asset.id)}</option>)}</select></label>
                    <label>Mantenimiento relacionado<select value={movementDraft.maintenance_record_id} onChange={(event) => setMovementDraft({ ...movementDraft, maintenance_record_id: event.target.value })}><option value="">No especificado</option>{linkedMaintenanceRecords.map((record) => <option key={record.id} value={record.id}>{assetNames.get(record.asset_id) ?? 'Activo'} · {formatDate(record.performed_at)}</option>)}</select></label>
                  </>}
                  <label className="inventory-form-wide">Motivo / observaciones<textarea rows={3} required={['installation', 'consumption', 'repair_sent', 'write_off'].includes(movementDraft.movement_type)} value={movementDraft.reason} onChange={(event) => setMovementDraft({ ...movementDraft, reason: event.target.value })} /></label>
                </div>
                {error && <p className="form-error" role="alert">{error}</p>}
                <div className="inventory-modal-footer"><button className="secondary-button" type="button" onClick={() => setMovementModalOpen(false)} disabled={saving}>Cancelar</button><button className="primary-button" type="submit" disabled={saving || !items.length}>{saving ? 'Guardando…' : 'Confirmar movimiento'}</button></div>
              </form>
            </motion.section>
          </div>
        )}
      </AnimatePresence>
    </motion.section>
  )
}
