import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'

type FlightChartPoint = { day: string; [droneName: string]: string | number }
type DroneSeries = { id: string; name: string; color: string }

function FlightChart({
  data,
  series,
  loading,
}: {
  data: FlightChartPoint[]
  series: DroneSeries[]
  loading: boolean
}) {
  if (data.length === 0) {
    return <div className="chart-empty">{loading ? 'Cargando registros de vuelo…' : 'Las horas registradas aparecerán aquí.'}</div>
  }

  return (
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart data={data} margin={{ top: 10, right: 4, left: -22, bottom: 0 }}>
        <defs>
          {series.map((drone) => (
            <linearGradient key={drone.id} id={`flight-${drone.id}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={drone.color} stopOpacity={0.28} />
              <stop offset="92%" stopColor={drone.color} stopOpacity={0} />
            </linearGradient>
          ))}
        </defs>
        <CartesianGrid vertical={false} stroke="var(--chart-grid)" strokeDasharray="4 5" />
        <XAxis dataKey="day" axisLine={false} tickLine={false} tick={{ fill: 'var(--muted-2)', fontSize: 11 }} dy={10} />
        <YAxis axisLine={false} tickLine={false} tick={{ fill: 'var(--muted-2)', fontSize: 11 }} />
        <Tooltip contentStyle={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, color: 'var(--text)' }} />
        {series.map((drone) => (
          <Area
            key={drone.id}
            type="monotone"
            dataKey={drone.name}
            name={drone.name}
            stroke={drone.color}
            strokeWidth={2}
            fill={`url(#flight-${drone.id})`}
          />
        ))}
      </AreaChart>
    </ResponsiveContainer>
  )
}

export default FlightChart
