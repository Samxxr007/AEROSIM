import type { ModelType } from '../../api/types'

/** Normalised live signals driving the 3D twin (all 0…1 unless stated). */
export interface LiveSignals {
  load: number // 0…1 relative to the flight's maximum load
  temperature: number // 0…1 relative to the flight's maximum temperature
  vibration: number // 0…1 relative to the flight's maximum vibration
  pressure: number // 0…1 relative to the flight's maximum pressure
  phase: string
  playing: boolean
  /** raw channel values for labels */
  raw?: Record<string, number | null>
}

export interface DamageSignals {
  /** 0…1 fraction of the review limit per state variable (crack_length_m, pit_depth_m, …) */
  fractions: Record<string, number>
  state: Record<string, number>
  limits: Record<string, number | null>
}

export const IDLE_SIGNALS: LiveSignals = { load: 0.15, temperature: 0.1, vibration: 0.05, pressure: 0.3, phase: 'idle', playing: false }

export function damageFractions(state: Record<string, number> | undefined | null, limits: Record<string, number | null> | undefined | null): DamageSignals {
  const fr: Record<string, number> = {}
  const st = state ?? {}
  const lim = limits ?? {}
  for (const k of Object.keys(st)) {
    const l = lim[k]
    if (l && l > 0) fr[k] = Math.max(0, Math.min(1, st[k] / l))
  }
  return { fractions: fr, state: st, limits: lim }
}

/** Fallback limits when the playback endpoint has not supplied any (display only). */
export const FALLBACK_LIMITS: Record<ModelType, Record<string, number>> = {
  engine_mount: { miner_damage: 1, crack_length_m: 0.0185, pit_depth_m: 0.0005 },
  landing_gear: { miner_damage: 1, crack_length_m: 0.012, pit_depth_m: 0.0005 },
  turbine_blade: { miner_damage: 1, thermal_fatigue_damage: 1, creep_strain: 0.01, oxide_thickness_m: 3e-5 },
  hydraulic_actuator: { wear_indicator: 0.8 },
}

export function healthColor(f: number): string {
  if (f >= 0.75) return '#f0605d'
  if (f >= 0.45) return '#f5b041'
  return '#3ddc97'
}

/** Heat colour ramp: cold steel → dull red → orange → yellow-white. */
export function heatColor(t: number): [number, number, number] {
  const x = Math.max(0, Math.min(1, t))
  if (x < 0.35) {
    const k = x / 0.35
    return [0.25 + 0.35 * k, 0.28 + 0.05 * k, 0.33 - 0.1 * k]
  }
  if (x < 0.7) {
    const k = (x - 0.35) / 0.35
    return [0.6 + 0.4 * k, 0.33 - 0.1 * k + 0.35 * k, 0.23 - 0.15 * k]
  }
  const k = (x - 0.7) / 0.3
  return [1.0, 0.58 + 0.37 * k, 0.08 + 0.7 * k]
}
