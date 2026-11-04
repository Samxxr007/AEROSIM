import { Play } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { api } from '../api/client'
import type { ModelType, SimulationRun } from '../api/types'
import { DamageProgressionChart, IncrementChart, SensitivityChart, StressSpectrumChart } from '../components/charts'
import { CAMERA_FOR, ComponentModel, damageFractions, FALLBACK_LIMITS, healthColor, Scene, type LiveSignals } from '../components/three'
import { PROFILE_LABELS } from '../utils/format'
import { MissionEditor } from '../components/MissionEditor'
import { Callout, Card, ErrorBox, Field, KV, PageHeader, Spinner, Stat, StatusPill, Tag } from '../components/ui'
import { useAppStore } from '../store/useAppStore'
import { fmt, fmtState, KEY_METRIC, stateLabel, WHAT_IF_LABEL } from '../utils/format'
import { useAction, useApi } from '../utils/useApi'

export default function SimulationPage() {
  const { selectedComponentId, setSelectedComponentId, draftMissions, setDraftMissions, lastRunId, setLastRunId, pushToast, refreshKey, bump } = useAppStore()
  const [params] = useSearchParams()
  const comps = useApi(() => api.components({ modelled: true }), [refreshKey])
  const presets = useApi(() => api.missionPresets(), [])
  const scenarios = useApi(() => api.scenarios(selectedComponentId), [selectedComponentId, refreshKey])
  const runs = useApi(() => api.simulations(selectedComponentId), [selectedComponentId, refreshKey])
  const comp = comps.data?.find((c) => c.id === selectedComponentId) ?? comps.data?.[0]
  const modelType = (comp?.model_type ?? null) as ModelType | null
  const [mc, setMc] = useState(300)
  const [label, setLabel] = useState('')
  const [run, setRun] = useState<SimulationRun | null>(null)
  const [scenarioId, setScenarioId] = useState('')
  const wanted = params.get('run') ?? lastRunId
  useEffect(() => {
    if (wanted && (!run || run.id !== wanted)) api.simulation(wanted).then(setRun).catch(() => setLastRunId(null))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wanted])
  useEffect(() => {
    if (run && run.component_id !== selectedComponentId && comps.data?.some((c) => c.id === run.component_id)) setSelectedComponentId(run.component_id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run?.id])
  useEffect(() => {
    if (!run && !wanted && runs.data?.length) api.simulation(runs.data[0].id).then((x) => { setRun(x); setLastRunId(x.id) }).catch(() => undefined)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runs.data])
  const simulate = useAction(async () => {
    if (!comp) throw new Error('Select a component with an implemented model.')
    const r = await api.simulate({ component_id: comp.id, missions: draftMissions, label, mc_samples: mc, scenario_id: scenarioId || null })
    setRun(r)
    setLastRunId(r.id)
    bump()
    pushToast('success', `Simulation ${r.id}: ${r.n_flights} flights, ${r.threshold_status.replace('_', ' ')}.`)
  })
  const key = modelType ? KEY_METRIC[modelType] : 'miner_damage'
  const stateKeys = run ? Object.keys(run.final_state).filter((k) => !['flights', 'cumulative_cycles', 'landings', 'hot_hours', 'operating_hours'].includes(k)) : []
  return (
    <div className="space-y-4">
      <PageHeader title="Engineering what-if — sequence simulation" lede="Secondary tool: sequential degradation of the component's current calibrated twin through a hypothetical sequence of flights. Each flight records applied conditions, predicted stress, incremental and cumulative damage, margins, uncertainty and threshold status. The twin state is never changed by a what-if run." />
      <Callout kind="warning" title={WHAT_IF_LABEL}>Hypothetical conditions; not a scheduled flight. Use the Predictions page for the component's actual next flight.</Callout>
      <div className="grid xl:grid-cols-3 gap-4">
        <Card title="Simulation setup" className="xl:col-span-2">
          <div className="flex flex-wrap items-end gap-3 mb-3">
            <Field label="Component" className="w-[340px]">
              <select className="input" value={comp?.id ?? ''} onChange={(e) => { setSelectedComponentId(e.target.value); setRun(null); setLastRunId(null) }}>
                {(comps.data ?? []).map((c) => <option key={c.id} value={c.id}>{c.id} — {c.name}</option>)}
              </select>
            </Field>
            <Field label="Load saved scenario" className="w-[260px]">
              <select className="input" value={scenarioId} onChange={(e) => { setScenarioId(e.target.value); const s = scenarios.data?.find((x) => x.id === e.target.value); if (s) setDraftMissions(s.missions) }}>
                <option value="">— draft sequence —</option>
                {(scenarios.data ?? []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </Field>
            <Field label="Monte Carlo samples" hint="0 disables uncertainty" className="w-[150px]">
              <input className="input" type="number" min={0} max={5000} step={50} value={mc} onChange={(e) => setMc(Math.max(0, Math.min(5000, Number(e.target.value) || 0)))} />
            </Field>
            <Field label="Run label" className="w-[220px]"><input className="input" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="optional" /></Field>
          </div>
          <MissionEditor missions={draftMissions} onChange={setDraftMissions} presets={presets.data} modelType={modelType} />
          <div className="flex items-center gap-3 mt-3">
            <button className="btn-primary" onClick={() => simulate.run()} disabled={simulate.busy || !comp} data-testid="run-simulation"><Play size={14} /> {simulate.busy ? 'Simulating…' : 'Run simulation'}</button>
            {simulate.busy && <span className="text-[12px] text-ink-3">Running sequential physics and {mc} Monte Carlo samples on the backend…</span>}
          </div>
          <ErrorBox error={simulate.error} />
        </Card>
        <Card title="Previous runs" subtitle="This component" dense>
          {runs.loading && !runs.data ? <Spinner /> : (runs.data ?? []).length === 0 ? <div className="text-[12px] text-ink-3">No runs yet.</div> : (
            <ul className="space-y-1 max-h-[420px] overflow-y-auto">
              {(runs.data ?? []).map((r) => (
                <li key={r.id}>
                  <button className={`w-full text-left border rounded px-2 py-1.5 text-[12px] ${run?.id === r.id ? 'border-accent bg-accent-soft' : 'border-line hover:bg-paper'}`} onClick={() => api.simulation(r.id).then((x) => { setRun(x); setLastRunId(x.id) })}>
                    <div className="flex items-center justify-between gap-2"><span className="font-medium truncate">{r.label}</span><StatusPill status={r.threshold_status} /></div>
                    <div className="num text-ink-3">{r.id} · {r.n_flights} flights · v{r.model_version} · {fmt.date(r.created_at)}</div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      {run && (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-[15px] font-semibold">Run {run.id}</h2>
            <span className="text-[12.5px] text-ink-2">{run.label} · {run.component_name} · model v{run.model_version} · <Tag kind="simulation">what-if</Tag></span>
            <StatusPill status={run.threshold_status} />
            <span className="ml-auto text-[11.5px] text-amber">{WHAT_IF_LABEL}</span>
          </div>
          {run.stop_reason && <Callout kind="error" title="Threshold crossed">{run.stop_reason} The sequence was stopped; Paris' law / Miner's rule are not applied beyond their validity.</Callout>}
          <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
            <Stat label="Flights simulated" value={run.n_flights} />
            <Stat label={`Final ${stateLabel(key).label}`} value={fmtState(key, run.final_state[key])} hint={`from ${fmtState(key, run.initial_state[key])}`} />
            <Stat label="Governing remaining life" value={run.remaining_life.governing_remaining_flights != null ? fmt.int(run.remaining_life.governing_remaining_flights) : '—'} unit="flights (ref. mission)" hint={run.remaining_life.governing_mechanism?.replace(/_/g, ' ') ?? 'not supported'} />
            <Stat label="Threshold-crossing fraction" value={run.uncertainty ? fmt.pct(run.uncertainty.threshold_crossing_fraction, 1) : '—'} hint={run.uncertainty ? `${run.uncertainty.n_samples} MC samples · model-derived` : 'uncertainty disabled'} tone={run.uncertainty && run.uncertainty.threshold_crossing_fraction > 0.05 ? 'warn' : 'default'} />
            <Stat label="Minimum remaining margin" value={fmt.pct(Math.min(...run.flights.map((f) => f.remaining_margin ?? 1)), 1)} hint="worst mechanism at last flight" />
          </div>
          <WhatIfReplay run={run} stateKey={key} />
          <div className="grid xl:grid-cols-2 gap-4">
            <Card dense><DamageProgressionChart flights={run.flights} stateKey={key} uncertainty={run.uncertainty} initial={run.initial_state[key]} /></Card>
            <Card dense>{stateKeys.filter((k) => k !== key)[0] ? <DamageProgressionChart flights={run.flights} stateKey={stateKeys.filter((k) => k !== key)[0]} uncertainty={run.uncertainty} initial={run.initial_state[stateKeys.filter((k) => k !== key)[0]]} /> : <IncrementChart flights={run.flights} incKey={key} />}</Card>
            <Card dense><IncrementChart flights={run.flights} incKey={key} /></Card>
            <Card dense>{run.missions[0]?.stress_bins?.length ? <StressSpectrumChart bins={run.missions[0].stress_bins} /> : <div className="text-[12px] text-ink-3 p-4">No stress-range spectrum for this model (pressure-cycle based).</div>}</Card>
          </div>
          <Card title="Mission-by-mission progression" subtitle="Applied conditions, predicted stress, incremental damage, cumulative state, margin and threshold status per flight" dense>
            <div className="overflow-x-auto">
              <table className="table whitespace-nowrap">
                <thead>
                  <tr><th>Flight</th><th>Mission</th><th>Max stress / peak T</th>{stateKeys.map((k) => <th key={k}>Δ {stateLabel(k).label}</th>)}{stateKeys.map((k) => <th key={k}>{stateLabel(k).label}</th>)}<th>Margin</th><th>Status</th></tr>
                </thead>
                <tbody>
                  {run.flights.map((f) => {
                    const m = run.missions[f.mission_index]
                    return (
                      <tr key={f.flight_index}>
                        <td className="num">{f.flight_index}</td>
                        <td>{m.mission.name}</td>
                        <td className="num">{f.outputs.max_stress_mpa != null ? `${fmt.fixed(f.outputs.max_stress_mpa as number, 1)} MPa` : ''}{f.outputs.peak_temperature_k != null ? ` / ${fmt.k2c(f.outputs.peak_temperature_k as number)}` : ''}{f.outputs.pressure_cycles != null ? ` ${f.outputs.pressure_cycles} p-cycles` : ''}</td>
                        {stateKeys.map((k) => <td key={k} className="num">{fmtState(k, f.increments[k] ?? 0)}</td>)}
                        {stateKeys.map((k) => <td key={k} className="num">{fmtState(k, f.state_after[k])}</td>)}
                        <td className="num">{fmt.pct(f.remaining_margin, 1)}</td>
                        <td><StatusPill status={f.threshold_status} /></td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            {run.flights.some((f) => f.warnings.length) && <div className="mt-2 text-[12px] text-amber">{[...new Set(run.flights.flatMap((f) => f.warnings))].join(' ')}</div>}
          </Card>
          <div className="grid xl:grid-cols-3 gap-4">
            <Card title="Remaining-life estimate" subtitle={`Unit: ${run.remaining_life.unit}`} dense>
              <KV rows={Object.entries(run.remaining_life).filter(([k]) => k !== 'unit').map(([k, v]) => ({ k: k.replace(/_/g, ' '), v: typeof v === 'number' ? fmt.num(v, 4) : v == null ? '—' : String(v) }))} />
              <div className="text-[11px] text-ink-3 mt-2">Computed by repeating the reference (normal) mission from the final state until the model threshold. Not converted to calendar time.</div>
            </Card>
            {run.uncertainty ? (
              <>
                <Card title="Uncertainty analysis" subtitle={run.uncertainty.method} dense>
                  <KV rows={[
                    { k: 'Samples', v: `${run.uncertainty.n_samples} (requested ${run.uncertainty.n_samples_requested}) · seed ${run.uncertainty.seed}` },
                    { k: 'Final P5 / P50 / P95', v: `${fmtState(key, run.uncertainty.key_percentiles.p5.at(-1))} / ${fmtState(key, run.uncertainty.key_percentiles.p50.at(-1))} / ${fmtState(key, run.uncertainty.key_percentiles.p95.at(-1))}` },
                    { k: 'Threshold-crossing fraction', v: fmt.pct(run.uncertainty.threshold_crossing_fraction, 1) },
                    { k: 'Parameter uncertainty', v: run.uncertainty.uncertainty_classes.parameter.join(', ') || '—' },
                    { k: 'Measurement uncertainty', v: run.uncertainty.uncertainty_classes.measurement.join(', ') || '—' },
                    { k: 'Operational variability', v: run.uncertainty.uncertainty_classes.operational.join(', ') || '—' },
                    { k: 'Model-form uncertainty', v: run.uncertainty.uncertainty_classes.model_form.join(', ') || '—' },
                  ]} />
                  <div className="mt-2"><Callout kind="warning">{run.uncertainty.calibration_status}</Callout></div>
                </Card>
                <Card dense><SensitivityChart sens={run.uncertainty.sensitivity_spearman} /></Card>
              </>
            ) : (
              <Card title="Uncertainty analysis" dense><div className="text-[12px] text-ink-3">Monte Carlo sampling was disabled for this run.</div></Card>
            )}
          </div>
          <Card title="Parameters used in this run" subtitle="Snapshot at run time (auditable)" dense>
            <div className="grid md:grid-cols-2 gap-3 text-[12px]">
              <div><div className="label mb-1">Response parameters</div><KV rows={Object.entries(run.response_params_used).map(([k, v]) => ({ k, v: v.toFixed(4) }))} /></div>
              <div><div className="label mb-1">Model parameters</div><div className="num text-ink-2 leading-relaxed">{Object.entries(run.parameters_used).map(([k, v]) => `${k}=${fmt.num(v, 4)}`).join(' · ')}</div></div>
            </div>
          </Card>
        </>
      )}
    </div>
  )
}

/** Scrub through the hypothetical sequence: the 3D part shows the state after flight n under that mission's loading. */
function WhatIfReplay({ run, stateKey }: { run: SimulationRun; stateKey: string }) {
  const [idx, setIdx] = useState(run.flights.length - 1)
  const [auto, setAuto] = useState(false)
  useEffect(() => setIdx(run.flights.length - 1), [run.id, run.flights.length])
  useEffect(() => {
    if (!auto) return
    const t = setInterval(() => setIdx((i) => (i + 1 >= run.flights.length ? 0 : i + 1)), 700)
    return () => clearInterval(t)
  }, [auto, run.flights.length])
  const f = run.flights[idx]
  const m = run.missions[f.mission_index]
  const limits = useMemo(() => {
    const l: Record<string, number | null> = { ...FALLBACK_LIMITS[run.model_type] }
    const ac = run.flights.find((x) => x.outputs.a_critical_m != null)?.outputs.a_critical_m
    if (ac) l.crack_length_m = ac
    return l
  }, [run])
  const damage = damageFractions(f.state_after, limits)
  const signals: LiveSignals = useMemo(() => {
    const mm = m.mission
    const load = Math.min(1.2, 0.55 * (mm.load_factor ?? 1) * (mm.operating_intensity ?? 1))
    return { load, temperature: Math.min(1, 0.35 + ((mm.temperature_c ?? 15) - 15) / 60 + 0.3 * ((mm.operating_intensity ?? 1) - 1)), vibration: Math.min(1, 0.4 * (mm.vibration_level ?? 1)), pressure: Math.min(1, 0.6 * (mm.pressure_factor ?? 1)), phase: 'cruise', playing: auto }
  }, [m, auto])
  const cam = CAMERA_FOR[run.model_type]
  const frac = damage.fractions[stateKey]
  return (
    <div className="card overflow-hidden">
      <div className="grid grid-cols-12">
        <div className="col-span-12 xl:col-span-8 relative h-[380px]">
          <Scene camera={cam.camera} target={cam.target} shadowY={cam.shadowY} className="absolute inset-0">
            <ComponentModel modelType={run.model_type} signals={signals} damage={damage} />
          </Scene>
          <div className="absolute left-3 top-3 pointer-events-none">
            <div className="text-[10px] uppercase tracking-[0.14em] text-amber">{WHAT_IF_LABEL}</div>
            <div className="text-[14px] text-white font-semibold">after flight {f.flight_index} of {run.flights.length} · {m.mission.name}</div>
            <div className="text-[11px] text-ink-2">{PROFILE_LABELS[m.mission.profile] ?? m.mission.profile} · load ×{m.mission.load_factor ?? 1} · {m.mission.temperature_c ?? 15} °C · {m.mission.environment ?? 'benign'}</div>
          </div>
          <div className="absolute right-3 top-3"><StatusPill status={f.threshold_status} /></div>
        </div>
        <div className="col-span-12 xl:col-span-4 border-l border-line p-3 space-y-2">
          <div className="label">scrub the hypothetical sequence</div>
          <div className="flex items-center gap-2">
            <button className="btn-secondary !py-1" onClick={() => setAuto((a) => !a)}>{auto ? 'Stop' : 'Auto-play'}</button>
            <input type="range" min={0} max={run.flights.length - 1} value={idx} onChange={(e) => { setAuto(false); setIdx(Number(e.target.value)) }} className="flex-1 accent-[#38bdf8]" aria-label="Flight index" />
            <span className="num text-[12px] w-[60px] text-right">{idx + 1} / {run.flights.length}</span>
          </div>
          {Object.entries(f.state_after).filter(([k]) => k in damage.fractions || k === stateKey).map(([k, v]) => {
            const fr = damage.fractions[k]
            return (
              <div key={k}>
                <div className="flex justify-between text-[11.5px]"><span className="text-ink-2">{stateLabel(k).label}</span><span className="num text-white">{fmtState(k, v)}</span></div>
                <div className="h-1.5 rounded bg-graphite border border-line overflow-hidden mt-0.5">{fr != null && <div className="h-full transition-[width] duration-300" style={{ width: `${fr * 100}%`, background: healthColor(fr) }} />}</div>
              </div>
            )
          })}
          <div className="text-[11px] text-ink-3">margin {fmt.pct(f.remaining_margin, 1)} · {f.threshold_detail}</div>
          {frac != null && frac >= 0.75 && <div className="text-[11px] text-red">Governing state above 75 % of its review limit in this hypothetical sequence.</div>}
          <div className="text-[10.5px] text-ink-3">The twin state is never changed by a what-if run; this replays a stored hypothetical result.</div>
        </div>
      </div>
    </div>
  )
}
