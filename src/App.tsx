import { lazy, Suspense, useEffect, useMemo, useState } from 'react'
import {
  Activity,
  AlertTriangle,
  ArrowDownLeft,
  ArrowUpRight,
  BatteryCharging,
  Boxes,
  ChevronDown,
  ClipboardList,
  ChartNoAxesColumn,
  Clock3,
  Command,
  ContactRound,
  Drone,
  Gauge,
  LayoutDashboard,
  LogOut,
  Menu,
  Moon,
  PackageCheck,
  Plane,
  Settings2,
  ShieldCheck,
  Sun,
  Wrench,
  X,
} from 'lucide-react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import type { Session } from '@supabase/supabase-js'
import { AssetsPage } from './features/assets/AssetsPage'
import { OperationsPage } from './features/operations/OperationsPage'
import { MaintenancePage } from './features/maintenance/MaintenancePage'
import { InventoryPage } from './features/inventory/InventoryPage'
import { PilotsPage } from './features/pilots/PilotsPage'
import { AuditPage } from './features/audit/AuditPage'
import { ReportsPage } from './features/reports/ReportsPage'
import { HeaderTools } from './features/global/HeaderTools'
import { supabase, supabaseConfigError } from './lib/supabase'

const FlightChart = lazy(() => import('./components/FlightChart'))

type DashboardStats = {
  assets: number
  drones: number
  activeOperations: number
  maintenance: number
  batteriesAvailable: number
  auxiliaryAvailable: number
}

const navigation = [
  { label: 'Resumen', icon: LayoutDashboard, section: 'GENERAL' },
  { label: 'Activos', icon: Boxes, section: 'GESTIÓN' },
  { label: 'Operaciones', icon: Plane, section: 'GESTIÓN' },
  { label: 'Pilotos', icon: ContactRound, section: 'GESTIÓN' },
  { label: 'Mantenimiento', icon: Wrench, section: 'GESTIÓN' },
  { label: 'Inventario', icon: PackageCheck, section: 'GESTIÓN' },
  { label: 'Reportes', icon: ChartNoAxesColumn, section: 'ANÁLISIS' },
  { label: 'Auditoría', icon: ShieldCheck, section: 'CONTROL' },
]

type FlightChartPoint = { day: string; [droneName: string]: string | number }

type DroneSeries = {
  id: string
  name: string
  color: string
}

type FleetDrone = {
  id: string
  name: string
  status: string
}

type RecentOperation = {
  id: string
  operation_number: number
  status: string
  created_at: string
}

const droneColors = ['#2784f5', '#20c8bd', '#aa84ff', '#f0a54b', '#e86d98']

function getBogotaDateKey(date: Date) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Bogota',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date)
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]))
  return `${values.year}-${values.month}-${values.day}`
}

