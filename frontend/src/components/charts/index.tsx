import { Area, Bar, BarChart, CartesianGrid, ComposedChart, Legend, Line, LineChart, ReferenceLine, ResponsiveContainer, Scatter, Tooltip, XAxis, YAxis } from 'recharts'
import type { FlightRecordSim, Reconciliation, Uncertainty } from '../../api/types'
import { CHANNEL_LABELS, fmt, stateLabel } from '../../utils/format'

export const C = {
  predicted: '#38bdf8',
  actual: '#f5b041',
  residual: '#a78bfa',
  band: '#38bdf8',
  static: '#6f8196',
  updated: '#38bdf8',
  truth: '#3ddc97',
  series: ['#38bdf8', '#f5b041', '#a78bfa', '#3ddc97', '#f0605d'],
}

const grid = <CartesianGrid stroke="rgba(255,255,255,0.06)" strokeDasharray="2 3" />
const axisStyle = { fontSize: 11, fill: '#8798ab' }
const tooltipStyle = { fontSize: 12, fontFamily: 'IBM Plex Mono, monospace' }
const tf5 = (v: unknown, n: unknown): [string, string] => [fmt.num(Number(v), 5), String(n)]

export function ChartFrame({ title, unitNote, height = 260, children }: { title?: string; unitNote?: string; height?: number; children: React.ReactElement }) {
  return (
    <div>
      {(title || unitNote) && (
        <div className="flex items-baseline justify-between mb-1">
          {title && <div className="text-[12.5px] font-medium text-ink">{title}</div>}
          {unitNote && <div className="text-[11px] text-ink-3">{unitNote}</div>}
        </div>
      )}
      <div style={{ width: '100%', height }}>
        <ResponsiveContainer>{children}</ResponsiveContainer>
      </div>
    </div>
  )
}

/** Cumulative state variable per flight with optional Monte-Carlo P5–P95 band. */
export function DamageProgressionChart({ flights, stateKey, uncertainty, initial, height = 260, title }: { flights: FlightRecordSim[]; stateKey: string; uncertainty?: Uncertainty | null; initial?: number; height?: number; title?: string }) {
  const s = stateLabel(stateKey)
  const useBand = uncertainty && uncertainty.key_metric === stateKey ? uncertainty.key_percentiles : uncertainty && uncertainty.secondary_metric === stateKey ? uncertainty.secondary_percentiles : null
  const data = [
    ...(initial !== undefined ? [{ flight: 0, value: initial * s.scale, p5: initial * s.scale, p95: initial * s.scale, p50: initial * s.scale, profile: 'initial' }] : []),
    ...flights.map((f, i) => ({
      flight: f.flight_index,
      value: (f.state_after[stateKey] ?? 0) * s.scale,
      p5: useBand ? useBand.p5[i] * s.scale : undefined,
      p95: useBand ? useBand.p95[i] * s.scale : undefined,
      p50: useBand ? useBand.p50[i] * s.scale : undefined,
      profile: f.profile,
      status: f.threshold_status,
    })),
  ]
  return (
    <ChartFrame title={title ?? s.label} unitNote={`${s.unit === '-' ? 'dimensionless' : s.unit} vs flight`} height={height}>
      <ComposedChart data={data} margin={{ top: 8, right: 16, left: 4, bottom: 4 }}>
        {grid}
        <XAxis dataKey="flight" tick={axisStyle} label={{ value: 'Flight', position: 'insideBottomRight', offset: -2, fontSize: 11, fill: '#7b8794' }} />
        <YAxis tick={axisStyle} domain={['auto', 'auto']} tickFormatter={(v) => fmt.num(v, 4)} width={70} />
        <Tooltip contentStyle={tooltipStyle} formatter={tf5} labelFormatter={(l) => `Flight ${l}`} />
        {useBand && <Area type="monotone" dataKey="p95" stroke="none" fill={C.band} fillOpacity={0.13} name="P95 (sample)" isAnimationActive={false} />}
        {useBand && <Area type="monotone" dataKey="p5" stroke="none" fill="#ffffff" fillOpacity={1} name="P5 (sample)" isAnimationActive={false} />}
        {useBand && <Line type="monotone" dataKey="p50" stroke={C.band} strokeDasharray="3 3" strokeWidth={1} dot={false} name="P50 (sample)" isAnimationActive={false} />}
        <Line type="monotone" dataKey="value" stroke={C.predicted} strokeWidth={2} dot={{ r: 3 }} name={`${s.label} (nominal)`} isAnimationActive={false} />
        <Legend wrapperStyle={{ fontSize: 11 }} />
      </ComposedChart>
    </ChartFrame>
  )
}

