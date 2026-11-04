import { create } from 'zustand'
import type { PlaybackBundle } from '../api/types'
import type { DamageSignals, LiveSignals } from '../components/three/signals'
import { damageFractions, IDLE_SIGNALS } from '../components/three/signals'

export const SPEEDS = [30, 60, 120, 300, 900] as const

interface PlaybackState {
  data: PlaybackBundle | null
  t: number // flight time in seconds
  playing: boolean
  speed: number // flight seconds per wall second
  ended: boolean
  load: (d: PlaybackBundle | null) => void
  play: () => void
  pause: () => void
  toggle: () => void
  seek: (t: number) => void
  setSpeed: (s: number) => void
  restart: () => void
  tick: (dtWall: number) => void
}

export const usePlayback = create<PlaybackState>()((set, get) => ({
  data: null,
  t: 0,
  playing: false,
  speed: 120,
  ended: false,
  load: (data) => set({ data, t: 0, playing: false, ended: false }),
  play: () => {
    const { data, t } = get()
    if (!data) return
    set({ playing: true, ended: false, t: t >= data.duration_s ? 0 : t })
  },
  pause: () => set({ playing: false }),
  toggle: () => (get().playing ? get().pause() : get().play()),
  seek: (t) => {
    const d = get().data
    const tt = Math.max(0, Math.min(d?.duration_s ?? 0, t))
    set({ t: tt, ended: d ? tt >= d.duration_s : false })
  },
  setSpeed: (speed) => set({ speed }),
  restart: () => set({ t: 0, ended: false, playing: true }),
  tick: (dtWall) => {
    const { data, playing, speed, t } = get()
    if (!data || !playing) return
    const nt = t + dtWall * speed
    if (nt >= data.duration_s) set({ t: data.duration_s, playing: false, ended: true })
    else set({ t: nt })
  },
}))

/** Index of the last sample at or before flight time t. */
export function sampleIndex(d: PlaybackBundle, t: number): number {
  const ts = d.t_s
  let lo = 0
  let hi = ts.length - 1
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (ts[mid] <= t) lo = mid
    else hi = mid - 1
  }
  return lo
}

const max = (a: (number | null | undefined)[]) => a.reduce<number>((m, v) => (v != null && v > m ? v : m), 0)

export interface LiveSample {
  i: number
  phase: string
  signals: LiveSignals
  damage: DamageSignals
  predicted: Record<string, number>
  observed: Record<string, number | null>
  band: Record<string, [number, number]>
  state: Record<string, number>
  progress: number
}

/** Everything the UI needs at flight time t, derived from the bundle (pure, cheap). */
export function sampleAt(d: PlaybackBundle | null, t: number, playing: boolean): LiveSample {
  if (!d) return { i: 0, phase: 'idle', signals: IDLE_SIGNALS, damage: damageFractions({}, {}), predicted: {}, observed: {}, band: {}, state: {}, progress: 0 }
  const i = sampleIndex(d, t)
  const predicted: Record<string, number> = {}
  const observed: Record<string, number | null> = {}
  const band: Record<string, [number, number]> = {}
  for (const k of Object.keys(d.predicted)) {
    predicted[k] = d.predicted[k][i]
    if (d.band[k]) band[k] = [d.band[k].lo[i], d.band[k].hi[i]]
    const o = d.observed?.channels[k]
    observed[k] = o ? (o[Math.min(i, o.length - 1)] ?? null) : null
  }
  const src = (k: string) => (observed[k] != null ? (observed[k] as number) : predicted[k])
  const norm = (k: string) => {
    if (!(k in d.predicted)) return 0
    const m = Math.max(max(d.predicted[k]), max(d.observed?.channels[k] ?? []))
    return m > 0 ? Math.max(0, Math.min(1.2, src(k) / m)) : 0
  }
  const tempNorm = () => {
    if (!('temperature_c' in d.predicted)) return 0
    const amb = Math.min(...d.predicted.temperature_c)
    const m = Math.max(max(d.predicted.temperature_c), max(d.observed?.channels.temperature_c ?? []))
    return m > amb ? Math.max(0, Math.min(1.2, (src('temperature_c') - amb) / (m - amb))) : 0
  }
  const state: Record<string, number> = { ...d.state_before }
  for (const k of Object.keys(d.trajectory)) state[k] = d.trajectory[k][i]
  const raw: Record<string, number | null> = {}
  for (const k of Object.keys(predicted)) raw[k] = src(k)
  return {
    i,
    phase: d.phase[i],
    signals: { load: norm('load_kN') || norm('strain_microstrain'), temperature: tempNorm(), vibration: norm('vibration_g'), pressure: norm('pressure_bar'), phase: d.phase[i], playing, raw },
    damage: damageFractions(state, d.limits),
    predicted,
    observed,
    band,
    state,
    progress: d.duration_s > 0 ? t / d.duration_s : 0,
  }
}