function shiftDateKey(dateKey: string, days: number) {
  const date = new Date(`${dateKey}T12:00:00Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

const initialStats: DashboardStats = {
  assets: 0,
  drones: 0,
  activeOperations: 0,
  maintenance: 0,
  batteriesAvailable: 0,
  auxiliaryAvailable: 0,
}

function App() {
  const [session, setSession] = useState<Session | null>(null)
  const [authLoading, setAuthLoading] = useState(Boolean(supabase))
  const [authError, setAuthError] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [signingIn, setSigningIn] = useState(false)

  useEffect(() => {
    if (!supabase) return

    supabase.auth.getSession().then(({ data, error }) => {
      if (error) setAuthError(error.message)
      setSession(data.session)
      setAuthLoading(false)
    })

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession)
    })
    return () => subscription.unsubscribe()
  }, [])

  async function handleSignIn(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!supabase) return
    setSigningIn(true)
    setAuthError('')
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) setAuthError(error.message)
    setSigningIn(false)
  }

  if (!supabase) return <SetupScreen error={supabaseConfigError} />
  if (authLoading) return <LoadingScreen />
  if (!session) {
    return (
      <SignInScreen
        email={email}
        password={password}
        error={authError}
        signingIn={signingIn}
        onEmailChange={setEmail}
        onPasswordChange={setPassword}
        onSubmit={handleSignIn}
      />
    )
  }

  return <Workspace session={session} />
}

function SetupScreen({ error }: { error: string }) {
  return (
    <main className="setup-shell">
      <section className="setup-card">
        <img className="setup-logo" src={`${import.meta.env.BASE_URL}brand/logo.jpg`} alt="Logo de Sky Logic" />
        <span className="eyebrow">PLATAFORMA DE GESTIÓN</span>
        <h1>Conectemos Sky Logic</h1>
        <p>{error} Configúralas en tu entorno local o en los secrets de GitHub.</p>
        <div className="setup-code">
          <code>VITE_SUPABASE_URL</code>
          <code>VITE_SUPABASE_PUBLISHABLE_KEY</code>
        </div>
        <p className="setup-note">
          No ingreses la clave <strong>service_role</strong> aquí ni la publiques
          en GitHub Pages.
        </p>
      </section>
    </main>
  )
}

function LoadingScreen() {
  return (
    <main className="loading-screen" aria-label="Cargando sesión">
      <span className="loading-mark"><Command size={22} /></span>
      <span>Preparando tu espacio de trabajo</span>
    </main>
  )
}

type SignInScreenProps = {
  email: string
  password: string
  error: string
  signingIn: boolean
  onEmailChange: (value: string) => void
  onPasswordChange: (value: string) => void
  onSubmit: (event: React.FormEvent<HTMLFormElement>) => void
}

function SignInScreen({
  email,
  password,
  error,
  signingIn,
  onEmailChange,
  onPasswordChange,
  onSubmit,
}: SignInScreenProps) {
  return (
    <main className="auth-shell">
      <div className="auth-visual">
        <img src={`${import.meta.env.BASE_URL}brand/logo.jpg`} alt="Logo de Sky Logic" />
        <div className="auth-visual-copy">
          <span className="eyebrow">CONTROL OPERATIVO EN UN SOLO LUGAR</span>
          <h1>Tu operación,<br />siempre en vuelo.</h1>
          <p>Activos, operaciones y mantenimiento con trazabilidad de principio a fin.</p>
        </div>
        <span className="auth-visual-footer">SKY LOGIC · GESTIÓN DE ACTIVOS</span>
      </div>
      <div className="auth-form-wrap">
        <div className="auth-form-box">
          <span className="eyebrow">BIENVENIDO DE NUEVO</span>
          <h2>Iniciar sesión</h2>
          <p className="muted">Ingresa con la cuenta autorizada por tu organización.</p>
          <form onSubmit={onSubmit}>
            <label htmlFor="email">Correo electrónico</label>
            <input id="email" type="email" autoComplete="username" required value={email} onChange={(event) => onEmailChange(event.target.value)} />
            <label htmlFor="password">Contraseña</label>
            <input id="password" type="password" autoComplete="current-password" required value={password} onChange={(event) => onPasswordChange(event.target.value)} />
            {error && <p className="form-error" role="alert">{error}</p>}
            <button className="primary-button full-button" type="submit" disabled={signingIn}>
              {signingIn ? 'Validando acceso…' : 'Entrar a Sky Logic'}
              <ArrowUpRight size={17} />
            </button>
          </form>
          <div className="auth-private"><ShieldCheck size={16} /> Acceso privado · Registro público deshabilitado</div>
        </div>
      </div>
    </main>
  )
}

function Workspace({ session }: { session: Session }) {
  const [page, setPage] = useState('Resumen')
  const [menuOpen, setMenuOpen] = useState(false)
  const [darkMode, setDarkMode] = useState(true)
  const [stats, setStats] = useState(initialStats)
  const [loadingStats, setLoadingStats] = useState(true)
  const [statsError, setStatsError] = useState('')
  const [flightData, setFlightData] = useState<FlightChartPoint[]>([])
  const [droneSeries, setDroneSeries] = useState<DroneSeries[]>([])
  const [flightHours, setFlightHours] = useState(0)
  const [fleet, setFleet] = useState<FleetDrone[]>([])
  const [recentOperations, setRecentOperations] = useState<RecentOperation[]>([])
  const [statusNames, setStatusNames] = useState<Record<string, string>>({})
  const [userMenuOpen, setUserMenuOpen] = useState(false)
  const [refreshToken, setRefreshToken] = useState(0)
  const reduceMotion = useReducedMotion()
  const userEmail = session.user.email ?? 'Usuario'
  const initials = useMemo(() => userEmail.slice(0, 1).toUpperCase(), [userEmail])

  useEffect(() => {
    let active = true
    async function loadStats() {
      if (!supabase) return
      setLoadingStats(true)
      setStatsError('')
      const [assets, drones, operations, maintenance, batteries, auxiliaries, fleetAssets, recent, assetStatuses, operationStatuses] = await Promise.all([
        supabase.from('assets').select('id', { count: 'exact', head: true }).eq('active', true),
        supabase.from('assets').select('id', { count: 'exact', head: true }).eq('asset_type_code', 'drone').eq('active', true),
        supabase.from('operations').select('id', { count: 'exact', head: true }).in('status', ['preparing', 'in_transit', 'in_operation']),
        supabase.from('assets').select('id', { count: 'exact', head: true }).in('status', ['maintenance', 'repair']).eq('active', true),
        supabase.from('assets').select('id', { count: 'exact', head: true }).eq('asset_type_code', 'battery').eq('status', 'available').eq('active', true),
        supabase.from('assets').select('id', { count: 'exact', head: true }).in('asset_type_code', ['tank', 'pump', 'generator', 'tool', 'accessory', 'other']).eq('status', 'available').eq('active', true),
        supabase.from('assets').select('id, name, status').eq('asset_type_code', 'drone').eq('active', true).order('internal_code'),
        supabase.from('operations').select('id, operation_number, status, created_at').order('created_at', { ascending: false }).limit(4),
        supabase.from('asset_statuses').select('code, name').eq('active', true),
        supabase.from('operation_statuses').select('code, name').eq('active', true),
      ])
      const queryError = assets.error ?? drones.error ?? operations.error ?? maintenance.error ?? batteries.error ?? auxiliaries.error ?? fleetAssets.error ?? recent.error ?? assetStatuses.error ?? operationStatuses.error
      if (!active) return
      if (queryError) {
        setStatsError(queryError.message)
      } else {
        setFleet(fleetAssets.data ?? [])
        setRecentOperations(recent.data ?? [])
        setStatusNames(Object.fromEntries([
          ...(assetStatuses.data ?? []),
          ...(operationStatuses.data ?? []),
        ].map((status) => [status.code, status.name])))
        setStats({
          assets: assets.count ?? 0,
          drones: drones.count ?? 0,
          activeOperations: operations.count ?? 0,
          maintenance: maintenance.count ?? 0,
          batteriesAvailable: batteries.count ?? 0,
          auxiliaryAvailable: auxiliaries.count ?? 0,
        })
      }

      const todayKey = getBogotaDateKey(new Date())
      const startKey = shiftDateKey(todayKey, -6)
      const endKey = shiftDateKey(todayKey, 1)
      const start = new Date(`${startKey}T05:00:00.000Z`)
      const end = new Date(`${endKey}T05:00:00.000Z`)
      const flightLogs: Array<{ logged_at: string; flight_hours: number; drone_asset_id: string }> = []
      let offset = 0
      let flightError = ''
      while (true) {
        const { data, error } = await supabase
          .from('flight_logs')
          .select('logged_at, flight_hours, drone_asset_id')
          .gte('logged_at', start.toISOString())
          .lt('logged_at', end.toISOString())
          .order('logged_at')
          .range(offset, offset + 999)
        if (error) {
          flightError = error.message
          break
        }
        flightLogs.push(...(data ?? []))
        if (!data || data.length < 1000) break
        offset += 1000
      }

      if (flightError) {
        if (active) setStatsError((current) => current ? `${current}; ${flightError}` : flightError)
      } else if (flightLogs.length) {
        const droneIds = [...new Set(flightLogs.map((log) => log.drone_asset_id))]
        const { data: dronesData, error: droneNamesError } = await supabase
          .from('assets')
          .select('id, name')
          .in('id', droneIds)
        if (droneNamesError) {
          if (active) setStatsError((current) => current ? `${current}; ${droneNamesError.message}` : droneNamesError.message)
        } else if (active) {
          const names = new Map((dronesData ?? []).map((drone) => [drone.id, drone.name]))
          const series = droneIds.map((id, index) => ({
            id,
            name: names.get(id) ?? 'Dron',
            color: droneColors[index % droneColors.length],
          }))
          const pointsByDate = new Map<string, FlightChartPoint>()
          for (let dayOffset = 0; dayOffset < 7; dayOffset += 1) {
            const key = shiftDateKey(startKey, dayOffset)
            const date = new Date(`${key}T17:00:00.000Z`)
            pointsByDate.set(key, {
              day: new Intl.DateTimeFormat('es-CO', { timeZone: 'America/Bogota', weekday: 'short' }).format(date).replace('.', ''),
            })
          }
          for (const log of flightLogs) {
            const key = getBogotaDateKey(new Date(log.logged_at))
            const point = pointsByDate.get(key)
            const name = names.get(log.drone_asset_id) ?? 'Dron'
            if (point) point[name] = Number(point[name] ?? 0) + Number(log.flight_hours)
          }
          setFlightData([...pointsByDate.values()])
          setDroneSeries(series)
          setFlightHours(flightLogs.reduce((sum, log) => sum + Number(log.flight_hours), 0))
        }
      } else if (active) {
        setFlightData([])
        setDroneSeries([])
        setFlightHours(0)
      }
      setLoadingStats(false)
    }
    void loadStats()
    return () => { active = false }
  }, [refreshToken])

  useEffect(() => {
    const client = supabase
    if (!client) return

    const channel = client
      .channel(`dashboard-updates-${session.user.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'assets' }, () => setRefreshToken((value) => value + 1))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'operations' }, () => setRefreshToken((value) => value + 1))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'operation_assets' }, () => setRefreshToken((value) => value + 1))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'flight_logs' }, () => setRefreshToken((value) => value + 1))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'maintenance_records' }, () => setRefreshToken((value) => value + 1))
      .subscribe((status, error) => {
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          setStatsError(error?.message ?? `Actualización en tiempo real no disponible (${status}).`)
        }
      })

    return () => {
      void client.removeChannel(channel)
    }
  }, [session.user.id])

  async function signOut() {
    if (!supabase) return
    const { error } = await supabase.auth.signOut()
    if (error) setStatsError(error.message)
  }

  const pageHeading = page === 'Resumen' ? 'Resumen general' : page
  const pageDescription = page === 'Resumen'
    ? 'Una vista clara de tus activos y la operación de Sky Logic.'
    : `Consulta y gestiona ${page.toLowerCase()} desde un espacio centralizado.`

  return (
    <div className={`workspace ${darkMode ? 'theme-dark' : 'theme-light'}`}>
      <AnimatePresence>
        {menuOpen && <motion.button className="mobile-backdrop" aria-label="Cerrar menú" onClick={() => setMenuOpen(false)} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} />}
      </AnimatePresence>
      <aside className={`sidebar ${menuOpen ? 'sidebar-open' : ''}`}>
        <div className="sidebar-brand">
          <img src={`${import.meta.env.BASE_URL}brand/logo.jpg`} alt="Logo de Sky Logic" />
          <button className="icon-button mobile-close" aria-label="Cerrar menú" onClick={() => setMenuOpen(false)}><X size={19} /></button>
        </div>
        <div className="workspace-switcher">
          <span className="workspace-mark">S</span>
          <span className="workspace-name"><strong>Sky Logic</strong><small>Espacio de trabajo</small></span>
          <ChevronDown size={15} />
        </div>
        <nav className="nav-groups" aria-label="Navegación principal">
          {['GENERAL', 'GESTIÓN', 'ANÁLISIS', 'CONTROL'].map((section) => (
            <div className="nav-group" key={section}>
              <span className="nav-label">{section}</span>
              {navigation.filter((item) => item.section === section).map(({ label, icon: Icon }) => (
                <button key={label} className={`nav-item ${page === label ? 'nav-item-active' : ''}`} onClick={() => { setPage(label); setMenuOpen(false) }}>
                  <Icon size={18} strokeWidth={1.8} /><span>{label}</span>
                  {label === 'Operaciones' && stats.activeOperations > 0 && <span className="nav-count">{stats.activeOperations}</span>}
                </button>
              ))}
            </div>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <button className={`nav-item ${page === 'Configuración' ? 'nav-item-active' : ''}`} onClick={() => setPage('Configuración')}><Settings2 size={18} /><span>Configuración</span></button>
          <div className="sidebar-help"><div className="help-icon"><Activity size={17} /></div><div><strong>Centro de ayuda</strong><span>Estamos para ayudarte</span></div><ArrowUpRight size={15} /></div>
          <button className="profile-button" onClick={() => setUserMenuOpen((open) => !open)}>
            <span className="avatar">{initials}</span>
            <span className="profile-info"><strong>{userEmail}</strong><small>Cuenta autorizada</small></span>
            <ChevronDown size={15} />
          </button>
          {userMenuOpen && <button className="signout-button" onClick={() => void signOut()}><LogOut size={15} /> Cerrar sesión</button>}
        </div>
      </aside>

      <div className="main-column">
        <header className="topbar">
          <button className="icon-button mobile-menu" aria-label="Abrir menú" onClick={() => setMenuOpen(true)}><Menu size={20} /></button>
          <div className="breadcrumbs"><span>Sky Logic</span><span className="crumb-slash">/</span><strong>{page}</strong></div>
          <div className="topbar-actions">
            <HeaderTools userId={session.user.id} onNavigate={setPage} />
            <button className="icon-button" title={darkMode ? 'Cambiar a tema claro' : 'Cambiar a tema oscuro'} onClick={() => setDarkMode((mode) => !mode)}>{darkMode ? <Sun size={18} /> : <Moon size={18} />}</button>
          </div>
        </header>

        <main className="page-content">
          <div className="page-heading">
            <div>
              <div className="welcome-line"><span className="status-dot" /> PANEL DE CONTROL</div>
              <h1>{pageHeading}</h1>
              <p>{pageDescription}</p>
            </div>
          </div>

          {page === 'Resumen' ? (
            <Dashboard
              stats={stats}
              loading={loadingStats}
              error={statsError}
              flightData={flightData}
              droneSeries={droneSeries}
              flightHours={flightHours}
              fleet={fleet}
              recentOperations={recentOperations}
              statusNames={statusNames}
              reducedMotion={Boolean(reduceMotion)}
              onNavigate={setPage}
            />
          ) : page === 'Activos' ? (
            <AssetsPage userId={session.user.id} />
          ) : page === 'Operaciones' ? (
            <OperationsPage userId={session.user.id} />
          ) : page === 'Pilotos' ? (
            <PilotsPage userId={session.user.id} />
          ) : page === 'Mantenimiento' ? (
            <MaintenancePage />
          ) : page === 'Inventario' ? (
            <InventoryPage />
          ) : page === 'Reportes' ? (
            <ReportsPage />
          ) : page === 'Auditoría' ? (
            <AuditPage userId={session.user.id} />
          ) : (
            <ModulePlaceholder page={page} onBack={() => setPage('Resumen')} />
          )}
          <footer className="page-footer"><span>© 2026 Sky Logic</span><span>Sistema de gestión de activos <i /> Información centralizada</span></footer>
        </main>
      </div>
    </div>
  )
}

function Dashboard({
  stats,
  loading,
  error,
  flightData,
  droneSeries,
  flightHours,
  fleet,
  recentOperations,
  statusNames,
  reducedMotion,
  onNavigate,
}: {
  stats: DashboardStats
  loading: boolean
  error: string
  flightData: FlightChartPoint[]
  droneSeries: DroneSeries[]
  flightHours: number
  fleet: FleetDrone[]
  recentOperations: RecentOperation[]
  statusNames: Record<string, string>
  reducedMotion: boolean
  onNavigate: (page: string) => void
}) {
  const cards = [
    { title: 'Activos registrados', value: stats.assets, label: 'En el inventario central', icon: Boxes, color: 'blue', target: 'Activos' },
    { title: 'Drones', value: stats.drones, label: 'Registrados en la flota', icon: Drone, color: 'cyan', target: 'Activos' },
    { title: 'Operaciones activas', value: stats.activeOperations, label: 'En curso actualmente', icon: Plane, color: 'violet', target: 'Operaciones' },
    { title: 'En mantenimiento', value: stats.maintenance, label: 'Activos no disponibles', icon: Wrench, color: 'amber', target: 'Mantenimiento' },
    { title: 'Baterías disponibles', value: stats.batteriesAvailable, label: 'Listas para asignación', icon: BatteryCharging, color: 'cyan', target: 'Activos' },
    { title: 'Auxiliares disponibles', value: stats.auxiliaryAvailable, label: 'Equipos disponibles en base', icon: PackageCheck, color: 'blue', target: 'Activos' },
  ]

  return (
    <>
      {error && <div className="inline-error" role="alert"><AlertTriangle size={17} /><span>No fue posible cargar el resumen: {error}</span></div>}
      <section className="stats-grid" aria-label="Indicadores">
        {cards.map(({ title, value, label, icon: Icon, color, target }, index) => (
          <motion.button
            key={title}
            className="stat-card"
            onClick={() => onNavigate(target)}
            initial={reducedMotion ? false : { opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: reducedMotion ? 0 : index * 0.06, duration: 0.32 }}
            whileHover={reducedMotion ? undefined : { y: -3 }}
          >
            <div className="stat-top"><span className={`stat-icon icon-${color}`}><Icon size={18} /></span><span className="stat-trend"><ArrowUpRight size={14} /></span></div>
            <div className="stat-value">{loading ? <span className="skeleton skeleton-number" /> : value}</div>
            <div className="stat-title">{title}</div>
            <div className="stat-label">{label}</div>
          </motion.button>
        ))}
      </section>

      <section className="dashboard-grid">
        <article className="panel flight-panel">
          <div className="panel-heading">
            <div><h2>Actividad de vuelo</h2><p>Horas registradas por dron · últimos 7 días</p></div>
            <button className="panel-menu" aria-label="Más opciones">···</button>
          </div>
          <div className="chart-summary"><strong>{flightData.length ? `${flightHours.toFixed(1)} h` : '—'}</strong><span className="chart-period"><Clock3 size={14} /> {loading ? 'Cargando datos…' : flightData.length ? 'Horas registradas · últimos 7 días' : 'Sin registros de vuelo en el período'}</span></div>
          <div className="chart-wrap">
            <Suspense fallback={<div className="chart-loading">Cargando gráfica…</div>}>
              <FlightChart data={flightData} series={droneSeries} loading={loading} />
            </Suspense>
          </div>
          <div className="chart-legend">{droneSeries.map((drone) => <span key={drone.id}><i style={{ backgroundColor: drone.color }} /> {drone.name}</span>)}<button onClick={() => onNavigate('Operaciones')}>Ver operaciones <ArrowUpRight size={14} /></button></div>
        </article>

        <article className="panel fleet-panel">
          <div className="panel-heading">
            <div><h2>Estado de la flota</h2><p>Disponibilidad de drones</p></div>
            <button className="panel-menu" aria-label="Más opciones">···</button>
          </div>
          <div className="fleet-cards">
            {fleet.map((drone, index) => (
              <div className="fleet-card" key={drone.id}>
                <span className={`fleet-drone-icon fleet-${index}`}><Plane size={19} /></span>
                <div className="fleet-info"><strong>{drone.name}</strong><span>Estado actual</span></div>
                <span className={`fleet-status ${drone.status === 'available' ? 'status-available' : 'status-unknown'}`}><i /> {statusNames[drone.status] ?? drone.status}</span>
              </div>
            ))}
            {fleet.length === 0 && <div className="fleet-empty">No hay drones activos registrados.</div>}
          </div>
          <div className="fleet-note"><span className="note-icon"><Gauge size={16} /></span><span>Registra los activos en la base de datos para ver su disponibilidad y horas acumuladas.</span></div>
          <button className="text-link" onClick={() => onNavigate('Activos')}>Ir a activos <ArrowUpRight size={15} /></button>
        </article>
      </section>

      <section className="lower-grid">
        <article className="panel activity-panel">
          <div className="panel-heading">
            <div><h2>Operaciones recientes</h2><p>Últimas operaciones creadas</p></div>
            <button className="text-link" onClick={() => onNavigate('Auditoría')}>Ver historial <ArrowUpRight size={14} /></button>
          </div>
          {recentOperations.length ? (
            <div className="recent-operations">
              {recentOperations.map((operation) => (
                <div className="recent-operation" key={operation.id}>
                  <span className="recent-operation-icon"><Plane size={16} /></span>
                  <span className="recent-operation-copy"><strong>Operación #{operation.operation_number}</strong><small>{statusNames[operation.status] ?? operation.status}</small></span>
                  <time dateTime={operation.created_at}>{new Intl.DateTimeFormat('es-CO', { timeZone: 'America/Bogota', day: '2-digit', month: 'short' }).format(new Date(operation.created_at))}</time>
                </div>
              ))}
            </div>
          ) : (
            <div className="empty-activity">
              <span className="empty-activity-icon"><ClipboardList size={20} /></span>
              <strong>Sin operaciones recientes</strong>
              <span>Cuando se registren operaciones, aparecerán aquí.</span>
            </div>
          )}
        </article>
        <article className="panel quick-panel">
          <div className="panel-heading"><div><h2>Acceso rápido</h2><p>Acciones frecuentes</p></div></div>
          <div className="quick-actions">
            <button onClick={() => onNavigate('Operaciones')}><span className="quick-icon quick-blue"><ArrowUpRight size={17} /></span><span><strong>Nueva salida</strong><small>Registrar operación</small></span><ChevronDown className="quick-chevron" size={15} /></button>
            <button onClick={() => onNavigate('Activos')}><span className="quick-icon quick-teal"><BatteryCharging size={17} /></span><span><strong>Registrar activo</strong><small>Agregar al inventario</small></span><ChevronDown className="quick-chevron" size={15} /></button>
            <button onClick={() => onNavigate('Mantenimiento')}><span className="quick-icon quick-orange"><Wrench size={17} /></span><span><strong>Nuevo mantenimiento</strong><small>Crear intervención</small></span><ChevronDown className="quick-chevron" size={15} /></button>
          </div>
        </article>
      </section>
    </>
  )
}

function ModulePlaceholder({ page, onBack }: { page: string; onBack: () => void }) {
  const Icon = page === 'Operaciones' ? Plane : page === 'Mantenimiento' ? Wrench : page === 'Inventario' ? PackageCheck : page === 'Auditoría' ? ShieldCheck : page === 'Configuración' ? Settings2 : Boxes
  return (
    <motion.section className="module-placeholder" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
      <div className="placeholder-icon"><Icon size={23} /></div>
      <span className="eyebrow">MÓDULO SKY LOGIC</span>
      <h2>{page}</h2>
      <p>Esta sección se conectará con los datos centralizados de Sky Logic en la siguiente entrega.</p>
      <button className="primary-button" onClick={onBack}>Volver al resumen <ArrowDownLeft size={16} /></button>
    </motion.section>
  )
}

export default App