/** Damage increment per flight (bars) coloured by status. */
export function IncrementChart({ flights, incKey, height = 220 }: { flights: FlightRecordSim[]; incKey: string; height?: number }) {
  const s = stateLabel(incKey)
  const data = flights.map((f) => ({ flight: f.flight_index, inc: (f.increments[incKey] ?? 0) * s.scale, profile: f.profile }))
  return (
    <ChartFrame title={`Δ ${s.label} per flight`} unitNote={s.unit === '-' ? 'dimensionless' : s.unit} height={height}>
      <BarChart data={data} margin={{ top: 8, right: 16, left: 4, bottom: 4 }}>
        {grid}
        <XAxis dataKey="flight" tick={axisStyle} />
        <YAxis tick={axisStyle} tickFormatter={(v) => fmt.num(v, 3)} width={70} />
        <Tooltip contentStyle={tooltipStyle} formatter={(v) => [fmt.num(Number(v), 5), `Δ ${s.label}`]} labelFormatter={(l, p) => `Flight ${l} · ${p?.[0]?.payload?.profile ?? ''}`} />
        <Bar dataKey="inc" fill={C.predicted} isAnimationActive={false} />
      </BarChart>
    </ChartFrame>
  )
}

/** Predicted vs actual channel overlay. */
export function OverlayChart({ rec, channel, height = 240 }: { rec: Reconciliation; channel: string; height?: number }) {
  const ch = rec.channels[channel]
  if (!ch?.predicted) return null
  const t = rec.t_s ?? ch.predicted.map((_, i) => i)
  const data = ch.predicted.map((p, i) => ({ t: t[i] / 60, predicted: p, actual: ch.actual?.[i] ?? null, phase: rec.phase?.[i] }))
  return (
    <ChartFrame title={`${CHANNEL_LABELS[channel] ?? channel} — predicted vs actual`} unitNote={`${ch.unit} vs minutes`} height={height}>
      <LineChart data={data} margin={{ top: 8, right: 16, left: 4, bottom: 4 }}>
        {grid}
        <XAxis dataKey="t" tick={axisStyle} tickFormatter={(v) => v.toFixed(0)} minTickGap={28} label={{ value: 'min', position: 'insideBottomRight', offset: -2, fontSize: 11, fill: '#7b8794' }} />
        <YAxis tick={axisStyle} domain={['auto', 'auto']} tickFormatter={(v) => fmt.num(v, 3)} width={60} />
        <Tooltip contentStyle={tooltipStyle} formatter={(v, n) => [v === null || v === undefined ? '—' : fmt.num(Number(v), 4), String(n)]} labelFormatter={(l, p) => `t = ${Number(l).toFixed(1)} min · ${p?.[0]?.payload?.phase ?? ''}`} />
        <Line type="monotone" dataKey="predicted" stroke={C.predicted} strokeWidth={2} dot={false} name="Predicted (twin)" isAnimationActive={false} />
        <Line type="monotone" dataKey="actual" stroke={C.actual} strokeWidth={1.2} dot={false} name="Actual (observed)" isAnimationActive={false} connectNulls={false} />
        <Legend wrapperStyle={{ fontSize: 11 }} />
      </LineChart>
    </ChartFrame>
  )
}

