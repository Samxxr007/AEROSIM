import { Gauge, Radio, ShieldCheck, Sparkles, Zap } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { api } from '../api/client'
import type { ComponentSummary, Flight, PlaybackBundle } from '../api/types'
import { DamageTile, GaugeTile, LiveChart, PhaseStrip, PHASE_COLORS, PHASE_LABEL, Transport, useLiveSample, usePlaybackClock } from '../components/live'
import { CAMERA_FOR, ComponentModel, Scene } from '../components/three'
import { Callout, DecisionPill, ErrorBox, Spinner, StatusPill, Tag } from '../components/ui'
import { useAppStore } from '../store/useAppStore'
import { useLiveFeed } from '../store/useLive'
import { usePlayback } from '../store/usePlayback'
import { CHANNEL_LABELS, CONDITION_LABELS, DECISION_LABELS, fmt, RESPONSE_LABELS } from '../utils/format'
import { useAction, useApi } from '../utils/useApi'

const TITLE: Record<string, string> = { engine_mount: 'Engine mount', landing_gear: 'Main landing gear', turbine_blade: 'HPT turbine blade', hydraulic_actuator: 'Hydraulic actuator' }

export default function LiveTwinPage() {
  const params = useParams()
  const [search, setSearch] = useSearchParams()
  const navigate = useNavigate()
  const pushToast = useAppStore((s) => s.pushToast)
  const selectedStore = useAppStore((s) => s.selectedComponentId)
  const setSelected = useAppStore((s) => s.setSelectedComponentId)
  const componentId = params.id ?? selectedStore
  const { lastChange } = useLiveFeed()
  usePlaybackClock()

  const comps = useApi(() => api.components({ modelled: true }), [])
  const comp = comps.data?.find((c) => c.id === componentId) ?? null
  const flights = useApi(() => api.flights({ aircraft_id: comp!.aircraft_id! }), [comp?.aircraft_id, lastChange], !!comp?.aircraft_id)
  const flightId = search.get('flight') ?? defaultFlight(flights.data)
  const bundle = useApi(() => api.playback(componentId, flightId!), [componentId, flightId, lastChange], !!flightId)
  const load = usePlayback((s) => s.load)
  const t = usePlayback((s) => s.t)
  const seek = usePlayback((s) => s.seek)
  const ended = usePlayback((s) => s.ended)
  const toggle = usePlayback((s) => s.toggle)
  const sample = useLiveSample()
  const [channel, setChannel] = useState<string | null>(null)

  useEffect(() => {
    if (bundle.data) {
      const prev = usePlayback.getState().data
      const keep = prev && prev.flight.id === bundle.data.flight.id && prev.component.id === bundle.data.component.id
      const tPrev = usePlayback.getState().t
      load(bundle.data)
      if (keep) seek(tPrev)
    }
  }, [bundle.data, load, seek])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !(e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement || e.target instanceof HTMLTextAreaElement)) {
        e.preventDefault()
        toggle()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [toggle])

  const d = bundle.data
  const channels = d ? Object.keys(d.predicted) : []
  const ch = channel && channels.includes(channel) ? channel : channels[0]
  const cam = comp ? CAMERA_FOR[comp.model_type!] : CAMERA_FOR.engine_mount

  // ------------------------------------------------------------------ actions
  const predict = useAction(async () => {
    const p = await api.predict({ component_id: componentId, flight_id: flightId!, mc_samples: 200 })
    pushToast('success', `Pre-flight prediction ${p.id} stored (model v${p.model_version}) — immutable.`)
    bundle.refetch()
  })
  const fly = useAction(async (anomaly: string) => {
    await api.completeFlight(flightId!, anomaly)
    pushToast('success', `Flight ${flightId} flown — as-flown conditions and sensor observations recorded for every modelled instance.`)
    bundle.refetch()
    flights.refetch()
    usePlayback.getState().restart()
  })
  const reconcile = useAction(async () => {
    const r = await api.reconcile({ prediction_id: d!.prediction_id! })
    pushToast('info', `Reconciliation ${r.id}: gate → ${DECISION_LABELS[r.gate.decision] ?? r.gate.decision}.`)
    bundle.refetch()
    seek(d!.duration_s)
  })
  const apply = useAction(async () => {
    const r = await api.applyReconciliation(d!.reconciliation!.id)
    pushToast(r.update.applied ? 'success' : 'warning', r.update.summary)
    if (d!.prediction_id) await api.commitPrediction(d!.prediction_id).catch(() => undefined)
    bundle.refetch()
    comps.refetch()
  })
  const busy = predict.busy || fly.busy || reconcile.busy || apply.busy
  const actionError = predict.error ?? fly.error ?? reconcile.error ?? apply.error

  const nextStep = useMemo(() => {
    if (!d) return null
    if (d.flight.status === 'scheduled' && !d.prediction_id) return { key: 'predict', label: 'Store pre-flight prediction', hint: 'Freezes the forecast with its model and input-data version before the flight.' }
    if (d.flight.status === 'scheduled' && d.prediction_id) return { key: 'fly', label: 'Fly this flight (synthetic)', hint: 'The hidden reference aircraft flies the schedule; sensor observations are recorded by flight ID.' }
    if (d.flight.status === 'completed' && d.prediction_id && !d.reconciliation) return { key: 'reconcile', label: 'Reconcile forecast vs as-flown', hint: 'Separates schedule deviation from response-model error and runs the evidence gate.' }
    if (d.reconciliation && !d.reconciliation.applied) return { key: 'apply', label: 'Apply Stage-A decision & commit flight', hint: 'Only response parameters may change; damage state is untouched.' }
    return null
  }, [d])

  return (
    <div className="space-y-3">
      {/* ------------------------------------------------------------ header bar */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <span className="relative inline-flex w-2.5 h-2.5"><span className="live-dot absolute inset-0 rounded-full bg-green" /></span>
          <h1 className="text-[18px] font-semibold text-white">Live twin</h1>
        </div>
        <select value={componentId} onChange={(e) => { setSelected(e.target.value); navigate(`/live/${e.target.value}`) }} className="input !w-auto">
          {(comps.data ?? []).map((c: ComponentSummary) => <option key={c.id} value={c.id}>{c.id} · {TITLE[c.model_type ?? ''] ?? c.name} · {c.position}</option>)}
        </select>
        <select value={flightId ?? ''} onChange={(e) => setSearch({ flight: e.target.value })} className="input !w-auto">
          {(flights.data ?? []).map((f) => <option key={f.id} value={f.id}>{f.id} · {f.route_or_mission} · {f.flight_date} · {f.status}</option>)}
        </select>
        {d && (
          <div className="flex items-center gap-1.5 text-[11.5px]">
            <Tag kind={d.preview ? 'assumption' : 'simulation'}>{d.preview ? 'live preview — not stored' : `prediction ${d.prediction_id}`}</Tag>
            {d.observed && <Tag kind={d.observed.provenance}>{d.observed.anomaly !== 'none' ? `sensor · ${d.observed.anomaly}` : 'sensor data'}</Tag>}
            {d.reconciliation && <DecisionPill decision={d.reconciliation.final_decision ?? d.reconciliation.gate.decision} />}
            <span className="num text-ink-3">model v{d.component.model_version}</span>
          </div>
        )}
        <div className="ml-auto flex items-center gap-2">
          {nextStep && (
            <button className="btn-primary" disabled={busy} onClick={() => (nextStep.key === 'predict' ? predict.run() : nextStep.key === 'fly' ? fly.run('none') : nextStep.key === 'reconcile' ? reconcile.run() : apply.run())} title={nextStep.hint}>
              <Zap size={14} /> {nextStep.label}
            </button>
          )}
          {nextStep?.key === 'fly' && (
            <select className="input !w-auto !py-1 !text-[12px]" defaultValue="none" onChange={(e) => e.target.value !== 'none' && fly.run(e.target.value)} disabled={busy} title="Inject a sensor anomaly into this flight's observation">
              <option value="none">fly with anomaly…</option>
              <option value="dropout">data-link dropout</option>
              <option value="outliers">spike outliers</option>
              <option value="sensor_bias">sensor bias</option>
              <option value="wrong_component">wrong component</option>
            </select>
          )}
        </div>
      </div>
      {actionError != null && <ErrorBox error={actionError} />}
      {bundle.error != null && <ErrorBox error={bundle.error} />}
      {!d && bundle.loading && <Spinner label="Loading flight playback…" />}

      {d && comp && (
        <>
          {/* ------------------------------------------------------------ main stage */}
          <div className="grid grid-cols-12 gap-3">
            <div className="col-span-12 xl:col-span-8">
              <div className="card overflow-hidden">
                <div className="relative h-[520px]">
                  <Scene camera={cam.camera} target={cam.target} shadowY={cam.shadowY} className="absolute inset-0">
                    <ComponentModel modelType={comp.model_type} signals={sample.signals} damage={sample.damage} />
                  </Scene>
                  {/* HUD overlay */}
                  <div className="absolute left-3 top-3 pointer-events-none space-y-1">
                    <div className="text-[11px] uppercase tracking-[0.14em] text-ink-3">{TITLE[comp.model_type!]} · {comp.position}</div>
                    <div className="text-[15px] font-semibold text-white">{comp.id} <span className="text-ink-3 font-normal">S/N {d.component.serial_number}</span></div>
                    <div className="text-[11.5px] text-ink-2">{d.flight.id} · {d.flight.route_or_mission} · {d.flight.flight_date}</div>
                  </div>
                  <div className="absolute right-3 top-3 pointer-events-none text-right">
                    <div className="text-[11px] uppercase tracking-[0.14em] text-ink-3">phase</div>
                    <div className="text-[22px] font-semibold leading-tight" style={{ color: PHASE_COLORS[sample.phase] }}>{PHASE_LABEL[sample.phase] ?? sample.phase}</div>
                    <div className="num text-[11.5px] text-ink-2">{(sample.progress * 100).toFixed(0)} % of flight</div>
                  </div>
                  <div className="absolute left-3 bottom-3 pointer-events-none flex gap-3">
                    <Hud label="load" v={sample.signals.load} color="#38bdf8" />
                    <Hud label="thermal" v={sample.signals.temperature} color="#f5b041" />
                    <Hud label="vibration" v={sample.signals.vibration} color="#a78bfa" />
                    {'pressure_bar' in d.predicted && <Hud label="pressure" v={sample.signals.pressure} color="#3ddc97" />}
                  </div>
                  {d.preview && (
                    <div className="absolute right-3 bottom-3 max-w-[280px] text-[11px] text-amber bg-[#0a0f16]/80 border border-amber/40 rounded px-2 py-1 pointer-events-none">{d.preview_note}</div>
                  )}
                </div>
                <div className="border-t border-line px-3 pt-2 pb-1">
                  <PhaseStrip d={d} t={t} onSeek={seek} />
                </div>
                <Transport />
              </div>
            </div>
            <div className="col-span-12 xl:col-span-4 space-y-3">
              <div className="grid grid-cols-2 gap-2">
                {channels.map((k) => <GaugeTile key={k} k={k} sample={sample} d={d} />)}
              </div>
              <div className="card px-3 py-2">
                <div className="flex items-center gap-1.5 label mb-2"><Gauge size={12} /> damage state — model estimate during this flight</div>
                <div className="grid grid-cols-1 gap-2">
                  {Object.keys(d.state_labels).filter((k) => k in d.increments || k in d.trajectory).map((k) => <DamageTile key={k} k={k} sample={sample} d={d} />)}
                </div>
                <p className="text-[10.5px] text-ink-3 mt-2">{d.trajectory_note} Sensor residuals never move these values — only Stage-B inspection evidence does.</p>
              </div>
            </div>
          </div>

          {/* ------------------------------------------------------------ forecast vs actual + gate */}
          <div className="grid grid-cols-12 gap-3">
            <div className="col-span-12 xl:col-span-7 card">
              <div className="flex items-center justify-between px-3 py-2 border-b border-line">
                <div className="text-[12.5px] font-medium flex items-center gap-1.5"><Radio size={13} className="text-accent" /> Forecast vs as-flown sensor trace</div>
                <div className="flex gap-1">
                  {channels.map((k) => <button key={k} onClick={() => setChannel(k)} className={`px-2 py-0.5 rounded text-[11px] border ${k === ch ? 'border-accent text-accent-2 bg-accent-soft' : 'border-line text-ink-3 hover:text-ink'}`}>{CHANNEL_LABELS[k] ?? k}</button>)}
                </div>
              </div>
              <div className="px-2 pt-2">
                {ch && <LiveChart d={d} k={ch} t={t} height={230} />}
                <div className="flex gap-4 px-2 pb-2 text-[10.5px] text-ink-3">
                  <span><span className="inline-block w-3 h-[2px] bg-accent align-middle mr-1" />pre-flight forecast (stored, immutable)</span>
                  <span><span className="inline-block w-3 h-2 bg-accent/25 align-middle mr-1" />{d.band_note}</span>
                  <span><span className="inline-block w-3 h-[2px] bg-amber align-middle mr-1" />sensor trace revealed as the flight progresses</span>
                </div>
              </div>
            </div>
            <div className="col-span-12 xl:col-span-5">
              <GatePanel d={d} revealed={ended || t >= d.duration_s - 1} onApply={() => apply.run()} busy={busy} />
            </div>
          </div>

          {/* ------------------------------------------------------------ conditions used */}
          <div className="card px-3 py-2">
            <div className="label mb-1.5 flex items-center gap-1.5"><Sparkles size={12} /> flight conditions used by the forecast — provenance per input</div>
            <div className="flex flex-wrap gap-1.5">
              {Object.entries(d.conditions).map(([k, v]) => {
                const prov = d.condition_provenance?.[k] ?? ''
                const sched = prov.startsWith('scheduled') || prov.startsWith('derived')
                const unc = d.condition_uncertainty?.[k]
                return (
                  <span key={k} className={`rounded border px-2 py-0.5 text-[11px] num ${sched ? 'border-accent/40 text-accent-2' : prov.startsWith('historical') ? 'border-amber/40 text-amber' : 'border-line-strong text-ink-2'}`} title={prov || 'current twin resolution'}>
                    {CONDITION_LABELS[k] ?? k} {typeof v === 'number' ? fmt.num(v, 4) : v}{unc ? ` ±${fmt.num(unc, 2)}` : ''}
                  </span>
                )
              })}
            </div>
            <div className="mt-1.5 text-[10.5px] text-ink-3">cyan = known from the schedule · amber = estimated from comparable earlier flights of this aircraft · grey = documented engineering default. Flight-time actuals are never used before the flight.</div>
          </div>
        </>
      )}
    </div>
  )
}

