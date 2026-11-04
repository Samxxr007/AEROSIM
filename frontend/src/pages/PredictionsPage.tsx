import { History, Radio, Target } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { api } from '../api/client'
import type { Prediction } from '../api/types'
import { SensitivityChart, StressSpectrumChart } from '../components/charts'
import { Callout, Card, DecisionPill, ErrorBox, Field, KV, PageHeader, Spinner, Stat, StatusPill, Tag } from '../components/ui'
import { useAppStore } from '../store/useAppStore'
import { CONDITION_LABELS, fmt, fmtState, KEY_METRIC, RESPONSE_LABELS, stateLabel } from '../utils/format'
import { useAction, useApi } from '../utils/useApi'

export default function PredictionsPage() {
  const { selectedComponentId, setSelectedComponentId, lastPredictionId, setLastPredictionId, pushToast, refreshKey, bump } = useAppStore()
  const [params] = useSearchParams()
  const comps = useApi(() => api.components({ modelled: true }), [refreshKey])
  const comp = comps.data?.find((c) => c.id === selectedComponentId) ?? comps.data?.[0]
  const cid = comp?.id ?? ''
  const twin = useApi(() => api.twin(cid), [cid, refreshKey], !!cid)
  const next = useApi(() => api.nextFlight(cid), [cid, refreshKey], !!cid)
  const list = useApi(() => api.predictions({ component_id: cid }), [cid, refreshKey], !!cid)
  const [pred, setPred] = useState<Prediction | null>(null)
  const [mc, setMc] = useState(300)
  const wanted = params.get('prediction') ?? lastPredictionId
  useEffect(() => {
    if (wanted && (!pred || pred.id !== wanted)) api.prediction(wanted).then(setPred).catch(() => setLastPredictionId(null))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wanted])
  useEffect(() => {
    if (!pred && !wanted && list.data?.length) api.prediction(list.data[0].id).then(setPred).catch(() => undefined)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [list.data])
  const initialise = useAction(async () => {
    const r = await api.initialiseTwin(cid)
    bump()
    pushToast('success', `${cid} initialised from its own history → model v${r.component.model_version}.`)
  })
  const predict = useAction(async () => {
    if (!next.data?.flight) throw new Error('No scheduled flight to predict.')
    const p = await api.predict({ component_id: cid, flight_id: next.data.flight.id, mc_samples: mc })
    setPred(p)
    setLastPredictionId(p.id)
    bump()
    pushToast('success', `Pre-flight prediction ${p.id} stored for ${p.flight_id} (model v${p.model_version}).`)
  })
  const key = comp ? KEY_METRIC[comp.model_type!] : 'miner_damage'
  const res = next.data?.resolution
  return (
    <div className="space-y-4">
      <PageHeader title="Upcoming flight predictions" lede="Pre-flight prediction for the component's next actual scheduled flight: the twin's calibrated condition plus the flight information known in advance. Conditions missing from the schedule are estimated from the component's comparable historical flights and tagged as estimates. Each prediction is stored immutably so that it can be compared with the actual flight afterwards." />
      <Card dense>
        <div className="flex flex-wrap items-end gap-3">
          <Field label="Component instance" className="w-[420px]">
            <select className="input" value={cid} onChange={(e) => { setSelectedComponentId(e.target.value); setPred(null); setLastPredictionId(null) }}>
              {(comps.data ?? []).map((c) => <option key={c.id} value={c.id}>{c.id} — {c.name} ({c.aircraft_id})</option>)}
            </select>
          </Field>
          {comp && twin.data && (
            <div className="text-[12px] text-ink-2 pb-2 flex flex-wrap gap-3">
              <span>Model <span className="num">v{comp.model_version}</span></span>
              <span>{twin.data.history_initialised ? <span className="text-green">twin initialised from {twin.data.evidence_summary?.completed_flights_with_observations} flights / {twin.data.evidence_summary?.inspections} inspections / {twin.data.evidence_summary?.maintenance_records} maintenance records</span> : <span className="text-amber">twin not yet initialised from its history — state is the documented baseline</span>}</span>
              <span>key state <span className="num">{fmtState(key, comp.state[key])}</span></span>
              <Link to={`/components/${cid}`} className="text-accent">digital twin →</Link>
              <Link to={`/components/${cid}?tab=history`} className="text-accent">historical profile →</Link>
            </div>
          )}
          {comp && twin.data && !twin.data.history_initialised && <button className="btn-secondary" onClick={() => initialise.run()} disabled={initialise.busy}><History size={14} /> {initialise.busy ? 'Replaying history…' : 'Initialise twin from history'}</button>}
        </div>
        <ErrorBox error={initialise.error} />
      </Card>

      <div className="grid xl:grid-cols-2 gap-4">
        <Card title="1 · Next scheduled flight and resolved conditions" subtitle="Priority: scheduled information → comparable historical flights → documented engineering estimate" dense>
          {next.loading && !next.data ? <Spinner /> : !next.data?.flight ? <Callout kind="info">No scheduled flight without a prediction for this aircraft. Enter one on the Flights page.</Callout> : (
            <>
              <div className="text-[12.5px] mb-2"><b className="num">{next.data.flight.id}</b> · {next.data.flight.flight_date} · {next.data.flight.route_or_mission} · scheduled source: {next.data.flight.scheduled.source ?? 'manual'} <Tag kind={next.data.flight.provenance} /></div>
              <table className="table text-[12px]">
                <thead><tr><th>Condition</th><th>Value</th><th>±1σ</th><th>Provenance</th></tr></thead>
                <tbody>
                  {res && Object.entries(res.conditions).map(([k, v]) => (
                    <tr key={k} className={res.provenance[k].startsWith('scheduled') ? '' : 'text-ink-2'}>
                      <td>{CONDITION_LABELS[k] ?? k}</td>
                      <td className="num">{typeof v === 'number' ? fmt.num(v, 4) : v}</td>
                      <td className="num">{res.uncertainty[k] != null ? fmt.num(res.uncertainty[k], 3) : '—'}</td>
                      <td><Tag kind={res.provenance[k].startsWith('scheduled') ? 'input' : res.provenance[k].startsWith('historical') ? 'measured' : res.provenance[k].startsWith('derived') ? 'catalogue' : 'assumption'}>{res.provenance[k].split(' (')[0]}</Tag> <span className="text-[11px] text-ink-3">{res.provenance[k].includes('(') ? '(' + res.provenance[k].split('(').slice(1).join('(') : ''}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {res && <div className="text-[11.5px] text-ink-3 mt-1">Comparable flights used: {res.comparables_used.length ? `${res.comparables_used.join(', ')} (${res.comparable_basis})` : 'none'}. {res.notes.join(' ')}</div>}
              <div className="flex items-center gap-3 mt-3">
                <Field label="Monte Carlo samples" className="w-[150px]"><input className="input" type="number" min={0} max={5000} step={50} value={mc} onChange={(e) => setMc(Math.max(0, Math.min(5000, Number(e.target.value) || 0)))} /></Field>
                <button className="btn-primary mt-4" onClick={() => predict.run()} disabled={predict.busy || !twin.data?.history_initialised} data-testid="predict" title={twin.data?.history_initialised ? '' : 'Initialise the twin from its history first'}><Target size={14} /> {predict.busy ? 'Predicting…' : 'Generate and store pre-flight prediction'}</button>
              </div>
              <ErrorBox error={predict.error} />
            </>
          )}
        </Card>
        <Card title="Stored predictions for this component" subtitle="Immutable records, newest first" dense>
          {list.loading && !list.data ? <Spinner /> : (list.data ?? []).length === 0 ? <div className="text-[12px] text-ink-3">No predictions yet.</div> : (
            <ul className="space-y-1 max-h-[420px] overflow-y-auto">
              {(list.data ?? []).map((p) => (
                <li key={p.id}>
                  <button className={`w-full text-left border rounded px-2 py-1.5 text-[12px] ${pred?.id === p.id ? 'border-accent bg-accent-soft' : 'border-line hover:bg-paper'}`} onClick={() => api.prediction(p.id).then((x) => { setPred(x); setLastPredictionId(x.id) })}>
                    <div className="flex items-center justify-between gap-2"><span className="num font-medium">{p.flight_id} · v{p.model_version}</span><span className={`text-[11px] ${p.status === 'pending' ? 'text-amber' : 'text-green'}`}>{p.status}{p.committed ? ' · in history' : ''}</span></div>
                    <div className="num text-ink-3">{p.id} · {fmt.date(p.prediction_timestamp)} · inputs {p.input_data_version}</div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      {pred && (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-[15px] font-semibold">Prediction {pred.id}</h2>
            <span className="text-[12.5px] text-ink-2">{pred.component_id} · flight {pred.flight_id} ({pred.flight_event_time.slice(0, 10)}) · model v{pred.model_version} · inputs {pred.input_data_version} · made {fmt.date(pred.prediction_timestamp)} <Tag kind="simulation">pre-flight prediction</Tag></span>
            <span className="ml-auto flex gap-2"><Link to={`/live/${pred.component_id}?flight=${pred.flight_id}`} className="btn-primary"><Radio size={13} /> Watch this forecast in the live twin</Link><Link to="/reconciliation" className="btn-secondary">Reconcile after the flight →</Link></span>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
            <Stat label={`Predicted ${stateLabel(key).label} after flight`} value={fmtState(key, pred.predicted.state_after[key])} hint={`from ${fmtState(key, pred.state_before[key])} (Δ ${fmtState(key, pred.predicted.increments[key] ?? 0)})`} />
            <Stat label="Expected peak stress / temperature" value={pred.predicted.max_stress_mpa ? `${fmt.fixed(pred.predicted.max_stress_mpa, 0)} MPa` : `${pred.predicted.pressure_cycles} p-cycles`} hint={fmt.k2c(pred.predicted.peak_temperature_k)} />
            <Stat label="Remaining margin" value={fmt.pct(pred.predicted.remaining_margin, 1)} hint="worst mechanism after this flight" />
            <Stat label="Governing RUL after flight" value={pred.predicted.remaining_life.governing_remaining_flights != null ? fmt.int(pred.predicted.remaining_life.governing_remaining_flights) : '—'} unit="flights (ref. mission)" hint={pred.predicted.remaining_life.governing_mechanism?.replace(/_/g, ' ') ?? ''} />
            <Stat label="Threshold-crossing fraction" value={pred.threshold_crossing_fraction != null ? fmt.pct(pred.threshold_crossing_fraction, 1) : '—'} hint={pred.uncertainty ? `${pred.uncertainty.n_samples} MC samples · model-derived, not calibrated` : 'MC disabled'} tone={pred.threshold_crossing_fraction != null && pred.threshold_crossing_fraction > 0.05 ? 'warn' : 'default'} />
          </div>
          <div className="grid xl:grid-cols-3 gap-4">
            <Card title="Conditions used and their provenance" dense>
              <table className="table text-[12px]">
                <thead><tr><th>Condition</th><th>Value</th><th>Provenance</th></tr></thead>
                <tbody>{Object.entries(pred.conditions).map(([k, v]) => <tr key={k}><td>{CONDITION_LABELS[k] ?? k}</td><td className="num">{typeof v === 'number' ? fmt.num(v, 4) : v}</td><td className="text-ink-2">{pred.condition_provenance[k]}</td></tr>)}</tbody>
              </table>
              <ul className="list-disc pl-4 text-[11.5px] text-ink-2 mt-2">{pred.assumptions.map((a, i) => <li key={i}>{a}</li>)}</ul>
            </Card>
            <Card title="Predicted operational response and damage" subtitle="Separate outputs: loads/response · physical damage · threshold status" dense>
              <div className="label mb-1">Predicted state after flight</div>
              <KV rows={Object.entries(pred.predicted.state_after).map(([k, v]) => ({ k: stateLabel(k).label, v: fmtState(k, v) }))} />
              <div className="label mt-3 mb-1">Threshold</div>
              <div className="flex items-center gap-2 text-[12px]"><StatusPill status={pred.predicted.threshold_status} /><span className="text-ink-2">{pred.predicted.threshold_detail}</span></div>
              <div className="label mt-3 mb-1">Model parameters snapshot</div>
              <KV rows={Object.entries(pred.response_params).map(([k, v]) => ({ k: RESPONSE_LABELS[k] ?? k, v: v.toFixed(4) }))} />
            </Card>
            <Card dense>{pred.predicted.stress_bins?.length ? <StressSpectrumChart bins={pred.predicted.stress_bins} /> : <div className="text-[12px] text-ink-3 p-4">Pressure-cycle model: {pred.predicted.pressure_cycles} cycles at {fmt.num(pred.predicted.outputs.mean_pressure_mpa as number, 3)} MPa mean pressure.</div>}</Card>
          </div>
          {pred.uncertainty && (
            <div className="grid xl:grid-cols-2 gap-4">
              <Card title="Uncertainty" subtitle={pred.uncertainty.method} dense>
                <KV rows={[
                  { k: 'P5 / P50 / P95 after flight', v: `${fmtState(key, pred.uncertainty.key_percentiles.p5.at(-1))} / ${fmtState(key, pred.uncertainty.key_percentiles.p50.at(-1))} / ${fmtState(key, pred.uncertainty.key_percentiles.p95.at(-1))}` },
                  { k: 'Parameter uncertainty', v: pred.uncertainty.uncertainty_classes.parameter.join(', ') || '—' },
                  { k: 'Measurement uncertainty', v: pred.uncertainty.uncertainty_classes.measurement.join(', ') || '—' },
                  { k: 'Operational variability', v: pred.uncertainty.uncertainty_classes.operational.join(', ') || '—' },
                  { k: 'Model-form uncertainty', v: pred.uncertainty.uncertainty_classes.model_form.join(', ') || '—' },
                ]} />
                <div className="mt-2"><Callout kind="warning">{pred.uncertainty.calibration_status}</Callout></div>
              </Card>
              <Card dense><SensitivityChart sens={pred.uncertainty.sensitivity_spearman} /></Card>
            </div>
          )}
          {pred.as_flown && (
            <Card title="After the flight — as-flown estimate incorporated into the twin" dense>
              <KV rows={Object.entries(pred.as_flown.increments).map(([k, v]) => ({ k: `Δ ${stateLabel(k).label} (as-flown)`, v: fmtState(k, v) }))} />
              {pred.reconciliation_id && <div className="text-[12px] mt-2">Reconciliation: <Link className="text-accent" to="/reconciliation">{pred.reconciliation_id}</Link> <DecisionPill decision="accept" /></div>}
            </Card>
          )}
        </>
      )}
    </div>
  )
}
