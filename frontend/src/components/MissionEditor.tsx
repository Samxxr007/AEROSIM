import { ArrowDown, ArrowUp, Copy, Plus, Trash2 } from 'lucide-react'
import type { Mission, MissionPresets, ModelType } from '../api/types'
import { PROFILE_LABELS } from '../utils/format'
import { Field } from './ui'

const INPUTS: { key: keyof Mission; label: string; unit: string; min: number; max: number; step: number; hint: string }[] = [
  { key: 'duration_min', label: 'Flight duration', unit: 'min', min: 5, max: 1200, step: 5, hint: 'Total block time; phases scale proportionally.' },
  { key: 'landing_cycles', label: 'Landing cycles', unit: '-', min: 0, max: 20, step: 1, hint: 'Touchdown events in this flight (touch-and-go training = several).' },
  { key: 'load_factor', label: 'Representative load', unit: '× ref', min: 0.2, max: 3, step: 0.05, hint: 'Multiplier on the reference structural load.' },
  { key: 'load_variation', label: 'Load variation', unit: '± fraction', min: 0, max: 0.6, step: 0.05, hint: 'Spread of loads around nominal (3-point distribution).' },
  { key: 'manoeuvre_intensity', label: 'Manoeuvre intensity', unit: '× ref', min: 0, max: 5, step: 0.1, hint: 'Scales manoeuvre cycle count and amplitude.' },
  { key: 'temperature_c', label: 'Ambient / inlet temperature', unit: '°C', min: -60, max: 300, step: 1, hint: 'Ambient for structures; hot-day offset for the turbine.' },
  { key: 'pressure_factor', label: 'System pressure', unit: '× nominal', min: 0.3, max: 2, step: 0.05, hint: 'Hydraulic system pressure relative to nominal.' },
  { key: 'vibration_level', label: 'Vibration level', unit: '× ref', min: 0, max: 5, step: 0.1, hint: 'Scales engine-/taxi-induced HCF cycles.' },
  { key: 'operating_intensity', label: 'Operating intensity', unit: '× ref', min: 0.2, max: 2, step: 0.05, hint: 'Thrust / duty usage (e.g. derate < 1, max-rated > 1).' },
]

export function MissionEditor({ missions, onChange, presets, modelType, maxMissions = 10 }: { missions: Mission[]; onChange: (m: Mission[]) => void; presets: MissionPresets | null; modelType: ModelType | null; maxMissions?: number }) {
  const relevant = modelType && presets ? presets.relevant_inputs[modelType] : INPUTS.map((i) => i.key as string)
  const update = (i: number, patch: Partial<Mission>) => onChange(missions.map((m, j) => (j === i ? { ...m, ...patch } : m)))
  const move = (i: number, d: number) => {
    const j = i + d
    if (j < 0 || j >= missions.length) return
    const copy = [...missions]
    ;[copy[i], copy[j]] = [copy[j], copy[i]]
    onChange(copy)
  }
  const presetValues = (p: string) => (presets?.presets[p] ?? {}) as Mission
  return (
    <div className="space-y-2">
      {missions.map((m, i) => {
        const pv = presetValues(m.profile)
        return (
          <div key={i} className="border border-line rounded bg-surface-2">
            <div className="flex items-center gap-2 px-3 py-2 border-b border-line bg-paper/60">
              <span className="num text-[12px] text-ink-3 w-8">M{i + 1}</span>
              <select className="input w-[240px]" value={m.profile} onChange={(e) => update(i, { profile: e.target.value as Mission['profile'], name: undefined })} aria-label={`Mission ${i + 1} profile`}>
                {Object.keys(PROFILE_LABELS).map((p) => (
                  <option key={p} value={p}>{PROFILE_LABELS[p]}</option>
                ))}
              </select>
              <input className="input flex-1" placeholder="Mission label (optional)" value={m.name ?? ''} onChange={(e) => update(i, { name: e.target.value || undefined })} />
              <label className="flex items-center gap-1 text-[12px] text-ink-2">
                × <input type="number" className="input w-[64px]" min={1} max={50} value={m.repeat ?? 1} onChange={(e) => update(i, { repeat: Math.max(1, Math.min(50, Number(e.target.value) || 1)) })} aria-label="Flights in block" /> flights
              </label>
              <button className="btn-ghost px-1.5" onClick={() => move(i, -1)} title="Move up" aria-label="Move up"><ArrowUp size={14} /></button>
              <button className="btn-ghost px-1.5" onClick={() => move(i, 1)} title="Move down" aria-label="Move down"><ArrowDown size={14} /></button>
              <button className="btn-ghost px-1.5" onClick={() => missions.length < maxMissions && onChange([...missions.slice(0, i + 1), { ...m }, ...missions.slice(i + 1)])} title="Duplicate" aria-label="Duplicate"><Copy size={14} /></button>
              <button className="btn-ghost px-1.5 text-red" onClick={() => onChange(missions.filter((_, j) => j !== i))} title="Remove" aria-label="Remove mission" disabled={missions.length === 1}><Trash2 size={14} /></button>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-x-4 gap-y-2 px-3 py-2">
              {INPUTS.filter((inp) => relevant.includes(inp.key as string)).map((inp) => {
                const val = (m[inp.key] as number | undefined) ?? (pv[inp.key] as number | undefined) ?? defaultFor(inp.key)
                return (
                  <Field key={inp.key} label={<span>{inp.label} <span className="normal-case tracking-normal text-ink-3">({inp.unit})</span></span>} hint={inp.hint}>
                    <input type="number" className="input" min={inp.min} max={inp.max} step={inp.step} value={val} onChange={(e) => update(i, { [inp.key]: e.target.value === '' ? undefined : Number(e.target.value) } as Partial<Mission>)} />
                  </Field>
                )
              })}
              {relevant.includes('environment') && (
                <Field label="Environment" hint="Corrosion / exposure factor.">
                  <select className="input" value={m.environment ?? pv.environment ?? 'benign'} onChange={(e) => update(i, { environment: e.target.value as Mission['environment'] })}>
                    {(presets?.environments ?? ['benign', 'humid', 'marine', 'desert']).map((e) => (
                      <option key={e} value={e}>{e}</option>
                    ))}
                  </select>
                </Field>
              )}
            </div>
          </div>
        )
      })}
      <div className="flex items-center gap-2">
        <button className="btn-secondary" onClick={() => missions.length < maxMissions && onChange([...missions, { profile: 'normal' }])} disabled={missions.length >= maxMissions}>
          <Plus size={14} /> Add mission
        </button>
        <span className="text-[11.5px] text-ink-3">{missions.length} / {maxMissions} missions · {missions.reduce((a, m) => a + (m.repeat ?? 1), 0)} flights · inputs shown are those relevant to the selected component model</span>
      </div>
    </div>
  )
}

function defaultFor(key: keyof Mission): number {
  const d: Partial<Record<keyof Mission, number>> = { duration_min: 120, landing_cycles: 1, load_factor: 1, load_variation: 0.1, manoeuvre_intensity: 1, temperature_c: 15, pressure_factor: 1, vibration_level: 1, operating_intensity: 1, repeat: 1 }
  return d[key] ?? 0
}