function defaultFlight(fl: Flight[] | null): string | null {
  if (!fl?.length) return null
  const sched = fl.filter((f) => f.status === 'scheduled').sort((a, b) => a.sequence - b.sequence)
  if (sched.length) return sched[0].id
  return fl.sort((a, b) => b.sequence - a.sequence)[0].id
}

function Hud({ label, v, color }: { label: string; v: number; color: string }) {
  return (
    <div className="w-[88px]">
      <div className="flex justify-between text-[10px] uppercase tracking-wider text-ink-3"><span>{label}</span><span className="num" style={{ color }}>{(v * 100).toFixed(0)}</span></div>
      <div className="h-1.5 rounded bg-white/10 overflow-hidden mt-0.5"><div className="h-full transition-[width] duration-150" style={{ width: `${Math.min(100, v * 100)}%`, background: color, boxShadow: `0 0 8px ${color}` }} /></div>
    </div>
  )
}

function GatePanel({ d, revealed, onApply, busy }: { d: PlaybackBundle; revealed: boolean; onApply: () => void; busy: boolean }) {
  const rec = d.reconciliation
  if (!rec) {
    return (
      <div className="card h-full px-3 py-3 flex flex-col">
        <div className="text-[12.5px] font-medium flex items-center gap-1.5 mb-2"><ShieldCheck size={13} className="text-accent" /> Evidence gate</div>
        {d.flight.status === 'scheduled' ? (
          <Callout kind="info" title="Flight not flown yet">The gate runs after the flight: it compares the stored forecast with the sensor trace, splits the error into schedule deviation vs response-model error, and decides whether any update is allowed.</Callout>
        ) : d.prediction_id ? (
          <Callout kind="warning" title="Not reconciled yet">The flight has sensor data but the forecast has not been reconciled. Use the action in the header.</Callout>
        ) : (
          <Callout kind="warning" title="No pre-flight prediction was stored for this flight">Only predictions stored before the flight can be reconciled — a forecast made now would have seen the outcome.</Callout>
        )}
        {d.as_flown && (
          <div className="mt-3 text-[11.5px] text-ink-2">
            As-flown model estimate{d.as_flown.provisional ? ' (provisional, not committed)' : ''}: <StatusPill status={d.as_flown.threshold_status} />
          </div>
        )}
      </div>
    )
  }
  const g = rec.gate
  const fe = rec.forecast_summary?.mean_relative_error ?? rec.summary.forecast_mean_relative_error ?? null
  const re = rec.summary.mean_relative_error
  const sched = fe != null ? Math.max(0, fe - re) : null
  const tone = g.decision === 'accept' ? 'green' : g.decision === 'accept_reduced_confidence' ? 'accent' : g.decision === 'request_more_evidence' ? 'amber' : 'red'
  return (
    <div className={`card h-full px-3 py-3 transition-all duration-700 ${revealed ? 'opacity-100 translate-y-0' : 'opacity-40 translate-y-1'}`}>
      <div className="flex items-center justify-between mb-2">
        <div className="text-[12.5px] font-medium flex items-center gap-1.5"><ShieldCheck size={13} className="text-accent" /> Evidence gate · Stage A</div>
        <div className={`${revealed ? 'glow-ring' : ''} rounded`}><DecisionPill decision={rec.final_decision ?? g.decision} /></div>
      </div>
      {!revealed && <div className="text-[11px] text-ink-3 mb-2">Decision is revealed when the flight playback reaches the end.</div>}
      <div className="grid grid-cols-3 gap-2 mb-2">
        <Mini label="forecast error" v={fe != null ? fmt.pct(fe) : '—'} tone="amber" />
        <Mini label="schedule deviation" v={sched != null ? fmt.pct(sched) : '—'} tone="default" hint="not a model error" />
        <Mini label="response-model error" v={fmt.pct(re)} tone={tone} hint="only this part may correct the model" />
      </div>
      <div className="space-y-1 mb-2">
        {Object.entries(rec.channels ?? {}).map(([k, c]) => (
          <div key={k} className="flex items-center gap-2 text-[11px]">
            <span className="w-[86px] text-ink-2">{CHANNEL_LABELS[k] ?? k}</span>
            <div className="flex-1 h-1.5 rounded bg-graphite border border-line overflow-hidden"><div className="h-full" style={{ width: `${(c.reliability ?? 0) * 100}%`, background: (c.reliability ?? 0) >= 0.5 ? '#3ddc97' : '#f0605d' }} /></div>
            <span className="num w-[64px] text-right text-ink-3">rel {fmt.fixed(c.reliability, 2)}</span>
            <span className="num w-[70px] text-right text-ink-3">miss {fmt.pct(c.missing_fraction, 0)}</span>
          </div>
        ))}
      </div>
      {Object.keys(rec.proposals ?? {}).length > 0 && (
        <div className="text-[11.5px] mb-2">
          {Object.entries(rec.proposals).map(([p, v]) => (
            <div key={p} className="flex items-center justify-between num"><span className="text-ink-2 font-sans">{RESPONSE_LABELS[p] ?? p}</span><span>{fmt.fixed(v.before, 3)} → <span className="text-accent-2">{fmt.fixed(v.proposed, 3)}</span> <span className="text-ink-3">({v.relative_change >= 0 ? '+' : ''}{(v.relative_change * 100).toFixed(1)} %)</span></span></div>
          ))}
        </div>
      )}
      <ul className="text-[11px] text-ink-3 space-y-0.5 list-disc pl-4 mb-2">{g.reasons.slice(0, 3).map((r, i) => <li key={i}>{r}</li>)}</ul>
      <div className="flex items-center justify-between">
        <span className="text-[11px] text-ink-3">{rec.applied ? `applied · model v${rec.model_version}` : 'not applied yet'}</span>
        {!rec.applied && <button className="btn-primary !py-1" onClick={onApply} disabled={busy}>Apply decision</button>}
      </div>
    </div>
  )
}

function Mini({ label, v, tone, hint }: { label: string; v: string; tone: string; hint?: string }) {
  const c = tone === 'green' ? 'text-green' : tone === 'amber' ? 'text-amber' : tone === 'red' ? 'text-red' : tone === 'accent' ? 'text-accent-2' : 'text-ink'
  return (
    <div className="rounded border border-line bg-graphite/60 px-2 py-1.5">
      <div className="label !text-[9.5px]">{label}</div>
      <div className={`num text-[17px] leading-tight ${c}`}>{v}</div>
      {hint && <div className="text-[9.5px] text-ink-3">{hint}</div>}
    </div>
  )
}
