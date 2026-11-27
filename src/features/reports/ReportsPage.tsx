import { useCallback, useEffect, useMemo, useState } from 'react'
import { Activity, AlertTriangle, CalendarDays, Download, RefreshCw } from 'lucide-react'
import { motion, useReducedMotion } from 'motion/react'
import { supabase } from '../../lib/supabase'
import './reports.css'

type FlightReportRow = {
  id: string
  drone_asset_id: string
  operation_id: string
  farm_id: string
  logged_at: string
  flight_hours: number
  recorded_by: string
  notes: string | null
}

type ReportFlight = FlightReportRow & {
  drone_name: string
  drone_code: string
  operation_number: number | null
  farm_name: string
  recorded_by_name: string
}

type MaintenanceReportRow = {
  id: string
  asset_id: string
  maintenance_type: string
  status: 'open' | 'in_progress' | 'completed' | 'cancelled'
  performed_at: string
  completed_at: string | null
  technician_user_id: string | null
  external_company: string | null
  external_technician: string | null
  diagnosis: string | null
  outcome: string | null
  cost: number | null
}

type ReportMaintenance = MaintenanceReportRow & {
  asset_name: string
  asset_code: string
  maintenance_type_name: string
  technician_name: string
}

type ReportType = 'flights' | 'maintenance'

function dateKey(date: Date) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Bogota',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date)
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]))
  return `${values.year}-${values.month}-${values.day}`
}

