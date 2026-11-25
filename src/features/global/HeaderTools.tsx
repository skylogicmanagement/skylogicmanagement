import { useCallback, useEffect, useRef, useState } from 'react'
import {
  AlertTriangle,
  Bell,
  CheckCircle2,
  ClipboardList,
  LoaderCircle,
  PackageSearch,
  RefreshCw,
  Search,
  X,
} from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { supabase } from '../../lib/supabase'

type ModulePage = 'Activos' | 'Operaciones' | 'Pilotos' | 'Mantenimiento' | 'Inventario'
type Access = {
  orgId: string
  assets: boolean
  operations: boolean
  maintenance: boolean
  inventory: boolean
}
type SearchResult = {
  id: string
  title: string
  detail: string
  page: ModulePage
  kind: string
}
type Notice = {
  id: string
  title: string
  detail: string
  page: ModulePage
  severity: 'warning' | 'danger'
}

type QueryResponse = { data: unknown[]; error: string | null }

async function normalizeQuery<T>(request: PromiseLike<{ data: T[] | null; error: { message: string } | null }>): Promise<QueryResponse> {
  const { data, error } = await request
  return { data: data ?? [], error: error?.message ?? null }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function getText(row: Record<string, unknown>, key: string) {
  const value = row[key]
  return typeof value === 'string' || typeof value === 'number' ? String(value) : ''
}

function getOptionalText(row: Record<string, unknown>, key: string) {
  const value = row[key]
  return typeof value === 'string' || typeof value === 'number' ? String(value) : null
}

function getRows(response: QueryResponse) {
  return response.data.filter(isRecord)
}

async function loadAccess(userId: string): Promise<Access[]> {
  if (!supabase) throw new Error('No se pudo conectar con Supabase.')
  const client = supabase

  const { data: memberships, error: membershipError } = await client
    .from('memberships')
    .select('org_id')
    .eq('user_id', userId)
    .eq('active', true)

  if (membershipError) throw new Error(membershipError.message)
  if (!memberships?.length) return []

  const access = await Promise.all(memberships.map(async ({ org_id: orgId }) => {
    const permissions = await Promise.all([
      client.rpc('has_org_permission', { target_org: orgId, permission: 'assets.read' }),
      client.rpc('has_org_permission', { target_org: orgId, permission: 'assets.manage' }),
      client.rpc('has_org_permission', { target_org: orgId, permission: 'operations.read' }),
      client.rpc('has_org_permission', { target_org: orgId, permission: 'operations.manage' }),
      client.rpc('has_org_permission', { target_org: orgId, permission: 'maintenance.read' }),
      client.rpc('has_org_permission', { target_org: orgId, permission: 'maintenance.manage' }),
      client.rpc('has_org_permission', { target_org: orgId, permission: 'inventory.read' }),
      client.rpc('has_org_permission', { target_org: orgId, permission: 'inventory.manage' }),
    ])
    const permissionError = permissions.find((result) => result.error)?.error
    if (permissionError) throw new Error(permissionError.message)
    return {
      orgId,
      assets: Boolean(permissions[0].data || permissions[1].data),
      operations: Boolean(permissions[2].data || permissions[3].data),
      maintenance: Boolean(permissions[4].data || permissions[5].data),
      inventory: Boolean(permissions[6].data || permissions[7].data),
    }
  }))

  return access
}

function SearchDialog({ userId, onNavigate }: { userId: string; onNavigate: (page: string) => void }) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchResult[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        setOpen(true)
      } else if (event.key === 'Escape') {
        closeSearch()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  function closeSearch() {
    setOpen(false)
    setQuery('')
    setResults([])
    setError('')
    setLoading(false)
  }

  useEffect(() => {
    if (open) window.setTimeout(() => inputRef.current?.focus(), 0)
  }, [open])

  useEffect(() => {
    const term = query.trim()
    if (!open || term.length < 2) return

    let cancelled = false
    const timer = window.setTimeout(() => {
      setLoading(true)
      setError('')
      void (async () => {
        try {
          if (!supabase) throw new Error('No se pudo conectar con Supabase.')
          const client = supabase
          const access = await loadAccess(userId)
          const pattern = `%${term.replace(/[\\%_]/g, '\\$&')}%`
          const found: SearchResult[] = []
          const responseErrors: string[] = []

          for (const org of access) {
            const tasks = []
            if (org.assets) {
              tasks.push(
                  normalizeQuery(client.from('assets').select('id, name, internal_code, serial_number').eq('org_id', org.orgId).eq('active', true).ilike('name', pattern).limit(5)),
                  normalizeQuery(client.from('assets').select('id, name, internal_code, serial_number').eq('org_id', org.orgId).eq('active', true).ilike('internal_code', pattern).limit(5)),
                  normalizeQuery(client.from('assets').select('id, name, internal_code, serial_number').eq('org_id', org.orgId).eq('active', true).ilike('serial_number', pattern).limit(5)),
              )
            }
            if (org.operations) {
              tasks.push(
                normalizeQuery(client.from('operations').select('id, operation_number, status, municipality, field_location').eq('org_id', org.orgId).ilike('municipality', pattern).limit(5)),
                normalizeQuery(client.from('operations').select('id, operation_number, status, municipality, field_location').eq('org_id', org.orgId).ilike('field_location', pattern).limit(5)),
              )
              if (/^\d+$/.test(term)) {
                tasks.push(normalizeQuery(client.from('operations').select('id, operation_number, status, municipality, field_location').eq('org_id', org.orgId).eq('operation_number', Number(term)).limit(5)))
              }
              tasks.push(
                normalizeQuery(client.from('pilots').select('id, full_name, license_number').eq('org_id', org.orgId).eq('active', true).ilike('full_name', pattern).limit(5)),
                normalizeQuery(client.from('pilots').select('id, full_name, license_number').eq('org_id', org.orgId).eq('active', true).ilike('license_number', pattern).limit(5)),
              )
            }
            if (org.maintenance) {
              tasks.push(
                normalizeQuery(client.from('maintenance_records').select('id, maintenance_type, status, diagnosis, performed_at').eq('org_id', org.orgId).ilike('diagnosis', pattern).limit(5)),
                normalizeQuery(client.from('maintenance_records').select('id, maintenance_type, status, diagnosis, performed_at').eq('org_id', org.orgId).ilike('activities', pattern).limit(5)),
              )
            }
            if (org.inventory) {
              tasks.push(
                normalizeQuery(client.from('inventory_items').select('id, name, internal_code, category, serial_number').eq('org_id', org.orgId).eq('active', true).ilike('name', pattern).limit(5)),
                normalizeQuery(client.from('inventory_items').select('id, name, internal_code, category, serial_number').eq('org_id', org.orgId).eq('active', true).ilike('internal_code', pattern).limit(5)),
                normalizeQuery(client.from('inventory_items').select('id, name, internal_code, category, serial_number').eq('org_id', org.orgId).eq('active', true).ilike('serial_number', pattern).limit(5)),
              )
            }
            const responses = await Promise.all(tasks)
            responseErrors.push(...responses.flatMap((response) => response.error ? [response.error] : []))

            if (org.assets) {
              const rows = responses.slice(0, 3).flatMap(getRows)
              for (const row of rows) {
                if (row.id) {
                  found.push({ id: getText(row, 'id'), title: getText(row, 'name'), detail: [getOptionalText(row, 'internal_code'), getOptionalText(row, 'serial_number')].filter(Boolean).join(' · '), page: 'Activos', kind: 'Activo' })
                }
              }
            }
            let index = org.assets ? 3 : 0
            if (org.operations) {
              const operationRows = responses.slice(index, index + (/^\d+$/.test(term) ? 3 : 2)).flatMap(getRows)
              index += /^\d+$/.test(term) ? 3 : 2
              for (const row of operationRows) {
                if (row.id) {
                  found.push({
                    id: getText(row, 'id'),
                    title: `Operación #${getText(row, 'operation_number')}`,
                    detail: [getOptionalText(row, 'municipality'), getOptionalText(row, 'field_location'), getOptionalText(row, 'status')].filter(Boolean).join(' · '),
                    page: 'Operaciones',
                    kind: 'Operación',
                  })
                }
              }
              const pilotRows = responses.slice(index, index + 2).flatMap(getRows)
              index += 2
              for (const row of pilotRows) {
                if (row.id) {
                  found.push({ id: getText(row, 'id'), title: getText(row, 'full_name'), detail: getOptionalText(row, 'license_number') ?? 'Piloto', page: 'Pilotos', kind: 'Piloto' })
                }
              }
            }
            if (org.maintenance) {
              const rows = responses.slice(index, index + 2).flatMap(getRows)
              index += 2
              for (const row of rows) {
                if (row.id) {
                  found.push({
                    id: getText(row, 'id'),
                    title: getOptionalText(row, 'diagnosis') || getText(row, 'maintenance_type'),
                    detail: `${getText(row, 'status')} · ${new Intl.DateTimeFormat('es-CO', { dateStyle: 'medium' }).format(new Date(getText(row, 'performed_at')))}`,
                    page: 'Mantenimiento',
                    kind: 'Mantenimiento',
                  })
                }
              }
            }
            if (org.inventory) {
              const rows = responses.slice(index, index + 3).flatMap(getRows)
              for (const row of rows) {
                if (row.id) {
                  found.push({ id: getText(row, 'id'), title: getText(row, 'name'), detail: `${getText(row, 'internal_code')} · ${getText(row, 'category')}`, page: 'Inventario', kind: 'Repuesto' })
                }
              }
            }
          }

          if (cancelled) return
          if (responseErrors.length) setError(`No se pudieron consultar algunos resultados: ${[...new Set(responseErrors)].join('; ')}`)
          const unique = new Map(found.map((item) => [`${item.page}:${item.id}`, item]))
          setResults([...unique.values()].slice(0, 20))
        } catch (searchError) {
          if (!cancelled) setError(searchError instanceof Error ? searchError.message : 'No se pudo completar la búsqueda.')
        } finally {
          if (!cancelled) setLoading(false)
        }
      })()
    }, 250)

    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [open, query, userId])

  return (
    <>
      <button className="search-box" type="button" aria-label="Buscar en Sky Logic" onClick={() => setOpen(true)}>
        <Search size={16} /><span>Buscar activos, operaciones...</span><kbd>Ctrl/⌘ K</kbd>
      </button>
      <AnimatePresence>
        {open && (
          <motion.div className="global-search-backdrop" role="presentation" onMouseDown={(event) => {
            if (event.target === event.currentTarget) closeSearch()
          }} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <motion.section className="global-search-dialog" role="dialog" aria-modal="true" aria-label="Búsqueda global" initial={{ opacity: 0, y: -12, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -8, scale: 0.98 }}>
              <div className="global-search-input">
                <Search size={19} />
                <input ref={inputRef} value={query} onChange={(event) => { setResults([]); setError(''); setLoading(false); setQuery(event.target.value.slice(0, 80)) }} placeholder="Buscar activos, operaciones, pilotos..." aria-label="Texto de búsqueda" />
                {loading && <LoaderCircle className="global-search-spinner" size={18} />}
                <button type="button" className="icon-button" aria-label="Cerrar búsqueda" onClick={closeSearch}><X size={18} /></button>
              </div>
              <div className="global-search-results" aria-live="polite">
                {query.trim().length < 2 ? (
                  <p className="global-tools-hint">Escribe al menos 2 caracteres para buscar en los módulos que tienes autorizados.</p>
                ) : error ? (
                  <p className="global-tools-error" role="alert">{error}</p>
                ) : loading ? (
                  <p className="global-tools-hint">Buscando información...</p>
                ) : results.length ? results.map((result) => (
                  <button className="global-search-result" type="button" key={`${result.page}:${result.id}`} onClick={() => { onNavigate(result.page); closeSearch() }}>
                    <span className="global-result-icon"><PackageSearch size={17} /></span>
                    <span className="global-result-copy"><strong>{result.title}</strong><small>{result.detail || result.kind}</small></span>
                    <span className="global-result-kind">{result.kind}</span>
                  </button>
                )) : (
                  <p className="global-tools-hint">No se encontraron coincidencias.</p>
                )}
              </div>
              <footer className="global-search-footer"><span>Resultados protegidos por tus permisos</span><kbd>ESC</kbd></footer>
            </motion.section>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  )
}

function NotificationCenter({ userId, onNavigate }: { userId: string; onNavigate: (page: string) => void }) {
  const [open, setOpen] = useState(false)
  const [notices, setNotices] = useState<Notice[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!open) return
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [open])

  const refresh = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      if (!supabase) throw new Error('No se pudo conectar con Supabase.')
      const access = await loadAccess(userId)
      const pending: Notice[] = []
      const errors: string[] = []

      for (const org of access) {
        const tasks = []
        if (org.operations) {
          tasks.push(normalizeQuery(supabase.from('operations').select('id, operation_number, status, municipality, field_location').eq('org_id', org.orgId).in('status', ['preparing', 'in_transit', 'in_operation']).order('created_at', { ascending: false }).limit(5)))
        }
        if (org.maintenance) tasks.push(normalizeQuery(supabase.rpc('get_maintenance_alerts', { p_org_id: org.orgId })))
        if (org.inventory) {
          tasks.push(normalizeQuery(supabase.from('inventory_items').select('id, name, internal_code, quantity_on_hand, minimum_quantity').eq('org_id', org.orgId).eq('active', true).limit(1000)))
        }
        if (org.assets) {
          tasks.push(normalizeQuery(supabase.from('assets').select('id, name, internal_code, status').eq('org_id', org.orgId).eq('active', true).in('status', ['damaged', 'repair', 'out_of_service']).limit(5)))
        }

        const responses = await Promise.all(tasks)
        for (const response of responses) {
          if (response.error) errors.push(response.error)
        }

        let index = 0
        if (org.operations) {
          const response = responses[index++]
          for (const operation of getRows(response)) {
            if (operation.id) {
              pending.push({
                id: `operation:${getText(operation, 'id')}`,
                title: `Operación #${getText(operation, 'operation_number')} activa`,
                detail: [getOptionalText(operation, 'municipality'), getOptionalText(operation, 'field_location'), getOptionalText(operation, 'status')].filter(Boolean).join(' · '),
                page: 'Operaciones',
                severity: 'warning',
              })
            }
          }
        }
        if (org.maintenance) {
          const response = responses[index++]
          for (const alert of getRows(response)) {
            const alertStatus = getText(alert, 'alert_status')
            if (alertStatus === 'overdue' || alertStatus === 'due') {
              pending.push({
                id: `maintenance:${getText(alert, 'asset_id')}:${getText(alert, 'plan_id')}`,
                title: `${getText(alert, 'asset_name')}: ${alertStatus === 'overdue' ? 'mantenimiento vencido' : 'mantenimiento requerido'}`,
                detail: `${getText(alert, 'internal_code')} · ${getText(alert, 'plan_name')}`,
                page: 'Mantenimiento',
                severity: 'danger',
              })
            }
          }
        }
        if (org.inventory) {
          const response = responses[index++]
          for (const item of getRows(response)) {
            const minimumQuantity = Number(item.minimum_quantity)
            const quantity = Number(item.quantity_on_hand)
            if (minimumQuantity > 0 && quantity <= minimumQuantity) {
              pending.push({
                id: `stock:${getText(item, 'id')}`,
                title: `${getText(item, 'name')}: inventario bajo`,
                detail: `${getText(item, 'internal_code')} · ${quantity} disponibles (mínimo ${minimumQuantity})`,
                page: 'Inventario',
                severity: quantity === 0 ? 'danger' : 'warning',
              })
            }
          }
        }
        if (org.assets) {
          const response = responses[index]
          for (const asset of getRows(response)) {
            if (asset.id) {
              pending.push({
                id: `asset:${getText(asset, 'id')}`,
                title: `${getText(asset, 'name')}: requiere atención`,
                detail: `${getText(asset, 'internal_code')} · ${getText(asset, 'status')}`,
                page: 'Activos',
                severity: 'danger',
              })
            }
          }
        }
      }

      setNotices(pending.slice(0, 30))
      if (errors.length) setError(`No se pudieron cargar algunas alertas: ${[...new Set(errors)].join('; ')}`)
    } catch (refreshError) {
      setError(refreshError instanceof Error ? refreshError.message : 'No se pudieron cargar las notificaciones.')
    } finally {
      setLoading(false)
    }
  }, [userId])

  useEffect(() => {
    if (!open) return
    const timer = window.setTimeout(() => void refresh(), 0)
    return () => window.clearTimeout(timer)
  }, [open, refresh])

  return (
    <div className="notification-center">
      <button className="icon-button notification-button" aria-label={`Notificaciones${notices.length ? `, ${notices.length} alertas` : ''}`} aria-expanded={open} onClick={() => setOpen((current) => !current)}>
        <Bell size={18} />
        {notices.length > 0 && <span className="notification-count">{notices.length > 99 ? '99+' : notices.length}</span>}
      </button>
      <AnimatePresence>
        {open && (
          <motion.section className="notification-panel" aria-label="Centro de notificaciones" initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }}>
            <header className="notification-panel-heading">
              <div><h2>Notificaciones</h2><p>Alertas actuales de tus módulos</p></div>
              <button className="icon-button" type="button" aria-label="Actualizar notificaciones" onClick={() => void refresh()} disabled={loading}><RefreshCw size={16} className={loading ? 'global-search-spinner' : ''} /></button>
            </header>
            <div className="notification-list" aria-live="polite">
              {error && <p className="global-tools-error" role="alert">{error}</p>}
              {loading ? (
                <p className="global-tools-hint"><LoaderCircle size={16} className="global-search-spinner" /> Consultando alertas...</p>
              ) : notices.length ? notices.map((notice) => (
                <button type="button" className="notification-item" key={notice.id} onClick={() => { onNavigate(notice.page); setOpen(false) }}>
                  <span className={`notification-item-icon ${notice.severity}`}><AlertTriangle size={16} /></span>
                  <span><strong>{notice.title}</strong><small>{notice.detail}</small></span>
                </button>
              )) : !error ? (
                <div className="notification-empty"><CheckCircle2 size={22} /><strong>Todo al día</strong><span>No hay alertas pendientes en los módulos autorizados.</span></div>
              ) : null}
            </div>
            <footer className="notification-panel-footer"><ClipboardList size={14} /> Alertas calculadas con la información actual</footer>
          </motion.section>
        )}
      </AnimatePresence>
    </div>
  )
}

export function HeaderTools({ userId, onNavigate }: { userId: string; onNavigate: (page: string) => void }) {
  return (
    <>
      <SearchDialog userId={userId} onNavigate={onNavigate} />
      <NotificationCenter userId={userId} onNavigate={onNavigate} />
    </>
  )
}
