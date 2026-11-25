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
  hour_meter_start: number
  hour_meter_end: number
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
  const [todayDate] = useState(() => dateKey(new Date()))
  const [startDate, setStartDate] = useState(() => shiftDateKey(todayDate, -29))
  const [endDate, setEndDate] = useState(todayDate)
  const [selectedDrone, setSelectedDrone] = useState('')

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
        .select('id, drone_asset_id, operation_id, farm_id, logged_at, hour_meter_start, hour_meter_end, flight_hours, recorded_by, notes')
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

    const droneIds = [...new Set(rows.map((row) => row.drone_asset_id))]
    const operationIds = [...new Set(rows.map((row) => row.operation_id))]
    const farmIds = [...new Set(rows.map((row) => row.farm_id))]
    const userIds = [...new Set(rows.map((row) => row.recorded_by))]
    const [assetsResult, operationsResult, farmsResult, profilesResult] = await Promise.all([
      droneIds.length
        ? supabase.from('assets').select('id, name, internal_code').eq('org_id', orgId).in('id', droneIds)
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
    ])
    const lookupError = assetsResult.error ?? operationsResult.error ?? farmsResult.error ?? profilesResult.error
    if (lookupError) {
      setError(lookupError.message)
      setLoading(false)
      return
    }
    const assets = new Map((assetsResult.data ?? []).map((row) => [row.id, row]))
    const operations = new Map((operationsResult.data ?? []).map((row) => [row.id, row.operation_number]))
    const farms = new Map((farmsResult.data ?? []).map((row) => [row.id, row.name]))
    const profiles = new Map((profilesResult.data ?? []).map((row) => [row.user_id, row.display_name]))
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
    setLoading(false)
  }, [canRead, endDate, orgId, startDate])

  useEffect(() => {
    const task = window.setTimeout(() => void loadReport(), 0)
    return () => window.clearTimeout(task)
  }, [loadReport])

  const filteredFlights = useMemo(() => selectedDrone
    ? flights.filter((flight) => flight.drone_asset_id === selectedDrone)
    : flights, [flights, selectedDrone])
  const totalHours = filteredFlights.reduce((sum, flight) => sum + Number(flight.flight_hours), 0)
  const dronesUsed = new Set(filteredFlights.map((flight) => flight.drone_asset_id)).size
  const farmsVisited = new Set(filteredFlights.map((flight) => flight.farm_id)).size
  const droneOptions = [...new Map(flights.map((flight) => [flight.drone_asset_id, {
    id: flight.drone_asset_id,
    name: flight.drone_name,
    code: flight.drone_code,
  }])).values()]

  function exportCsv() {
    const headers = ['Fecha y hora', 'Operación', 'Dron', 'Código', 'Finca', 'Horómetro inicial', 'Horómetro final', 'Horas de vuelo', 'Registrado por', 'Observaciones']
    const lines = filteredFlights.map((flight) => [
      formatDate(flight.logged_at),
      flight.operation_number === null ? '' : `Operación #${flight.operation_number}`,
      flight.drone_name,
      flight.drone_code,
      flight.farm_name,
      flight.hour_meter_start,
      flight.hour_meter_end,
      Number(flight.flight_hours).toFixed(2),
      flight.recorded_by_name,
      flight.notes,
    ])
    const csv = `\uFEFF${[headers, ...lines].map((line) => line.map(escapeCsv).join(',')).join('\r\n')}`
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `sky-logic-vuelos-${startDate}-${endDate}.csv`
    anchor.click()
    window.setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  if (permissionChecked && !canRead && !error) {
    return <section className="reports-page"><div className="reports-message"><AlertTriangle size={20} /><strong>Acceso restringido</strong><span>Tu rol no tiene el permiso Consultar reportes.</span></div></section>
  }

  return (
    <motion.section className="reports-page" initial={reduceMotion ? false : { opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
      <header className="reports-toolbar">
        <div><strong>Horas de vuelo</strong><span>Consulta por periodo, dron y finca; exporta el detalle para informes.</span></div>
        <div className="reports-controls">
          <label><CalendarDays size={15} /><span>Desde</span><input aria-label="Fecha inicial" type="date" value={startDate} max={endDate} onChange={(event) => setStartDate(event.target.value)} /></label>
          <label><CalendarDays size={15} /><span>Hasta</span><input aria-label="Fecha final" type="date" value={endDate} min={startDate} max={todayDate} onChange={(event) => setEndDate(event.target.value)} /></label>
          <select aria-label="Filtrar por dron" value={selectedDrone} onChange={(event) => setSelectedDrone(event.target.value)}><option value="">Todos los drones</option>{droneOptions.map((drone) => <option key={drone.id} value={drone.id}>{drone.name} · {drone.code}</option>)}</select>
          <button className="icon-button" type="button" aria-label="Actualizar reporte" onClick={() => void loadReport()} disabled={loading}><RefreshCw size={17} /></button>
          <button className="primary-button" type="button" onClick={exportCsv} disabled={loading || filteredFlights.length === 0}><Download size={15} /> Exportar CSV</button>
        </div>
      </header>
      {error && <div className="inline-error" role="alert"><AlertTriangle size={16} />{error}</div>}
      <div className="reports-stats">
        <article><span><Activity size={17} /></span><div><strong>{loading ? '…' : formatHours(totalHours)} h</strong><small>Horas de vuelo</small></div></article>
        <article><span><CalendarDays size={17} /></span><div><strong>{loading ? '…' : filteredFlights.length}</strong><small>Registros de vuelo</small></div></article>
        <article><span><Activity size={17} /></span><div><strong>{loading ? '…' : dronesUsed}</strong><small>Drones utilizados</small></div></article>
        <article><span><Activity size={17} /></span><div><strong>{loading ? '…' : farmsVisited}</strong><small>Fincas atendidas</small></div></article>
      </div>
      <section className="reports-table-section">
        <header><div><h2>Detalle de vuelos</h2><p>{startDate} — {endDate}</p></div><span>{filteredFlights.length} registros</span></header>
        {loading ? <div className="reports-message">Cargando reporte…</div> : filteredFlights.length === 0 ? (
          <div className="reports-message"><Activity size={20} /><strong>Sin vuelos en este periodo</strong><span>Prueba con otras fechas o verifica los registros de vuelos.</span></div>
        ) : (
          <div className="reports-table-wrap">
            <table className="reports-table">
              <thead><tr><th>Fecha</th><th>Operación</th><th>Dron</th><th>Finca</th><th>Horómetro</th><th>Horas</th><th>Registrado por</th></tr></thead>
              <tbody>{filteredFlights.map((flight) => (
                <tr key={flight.id}>
                  <td>{formatDate(flight.logged_at)}</td>
                  <td>{flight.operation_number === null ? '—' : `#${flight.operation_number}`}</td>
                  <td><strong>{flight.drone_name}</strong><small>{flight.drone_code}</small></td>
                  <td>{flight.farm_name}</td>
                  <td>{formatHours(Number(flight.hour_meter_start))} → {formatHours(Number(flight.hour_meter_end))}</td>
                  <td>{formatHours(Number(flight.flight_hours))} h</td>
                  <td>{flight.recorded_by_name}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
      </section>
    </motion.section>
  )
}