function shiftDateKey(value: string, days: number) {
  const date = new Date(`${value}T12:00:00.000Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

function formatHours(value: number) {
  return new Intl.NumberFormat('es-CO', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value)
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat('es-CO', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value))
}

function formatCurrency(value: number) {
  return new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(value)
}

function maintenanceStatusLabel(status: MaintenanceReportRow['status']) {
  if (status === 'completed') return 'Finalizado'
  if (status === 'cancelled') return 'Cancelado'
  if (status === 'in_progress') return 'En progreso'
  return 'Abierto'
}

function escapeCsv(value: string | number | null) {
  let text = String(value ?? '')
  if (/^[\t\r\n ]*[=+\-@]/.test(text)) text = `'${text}`
  return `"${text.replaceAll('"', '""')}"`
}

export function ReportsPage() {
  const reduceMotion = useReducedMotion()
  const [orgId, setOrgId] = useState('')
  const [canRead, setCanRead] = useState(false)
  const [permissionChecked, setPermissionChecked] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [flights, setFlights] = useState<ReportFlight[]>([])
  const [maintenanceRecords, setMaintenanceRecords] = useState<ReportMaintenance[]>([])
  const [todayDate] = useState(() => dateKey(new Date()))
  const [startDate, setStartDate] = useState(() => shiftDateKey(todayDate, -29))
  const [endDate, setEndDate] = useState(todayDate)
  const [selectedDrone, setSelectedDrone] = useState('')
  const [reportType, setReportType] = useState<ReportType>('flights')
  const [maintenanceStatus, setMaintenanceStatus] = useState('')

  const loadReport = useCallback(async () => {
    if (!supabase) return
    setError('')
    setLoading(true)
    if (!orgId) {
      const { data: authData, error: authError } = await supabase.auth.getUser()
      if (authError || !authData.user) {
        setError(authError?.message ?? 'No se encontró la sesión activa.')
        setLoading(false)
        return
      }
      const { data: membership, error: membershipError } = await supabase.from('memberships')
        .select('org_id')
        .eq('user_id', authData.user.id)
        .eq('active', true)
        .limit(1)
        .maybeSingle()
      if (membershipError || !membership) {
        setError(membershipError?.message ?? 'Tu cuenta no tiene una membresía activa.')
        setLoading(false)
        return
      }
      setOrgId(membership.org_id)
      const { data: permission, error: permissionError } = await supabase.rpc('has_org_permission', {
        target_org: membership.org_id,
        permission: 'reports.read',
      })
      if (permissionError) {
        setError(permissionError.message)
      } else {
        setCanRead(permission === true)
      }
      setPermissionChecked(true)
      setLoading(false)
      return
    }

    if (!canRead) {
      setLoading(false)
      return
    }
    if (!startDate || !endDate || startDate > endDate) {
      setError('Selecciona un rango de fechas válido.')
      setLoading(false)
      return
    }

    const start = new Date(`${startDate}T05:00:00.000Z`)
    const end = new Date(`${shiftDateKey(endDate, 1)}T05:00:00.000Z`)
    const rows: FlightReportRow[] = []
    let offset = 0
    while (true) {
      const { data, error: flightError } = await supabase.from('flight_logs')
        .select('id, drone_asset_id, operation_id, farm_id, logged_at, flight_hours, recorded_by, notes')
        .eq('org_id', orgId)
        .gte('logged_at', start.toISOString())
        .lt('logged_at', end.toISOString())
        .order('logged_at', { ascending: false })
        .range(offset, offset + 999)
      if (flightError) {
        setError(flightError.message)
        setLoading(false)
        return
      }
      rows.push(...(data ?? []))
      if (!data || data.length < 1000) break
      offset += 1000
    }

    const maintenanceRows: MaintenanceReportRow[] = []
    offset = 0
    while (true) {
      const { data, error: maintenanceError } = await supabase.from('maintenance_records')
        .select('id, asset_id, maintenance_type, status, performed_at, completed_at, technician_user_id, external_company, external_technician, diagnosis, outcome, cost')
        .eq('org_id', orgId)
        .gte('performed_at', start.toISOString())
        .lt('performed_at', end.toISOString())
        .order('performed_at', { ascending: false })
        .range(offset, offset + 999)
      if (maintenanceError) {
        setError(maintenanceError.message)
        setLoading(false)
        return
      }
      maintenanceRows.push(...(data ?? []))
      if (!data || data.length < 1000) break
      offset += 1000
    }

    const droneIds = [...new Set(rows.map((row) => row.drone_asset_id))]
    const assetIds = [...new Set([...droneIds, ...maintenanceRows.map((row) => row.asset_id)])]
    const operationIds = [...new Set(rows.map((row) => row.operation_id))]
    const farmIds = [...new Set(rows.map((row) => row.farm_id))]
    const userIds = [...new Set([
      ...rows.map((row) => row.recorded_by),
      ...maintenanceRows.flatMap((row) => row.technician_user_id ? [row.technician_user_id] : []),
    ])]
    const [assetsResult, operationsResult, farmsResult, profilesResult, typesResult] = await Promise.all([
      assetIds.length
        ? supabase.from('assets').select('id, name, internal_code').eq('org_id', orgId).in('id', assetIds)
        : Promise.resolve({ data: [], error: null }),
      operationIds.length
        ? supabase.from('operations').select('id, operation_number').eq('org_id', orgId).in('id', operationIds)
        : Promise.resolve({ data: [], error: null }),
      farmIds.length
        ? supabase.from('farms').select('id, name').eq('org_id', orgId).in('id', farmIds)
        : Promise.resolve({ data: [], error: null }),
      userIds.length
        ? supabase.from('user_profiles').select('user_id, display_name').eq('org_id', orgId).in('user_id', userIds)
        : Promise.resolve({ data: [], error: null }),
      supabase.from('maintenance_types').select('code, name').eq('org_id', orgId),
    ])
    const lookupError = assetsResult.error ?? operationsResult.error ?? farmsResult.error ?? profilesResult.error ?? typesResult.error
    if (lookupError) {
      setError(lookupError.message)
      setLoading(false)
      return
    }
    const assets = new Map((assetsResult.data ?? []).map((row) => [row.id, row]))
    const operations = new Map((operationsResult.data ?? []).map((row) => [row.id, row.operation_number]))
    const farms = new Map((farmsResult.data ?? []).map((row) => [row.id, row.name]))
    const profiles = new Map((profilesResult.data ?? []).map((row) => [row.user_id, row.display_name]))
    const maintenanceTypes = new Map((typesResult.data ?? []).map((row) => [row.code, row.name]))
    setFlights(rows.map((row) => {
      const drone = assets.get(row.drone_asset_id)
      return {
        ...row,
        drone_name: drone?.name ?? 'Dron',
        drone_code: drone?.internal_code ?? '',
        operation_number: operations.get(row.operation_id) ?? null,
        farm_name: farms.get(row.farm_id) ?? 'Finca',
        recorded_by_name: profiles.get(row.recorded_by) ?? 'Usuario',
      }
    }))
    setMaintenanceRecords(maintenanceRows.map((row) => {
      const asset = assets.get(row.asset_id)
      return {
        ...row,
        asset_name: asset?.name ?? 'Activo',
        asset_code: asset?.internal_code ?? '',
        maintenance_type_name: maintenanceTypes.get(row.maintenance_type) ?? row.maintenance_type,
        technician_name: row.technician_user_id
          ? profiles.get(row.technician_user_id) ?? 'Usuario'
          : row.external_technician ?? row.external_company ?? 'Sin asignar',
      }
    }))
    setLoading(false)
  }, [canRead, endDate, orgId, startDate])

  useEffect(() => {
    const task = window.setTimeout(() => void loadReport(), 0)
    return () => window.clearTimeout(task)
  }, [loadReport])

  const filteredFlights = useMemo(() => selectedDrone
    ? flights.filter((flight) => flight.drone_asset_id === selectedDrone)
    : flights, [flights, selectedDrone])
  const filteredMaintenance = useMemo(() => maintenanceRecords.filter((record) =>
    !maintenanceStatus || record.status === maintenanceStatus,
  ), [maintenanceRecords, maintenanceStatus])
  const totalHours = filteredFlights.reduce((sum, flight) => sum + Number(flight.flight_hours), 0)
  const maintenanceCost = filteredMaintenance.reduce((sum, record) => sum + Number(record.cost ?? 0), 0)
  const openMaintenanceCount = filteredMaintenance.filter((record) => record.status === 'open' || record.status === 'in_progress').length
  const completedMaintenanceCount = filteredMaintenance.filter((record) => record.status === 'completed').length
  const dronesUsed = new Set(filteredFlights.map((flight) => flight.drone_asset_id)).size
  const farmsVisited = new Set(filteredFlights.map((flight) => flight.farm_id)).size
  const droneOptions = [...new Map(flights.map((flight) => [flight.drone_asset_id, {
    id: flight.drone_asset_id,
    name: flight.drone_name,
    code: flight.drone_code,
  }])).values()]

  function exportCsv() {
    if (reportType === 'maintenance') {
      const headers = ['Fecha', 'Activo', 'Código', 'Tipo', 'Estado', 'Técnico', 'Empresa', 'Costo COP', 'Diagnóstico', 'Resultado']
      const lines = filteredMaintenance.map((record) => [
        formatDate(record.performed_at),
        record.asset_name,
        record.asset_code,
        record.maintenance_type_name,
        record.status,
        record.technician_name,
        record.external_company,
        record.cost,
        record.diagnosis,
        record.outcome,
      ])
      downloadCsv(headers, lines, `sky-logic-mantenimientos-${startDate}-${endDate}.csv`)
      return
    }
    const headers = ['Fecha y hora', 'Operación', 'Dron', 'Código', 'Finca', 'Horas de vuelo', 'Registrado por', 'Observaciones']
    const lines = filteredFlights.map((flight) => [
      formatDate(flight.logged_at),
      flight.operation_number === null ? '' : `Operación #${flight.operation_number}`,
      flight.drone_name,
      flight.drone_code,
      flight.farm_name,
      Number(flight.flight_hours).toFixed(2),
      flight.recorded_by_name,
      flight.notes,
    ])
    downloadCsv(headers, lines, `sky-logic-vuelos-${startDate}-${endDate}.csv`)
  }

  function downloadCsv(headers: Array<string | number | null>, lines: Array<Array<string | number | null>>, fileName: string) {
    const csv = `\uFEFF${[headers, ...lines].map((line) => line.map(escapeCsv).join(',')).join('\r\n')}`
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = fileName
    anchor.click()
    window.setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  if (permissionChecked && !canRead && !error) {
    return <section className="reports-page"><div className="reports-message"><AlertTriangle size={20} /><strong>Acceso restringido</strong><span>Tu rol no tiene el permiso Consultar reportes.</span></div></section>
  }

  return (
    <motion.section className="reports-page" initial={reduceMotion ? false : { opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
      <div className="reports-tabs" role="tablist" aria-label="Tipo de reporte">
        <button type="button" role="tab" aria-selected={reportType === 'flights'} className={reportType === 'flights' ? 'is-selected' : ''} onClick={() => setReportType('flights')}>Horas de vuelo</button>
        <button type="button" role="tab" aria-selected={reportType === 'maintenance'} className={reportType === 'maintenance' ? 'is-selected' : ''} onClick={() => setReportType('maintenance')}>Mantenimientos</button>
      </div>
      <header className="reports-toolbar">
        <div><strong>{reportType === 'flights' ? 'Horas de vuelo' : 'Mantenimientos'}</strong><span>{reportType === 'flights' ? 'Consulta por periodo, dron y finca; exporta el detalle para informes.' : 'Consulta intervenciones, estado, costo y técnico responsable por periodo.'}</span></div>
        <div className="reports-controls">
          <label><CalendarDays size={15} /><span>Desde</span><input aria-label="Fecha inicial" type="date" value={startDate} max={endDate} onChange={(event) => setStartDate(event.target.value)} /></label>
          <label><CalendarDays size={15} /><span>Hasta</span><input aria-label="Fecha final" type="date" value={endDate} min={startDate} max={todayDate} onChange={(event) => setEndDate(event.target.value)} /></label>
          {reportType === 'flights' ? (
            <select aria-label="Filtrar por dron" value={selectedDrone} onChange={(event) => setSelectedDrone(event.target.value)}><option value="">Todos los drones</option>{droneOptions.map((drone) => <option key={drone.id} value={drone.id}>{drone.name} · {drone.code}</option>)}</select>
          ) : (
            <select aria-label="Filtrar por estado de mantenimiento" value={maintenanceStatus} onChange={(event) => setMaintenanceStatus(event.target.value)}>
              <option value="">Todos los estados</option><option value="open">Abierto</option><option value="in_progress">En progreso</option><option value="completed">Finalizado</option><option value="cancelled">Cancelado</option>
            </select>
          )}
          <button className="icon-button" type="button" aria-label="Actualizar reporte" onClick={() => void loadReport()} disabled={loading}><RefreshCw size={17} /></button>
          <button className="primary-button" type="button" onClick={exportCsv} disabled={loading || (reportType === 'flights' ? filteredFlights.length === 0 : filteredMaintenance.length === 0)}><Download size={15} /> Exportar CSV</button>
        </div>
      </header>
      {error && <div className="inline-error" role="alert"><AlertTriangle size={16} />{error}</div>}
      <div className="reports-stats">
        {reportType === 'flights' ? <>
          <article><span><Activity size={17} /></span><div><strong>{loading ? '…' : formatHours(totalHours)} h</strong><small>Horas de vuelo</small></div></article>
          <article><span><CalendarDays size={17} /></span><div><strong>{loading ? '…' : filteredFlights.length}</strong><small>Registros de vuelo</small></div></article>
          <article><span><Activity size={17} /></span><div><strong>{loading ? '…' : dronesUsed}</strong><small>Drones utilizados</small></div></article>
          <article><span><Activity size={17} /></span><div><strong>{loading ? '…' : farmsVisited}</strong><small>Fincas atendidas</small></div></article>
        </> : <>
          <article><span><Activity size={17} /></span><div><strong>{loading ? '…' : filteredMaintenance.length}</strong><small>Intervenciones</small></div></article>
          <article><span><CalendarDays size={17} /></span><div><strong>{loading ? '…' : openMaintenanceCount}</strong><small>Abiertas o en progreso</small></div></article>
          <article><span><Activity size={17} /></span><div><strong>{loading ? '…' : completedMaintenanceCount}</strong><small>Finalizadas</small></div></article>
          <article><span><Activity size={17} /></span><div><strong>{loading ? '…' : formatCurrency(maintenanceCost)}</strong><small>Costo registrado</small></div></article>
        </>}
      </div>
      <section className="reports-table-section">
        <header><div><h2>{reportType === 'flights' ? 'Detalle de vuelos' : 'Detalle de mantenimientos'}</h2><p>{startDate} — {endDate}</p></div><span>{reportType === 'flights' ? filteredFlights.length : filteredMaintenance.length} registros</span></header>
        {loading ? <div className="reports-message">Cargando reporte…</div> : reportType === 'flights' ? filteredFlights.length === 0 ? (
          <div className="reports-message"><Activity size={20} /><strong>Sin vuelos en este periodo</strong><span>Prueba con otras fechas o verifica los registros de vuelos.</span></div>
        ) : (
          <div className="reports-table-wrap">
            <table className="reports-table">
              <thead><tr><th>Fecha</th><th>Operación</th><th>Dron</th><th>Finca</th><th>Horas</th><th>Registrado por</th></tr></thead>
              <tbody>{filteredFlights.map((flight) => (
                <tr key={flight.id}>
                  <td>{formatDate(flight.logged_at)}</td>
                  <td>{flight.operation_number === null ? '—' : `#${flight.operation_number}`}</td>
                  <td><strong>{flight.drone_name}</strong><small>{flight.drone_code}</small></td>
                  <td>{flight.farm_name}</td>
                  <td>{formatHours(Number(flight.flight_hours))} h</td>
                  <td>{flight.recorded_by_name}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        ) : filteredMaintenance.length === 0 ? (
          <div className="reports-message"><Activity size={20} /><strong>Sin mantenimientos en este periodo</strong><span>Prueba con otras fechas o estados para encontrar intervenciones.</span></div>
        ) : <div className="reports-table-wrap">
          <table className="reports-table">
            <thead><tr><th>Fecha</th><th>Activo</th><th>Intervención</th><th>Estado</th><th>Técnico</th><th>Costo</th><th>Diagnóstico / resultado</th></tr></thead>
            <tbody>{filteredMaintenance.map((record) => (
              <tr key={record.id}>
                <td>{formatDate(record.performed_at)}</td>
                <td><strong>{record.asset_name}</strong><small>{record.asset_code}</small></td>
                <td>{record.maintenance_type_name}</td>
                <td>{maintenanceStatusLabel(record.status)}</td>
                <td>{record.technician_name}</td>
                <td>{record.cost === null ? 'Sin registrar' : formatCurrency(Number(record.cost))}</td>
                <td>{[record.diagnosis, record.outcome].filter(Boolean).join(' · ') || '—'}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>}
      </section>
    </motion.section>
  )
}
