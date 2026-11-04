export const fmt = {
  num(v: number | null | undefined, digits = 3): string {
    if (v === null || v === undefined || Number.isNaN(v)) return '—'
    if (v === 0) return '0'
    const a = Math.abs(v)
    if (a >= 1e5 || a < 1e-3) return v.toExponential(digits - 1)
    return v.toLocaleString('en-GB', { maximumSignificantDigits: Math.max(digits, 3), minimumSignificantDigits: 1 })
  },
  fixed(v: number | null | undefined, d = 2): string {
    if (v === null || v === undefined || Number.isNaN(v)) return '—'
    return v.toFixed(d)
  },
  pct(v: number | null | undefined, d = 1): string {
    if (v === null || v === undefined || Number.isNaN(v)) return '—'
    return `${(v * 100).toFixed(d)} %`
  },
  int(v: number | null | undefined): string {
    if (v === null || v === undefined || Number.isNaN(v)) return '—'
    return Math.round(v).toLocaleString('en-GB')
  },
  mm(m: number | null | undefined, d = 3): string {
    return m === null || m === undefined ? '—' : `${(m * 1e3).toFixed(d)} mm`
  },
  um(m: number | null | undefined, d = 1): string {
    return m === null || m === undefined ? '—' : `${(m * 1e6).toFixed(d)} µm`
  },
  date(iso: string | null | undefined): string {
    if (!iso) return '—'
    const d = new Date(iso)
    return Number.isNaN(d.getTime()) ? iso : d.toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })
  },
  k2c(k: number | null | undefined, d = 0): string {
    return k === null || k === undefined ? '—' : `${(k - 273.15).toFixed(d)} °C`
  },
}

/** Human-readable state variable labels and units. */
export const STATE_LABELS: Record<string, { label: string; unit: string; scale: number; digits: number }> = {
  miner_damage: { label: 'Miner damage D', unit: '-', scale: 1, digits: 5 },
  crack_length_m: { label: 'Crack length a', unit: 'mm', scale: 1e3, digits: 3 },
  cumulative_cycles: { label: 'Cumulative cycles', unit: 'cycles', scale: 1, digits: 0 },
  flights: { label: 'Flights', unit: '-', scale: 1, digits: 0 },
  landings: { label: 'Landings', unit: '-', scale: 1, digits: 0 },
  pit_depth_m: { label: 'Corrosion pit depth', unit: 'µm', scale: 1e6, digits: 1 },
  creep_strain: { label: 'Creep strain', unit: '%', scale: 100, digits: 4 },
  thermal_fatigue_damage: { label: 'Thermal-fatigue damage', unit: '-', scale: 1, digits: 4 },
  oxide_thickness_m: { label: 'Oxide thickness', unit: 'µm', scale: 1e6, digits: 2 },
  hot_hours: { label: 'Hot hours', unit: 'h', scale: 1, digits: 1 },
  wear_indicator: { label: 'Seal wear indicator W', unit: '-', scale: 1, digits: 4 },
  operating_hours: { label: 'Operating hours', unit: 'h', scale: 1, digits: 1 },
  leakage_lpm: { label: 'Internal leakage', unit: 'L/min', scale: 1, digits: 3 },
}

export function stateLabel(key: string) {
  return STATE_LABELS[key] ?? { label: key, unit: '', scale: 1, digits: 4 }
}

export function fmtState(key: string, v: number | null | undefined): string {
  if (v === null || v === undefined) return '—'
  const s = stateLabel(key)
  const scaled = v * s.scale
  const txt = s.digits === 0 ? Math.round(scaled).toLocaleString('en-GB') : Math.abs(scaled) < 1e-3 && scaled !== 0 ? scaled.toExponential(2) : scaled.toFixed(s.digits)
  return s.unit && s.unit !== '-' ? `${txt} ${s.unit}` : txt
}

export const KEY_METRIC: Record<string, string> = {
  engine_mount: 'crack_length_m',
  landing_gear: 'miner_damage',
  turbine_blade: 'creep_strain',
  hydraulic_actuator: 'wear_indicator',
}

export const RESPONSE_LABELS: Record<string, string> = {
  load_transfer_factor: 'Load transfer factor k_L',
  thermal_response_factor: 'Thermal response factor k_T',
  vibration_response_factor: 'Vibration response factor k_V',
  pressure_response_factor: 'Pressure response factor k_P',
}

export const CHANNEL_LABELS: Record<string, string> = {
  load_kN: 'Load',
  strain_microstrain: 'Strain',
  temperature_c: 'Temperature',
  pressure_bar: 'Pressure',
  vibration_g: 'Vibration',
}

export const DECISION_LABELS: Record<string, string> = {
  accept: 'Accept update',
  accept_reduced_confidence: 'Accept with reduced confidence',
  request_more_evidence: 'Request more evidence',
  reject: 'Reject unreliable observation',
}

export const CONDITION_LABELS: Record<string, string> = {
  duration_min: 'Duration (min)',
  landing_cycles: 'Landing cycles',
  load_factor: 'Load factor (× ref)',
  load_variation: 'Load variation (±)',
  manoeuvre_intensity: 'Manoeuvre intensity',
  temperature_c: 'Temperature (°C)',
  pressure_factor: 'System pressure (× nom)',
  vibration_level: 'Vibration level',
  environment: 'Environment',
  operating_intensity: 'Operating intensity',
}

export const WHAT_IF_LABEL = 'ENGINEERING WHAT-IF SCENARIO — NOT AN ACTUAL SCHEDULED FLIGHT'

export const PROFILE_LABELS: Record<string, string> = {
  normal: 'Normal operation',
  increased_load: 'Increased-load operation',
  high_temperature: 'High-temperature operation',
  high_manoeuvre: 'High-manoeuvre-load operation',
  adverse_environment: 'Adverse-environment scenario',
  custom: 'Custom mission',
}