export function ResidualChart({ rec, channel, height = 200 }: { rec: Reconciliation; channel: string; height?: number }) {
  const ch = rec.channels[channel]
  if (!ch?.residual) return null
  const t = rec.t_s ?? ch.residual.map((_, i) => i)
  const data = ch.residual.map((r, i) => ({ t: t[i] / 60, residual: r }))
  return (
    <ChartFrame title={`${CHANNEL_LABELS[channel] ?? channel} — residual (actual − predicted)`} unitNote={`${ch.unit} · bias ${fmt.num(ch.mean_bias, 3)} · RMSE ${fmt.num(ch.rmse, 3)}`} height={height}>
      <ComposedChart data={data} margin={{ top: 8, right: 16, left: 4, bottom: 4 }}>
        {grid}
        <XAxis dataKey="t" tick={axisStyle} tickFormatter={(v) => v.toFixed(0)} minTickGap={28} />
        <YAxis tick={axisStyle} domain={['auto', 'auto']} tickFormatter={(v) => fmt.num(v, 3)} width={60} />
        <Tooltip contentStyle={tooltipStyle} formatter={(v) => [v === null || v === undefined ? '—' : fmt.num(Number(v), 4), 'residual']} labelFormatter={(l) => `t = ${Number(l).toFixed(1)} min`} />
        <ReferenceLine y={0} stroke="#52606d" />
        {ch.mean_bias !== undefined && <ReferenceLine y={ch.mean_bias} stroke={C.residual} strokeDasharray="4 3" label={{ value: 'mean bias', fontSize: 10, fill: C.residual, position: 'insideTopRight' }} />}
        <Scatter dataKey="residual" fill={C.residual} isAnimationActive={false} shape={(props: { cx?: number; cy?: number }) => <circle cx={props.cx} cy={props.cy} r={1.6} fill={C.residual} />} />
      </ComposedChart>
    </ChartFrame>
  )
}

/** Schedules compared on a cumulative state variable. */
export function ScheduleComparisonChart({ schedules, stateKey, initial, height = 260 }: { schedules: { name: string; flights: FlightRecordSim[] }[]; stateKey: string; initial?: number; height?: number }) {
  const s = stateLabel(stateKey)
  const maxLen = Math.max(...schedules.map((x) => x.flights.length))
  const data = Array.from({ length: maxLen + 1 }, (_, i) => {
    const row: Record<string, number | null> = { flight: i }
    schedules.forEach((sc) => {
      row[sc.name] = i === 0 ? (initial ?? sc.flights[0]?.state_after[stateKey] ?? null) * s.scale : sc.flights[i - 1] ? (sc.flights[i - 1].state_after[stateKey] ?? 0) * s.scale : null
    })
    return row
  })
  return (
    <ChartFrame title={`${s.label} — schedule comparison`} unitNote={s.unit === '-' ? 'dimensionless' : s.unit} height={height}>
      <LineChart data={data} margin={{ top: 8, right: 16, left: 4, bottom: 4 }}>
        {grid}
        <XAxis dataKey="flight" tick={axisStyle} />
        <YAxis tick={axisStyle} domain={['auto', 'auto']} tickFormatter={(v) => fmt.num(v, 4)} width={70} />
        <Tooltip contentStyle={tooltipStyle} formatter={tf5} labelFormatter={(l) => `Flight ${l}`} />
        {schedules.map((sc, i) => (
          <Line key={sc.name} type="monotone" dataKey={sc.name} stroke={C.series[i % C.series.length]} strokeWidth={2} dot={{ r: 2.5 }} isAnimationActive={false} connectNulls />
        ))}
        <Legend wrapperStyle={{ fontSize: 11 }} />
      </LineChart>
    </ChartFrame>
  )
}

export function DamageAddedByMissionChart({ schedules, incKey, height = 220 }: { schedules: { name: string; missions: { mission: { name: string }; damage_added: Record<string, number> }[] }[]; incKey: string; height?: number }) {
  const s = stateLabel(incKey)
  const maxM = Math.max(...schedules.map((x) => x.missions.length))
  const data = Array.from({ length: maxM }, (_, i) => {
    const row: Record<string, number | string | null> = { mission: `M${i + 1}` }
    schedules.forEach((sc) => {
      row[sc.name] = sc.missions[i] ? (sc.missions[i].damage_added[incKey] ?? 0) * s.scale : null
    })
    return row
  })
  return (
    <ChartFrame title={`Δ ${s.label} added per mission`} unitNote={s.unit === '-' ? 'dimensionless' : s.unit} height={height}>
      <BarChart data={data} margin={{ top: 8, right: 16, left: 4, bottom: 4 }}>
        {grid}
        <XAxis dataKey="mission" tick={axisStyle} />
        <YAxis tick={axisStyle} tickFormatter={(v) => fmt.num(v, 3)} width={70} />
        <Tooltip contentStyle={tooltipStyle} formatter={tf5} />
        {schedules.map((sc, i) => (
          <Bar key={sc.name} dataKey={sc.name} fill={C.series[i % C.series.length]} isAnimationActive={false} />
        ))}
        <Legend wrapperStyle={{ fontSize: 11 }} />
      </BarChart>
    </ChartFrame>
  )
}

