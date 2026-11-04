import { Pause, Play, RotateCcw, SkipForward } from 'lucide-react'
import { useEffect, useMemo } from 'react'
import { Area, ComposedChart, Line, ReferenceArea, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import type { PlaybackBundle } from '../../api/types'
import { sampleAt, SPEEDS, usePlayback, type LiveSample } from '../../store/usePlayback'
import { CHANNEL_LABELS, fmt } from '../../utils/format'
import { healthColor } from '../three/signals'

export const PHASE_COLORS: Record<string, string> = {
  taxi: '#6f8196', takeoff: '#f0605d', climb: '#f5b041', cruise: '#38bdf8', manoeuvring: '#a78bfa', descent: '#7dd3fc', landing: '#f472b6', idle: '#3a4656',
}
export const PHASE_LABEL: Record<string, string> = { taxi: 'Taxi', takeoff: 'Take-off', climb: 'Climb', cruise: 'Cruise', manoeuvring: 'Manoeuvring', descent: 'Descent', landing: 'Landing', idle: 'Idle' }

export function mmss(s: number) {
  const m = Math.floor(s / 60)
  const ss = Math.floor(s % 60)
  return `${String(m).padStart(2, '0')}:${String(ss).padStart(2, '0')}`
}

/** Drives the playback clock with requestAnimationFrame while mounted. */
export function usePlaybackClock() {
  const tick = usePlayback((s) => s.tick)
  useEffect(() => {
    let raf = 0
    let last = performance.now()
    const loop = (now: number) => {
      tick(Math.min(0.1, (now - last) / 1000))
      last = now
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [tick])
}

/** Current sample (re-computed when t changes). */
export function useLiveSample(): LiveSample {
  const data = usePlayback((s) => s.data)
  const t = usePlayback((s) => s.t)
  const playing = usePlayback((s) => s.playing)
  return useMemo(() => sampleAt(data, t, playing), [data, t, playing])
}

export function Transport({ compact = false }: { compact?: boolean }) {
  const { data, t, playing, speed, ended, toggle, seek, setSpeed, restart } = usePlayback()
  if (!data) return null
  return (
    <div className={`flex items-center gap-3 ${compact ? '' : 'px-3 py-2'}`}>
      <button onClick={toggle} className="btn-primary !px-2.5 !py-1.5" aria-label={playing ? 'Pause' : 'Play'} title={playing ? 'Pause (space)' : 'Play (space)'}>
        {playing ? <Pause size={15} /> : <Play size={15} />}
        {!compact && <span>{playing ? 'Pause' : ended ? 'Replay' : 'Fly'}</span>}
      </button>
      <button onClick={restart} className="btn-secondary !px-2" title="Restart"><RotateCcw size={14} /></button>
      <button onClick={() => seek(data.duration_s)} className="btn-secondary !px-2" title="Jump to end of flight"><SkipForward size={14} /></button>
      <div className="num text-[12.5px] text-ink-2 w-[108px]">{mmss(t)} / {mmss(data.duration_s)}</div>
      <input type="range" min={0} max={data.duration_s} step={1} value={t} onChange={(e) => seek(Number(e.target.value))} className="flex-1 accent-[#38bdf8]" aria-label="Flight time" />
      <select value={speed} onChange={(e) => setSpeed(Number(e.target.value))} className="input !w-auto !py-1 !text-[12px]" aria-label="Playback speed">
        {SPEEDS.map((s) => <option key={s} value={s}>×{s}</option>)}
      </select>
    </div>
  )
}

export function PhaseStrip({ d, t, onSeek }: { d: PlaybackBundle; t: number; onSeek?: (t: number) => void }) {
  return (
    <div className="relative">
      <div className="flex h-7 rounded-md overflow-hidden border border-line">
        {d.phases.map((p) => {
          const w = ((p.end_s - p.start_s) / d.duration_s) * 100
          const active = t >= p.start_s && t < p.end_s
          return (
            <button key={p.phase} style={{ width: `${w}%`, background: `${PHASE_COLORS[p.phase]}${active ? '55' : '22'}`, borderRight: '1px solid rgba(255,255,255,0.06)' }} className={`relative text-[10px] uppercase tracking-wider overflow-hidden whitespace-nowrap ${active ? 'text-white' : 'text-ink-2'}`} onClick={() => onSeek?.(p.start_s)} title={`${PHASE_LABEL[p.phase]} ${mmss(p.start_s)}–${mmss(p.end_s)}`}>
              {w > 7 ? PHASE_LABEL[p.phase] : ''}
            </button>
          )
        })}
      </div>
      <div className="absolute top-0 bottom-0 w-[2px] bg-white shadow-[0_0_8px_#38bdf8]" style={{ left: `calc(${(t / d.duration_s) * 100}% - 1px)` }} />
    </div>
  )
}

export function GaugeTile({ k, sample, d }: { k: string; sample: LiveSample; d: PlaybackBundle }) {
  const pred = sample.predicted[k]
  const obs = sample.observed[k]
  const unit = d.units[k]
  const band = sample.band[k]
  const resid = obs != null && pred ? (obs - pred) / Math.max(Math.abs(pred), 1e-9) : null
  const maxV = Math.max(...d.predicted[k], ...((d.observed?.channels[k] ?? []).filter((v): v is number => v != null)))
  const minV = k === 'temperature_c' ? Math.min(...d.predicted[k]) : 0
  const pos = (v: number) => `${Math.max(0, Math.min(100, ((v - minV) / Math.max(maxV - minV, 1e-9)) * 100))}%`
  const live = obs != null
  return (
    <div className="card px-3 py-2.5 relative overflow-hidden">
      <div className="flex items-baseline justify-between">
        <div className="label">{CHANNEL_LABELS[k] ?? k}</div>
        <div className={`text-[10px] uppercase tracking-wider ${live ? 'text-amber' : 'text-accent'}`}>{live ? 'sensor' : 'forecast'}</div>
      </div>
      <div className={`num text-[22px] leading-tight mt-0.5 ${live ? 'text-amber' : 'text-accent-2'}`}>
        {fmt.fixed(live ? (obs as number) : pred, k === 'strain_microstrain' ? 0 : k === 'vibration_g' ? 2 : 1)}<span className="text-[11px] text-ink-3 font-sans ml-1">{unit}</span>
      </div>
      <div className="relative h-2 mt-2 rounded bg-graphite border border-line">
        {band && <div className="absolute top-0 bottom-0 bg-accent/25" style={{ left: pos(band[0]), width: `calc(${pos(band[1])} - ${pos(band[0])})` }} />}
        <div className="absolute -top-[3px] w-[2px] h-[12px] bg-accent-2" style={{ left: pos(pred) }} />
        {obs != null && <div className="absolute -top-[3px] w-[2px] h-[12px] bg-amber" style={{ left: pos(obs) }} />}
      </div>
      <div className="flex justify-between mt-1 text-[10.5px] text-ink-3 num">
        <span>forecast {fmt.fixed(pred, 1)}</span>
        {resid != null ? <span className={Math.abs(resid) > 0.1 ? 'text-amber' : 'text-ink-2'}>residual {resid >= 0 ? '+' : ''}{(resid * 100).toFixed(1)} %</span> : <span>±1σ band</span>}
      </div>
    </div>
  )
}

export function DamageTile({ k, sample, d }: { k: string; sample: LiveSample; d: PlaybackBundle }) {
  const meta = d.state_labels[k]
  if (!meta) return null
  const v = sample.state[k] ?? d.state_before[k]
  const before = d.state_before[k]
  const after = d.state_after[k]
  const lim = d.limits[k]
  const frac = lim ? Math.min(1, v / lim) : null
  const color = frac != null ? healthColor(frac) : '#38bdf8'
  const digits = k === 'crack_length_m' ? 3 : k === 'creep_strain' ? 4 : 3
  return (
    <div className="card px-3 py-2.5">
      <div className="flex items-baseline justify-between">
        <div className="label">{meta.label}</div>
        {frac != null && <div className="num text-[10.5px]" style={{ color }}>{(frac * 100).toFixed(1)} % of limit</div>}
      </div>
      <div className="num text-[20px] leading-tight mt-0.5 text-ink">
        {(v * meta.scale).toFixed(digits)}<span className="text-[11px] text-ink-3 font-sans ml-1">{meta.unit}</span>
      </div>
      <div className="relative h-2 mt-2 rounded bg-graphite border border-line overflow-hidden">
        {frac != null && <div className="absolute top-0 bottom-0 left-0 transition-[width] duration-200" style={{ width: `${frac * 100}%`, background: `linear-gradient(90deg, ${color}66, ${color})` }} />}
      </div>
      <div className="flex justify-between mt-1 text-[10.5px] text-ink-3 num">
        <span>before {(before * meta.scale).toFixed(digits)}</span>
        <span>Δ flight {((after - before) * meta.scale).toExponential(2)}</span>
      </div>
    </div>
  )
}

/** Forecast band + forecast line, with the sensor trace revealed only up to the current flight time. */
export function LiveChart({ d, k, t, height = 220 }: { d: PlaybackBundle; k: string; t: number; height?: number }) {
  const rows = useMemo(() => {
    const obs = d.observed?.channels[k]
    return d.t_s.map((ts, i) => ({
      t: ts / 60,
      pred: d.predicted[k][i],
      lo: d.band[k]?.lo[i],
      hi: d.band[k]?.hi[i],
      obs: obs && ts <= t ? (obs[i] ?? null) : null,
      phase: d.phase[i],
    }))
  }, [d, k, t])
  const unit = d.units[k]
  return (
    <div style={{ width: '100%', height }}>
      <ResponsiveContainer>
        <ComposedChart data={rows} margin={{ top: 8, right: 12, bottom: 4, left: 0 }}>
          {d.phases.map((p) => <ReferenceArea key={p.phase} x1={p.start_s / 60} x2={p.end_s / 60} fill={PHASE_COLORS[p.phase]} fillOpacity={0.05} strokeOpacity={0} />)}
          <XAxis dataKey="t" type="number" domain={[0, d.duration_s / 60]} tickFormatter={(v) => `${v.toFixed(0)}′`} tick={{ fontSize: 10.5, fill: '#8798ab' }} />
          <YAxis tick={{ fontSize: 10.5, fill: '#8798ab' }} width={46} domain={['auto', 'auto']} />
          <Tooltip labelFormatter={(v) => `t = ${Number(v).toFixed(1)} min`} formatter={(v, n) => [`${fmt.fixed(Number(v), 2)} ${unit}`, String(n)]} />
          <Area dataKey="hi" stroke="none" fill="#38bdf8" fillOpacity={0.12} isAnimationActive={false} name="forecast +1σ" />
          <Area dataKey="lo" stroke="none" fill="#0a0f16" fillOpacity={1} isAnimationActive={false} name="forecast −1σ" />
          <Line dataKey="pred" stroke="#38bdf8" dot={false} strokeWidth={1.6} isAnimationActive={false} name="pre-flight forecast" />
          <Line dataKey="obs" stroke="#f5b041" dot={false} strokeWidth={1.8} isAnimationActive={false} connectNulls={false} name="sensor (as flown)" />
          <ReferenceLine x={t / 60} stroke="#ffffff" strokeOpacity={0.7} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  )
}