export function SensitivityChart({ sens, height = 180 }: { sens: Record<string, number>; height?: number }) {
  const data = Object.entries(sens)
    .map(([k, v]) => ({ name: k, rho: v }))
    .sort((a, b) => Math.abs(b.rho) - Math.abs(a.rho))
  return (
    <ChartFrame title="Sensitivity of final key metric (Spearman ρ)" unitNote="rank correlation, −1…1" height={height}>
      <BarChart data={data} layout="vertical" margin={{ top: 4, right: 16, left: 8, bottom: 4 }}>
        {grid}
        <XAxis type="number" domain={[-1, 1]} tick={axisStyle} />
        <YAxis type="category" dataKey="name" tick={{ fontSize: 10.5, fill: '#52606d' }} width={150} />
        <Tooltip contentStyle={tooltipStyle} formatter={(v) => [Number(v).toFixed(3), 'ρ']} />
        <ReferenceLine x={0} stroke="#52606d" />
        <Bar dataKey="rho" fill={C.predicted} isAnimationActive={false} />
      </BarChart>
    </ChartFrame>
  )
}

/** Generic multi-series line chart over an x key. */
export function SeriesChart({ data, xKey, series, title, unitNote, height = 220, yFormatter, xLabel, curve = 'linear' }: { data: Record<string, unknown>[]; xKey: string; series: { key: string; name: string; color?: string; dashed?: boolean }[]; title?: string; unitNote?: string; height?: number; yFormatter?: (v: number) => string; xLabel?: string; curve?: 'linear' | 'monotone' }) {
  return (
    <ChartFrame title={title} unitNote={unitNote} height={height}>
      <LineChart data={data} margin={{ top: 8, right: 16, left: 4, bottom: 4 }}>
        {grid}
        <XAxis dataKey={xKey} tick={axisStyle} label={xLabel ? { value: xLabel, position: 'insideBottomRight', offset: -2, fontSize: 11, fill: '#7b8794' } : undefined} />
        <YAxis tick={axisStyle} domain={['auto', 'auto']} tickFormatter={yFormatter ?? ((v) => fmt.num(v, 4))} width={70} />
        <Tooltip contentStyle={tooltipStyle} formatter={(v, n) => [yFormatter ? yFormatter(Number(v)) : fmt.num(Number(v), 5), String(n)]} />
        {series.map((s, i) => (
          <Line key={s.key} type={curve} dataKey={s.key} name={s.name} stroke={s.color ?? C.series[i % C.series.length]} strokeWidth={2} strokeDasharray={s.dashed ? '4 3' : undefined} dot={{ r: 3 }} isAnimationActive={false} connectNulls />
        ))}
        <Legend wrapperStyle={{ fontSize: 11 }} />
      </LineChart>
    </ChartFrame>
  )
}

/** Stress-range spectrum bars for one mission. */
export function StressSpectrumChart({ bins, height = 280 }: { bins: { label: string; stress_range_mpa: number; cycles: number }[]; height?: number }) {
  const data = bins.map((b) => ({ label: b.label, range: b.stress_range_mpa, cycles: b.cycles }))
  return (
    <ChartFrame title="Applied stress-range spectrum (one flight)" unitNote="Δσ in MPa (bars, bottom axis) · cycles per flight (markers, top axis, log)" height={height}>
      <ComposedChart data={data} layout="vertical" margin={{ top: 8, right: 24, left: 8, bottom: 4 }}>
        {grid}
        <XAxis type="number" xAxisId="l" tick={axisStyle} />
        <XAxis type="number" xAxisId="r" orientation="top" scale="log" domain={[0.5, 'auto']} tick={axisStyle} tickFormatter={(v) => fmt.num(v, 2)} />
        <YAxis type="category" dataKey="label" tick={{ fontSize: 10, fill: '#52606d' }} width={150} interval={0} />
        <Tooltip contentStyle={tooltipStyle} formatter={(v, n) => [fmt.num(Number(v), 4), String(n)]} />
        <Bar xAxisId="l" dataKey="range" fill={C.predicted} name="Δσ (MPa)" isAnimationActive={false} barSize={8} />
        <Scatter xAxisId="r" dataKey="cycles" fill={C.actual} name="cycles" isAnimationActive={false} />
        <Legend wrapperStyle={{ fontSize: 11 }} />
      </ComposedChart>
    </ChartFrame>
  )
}
