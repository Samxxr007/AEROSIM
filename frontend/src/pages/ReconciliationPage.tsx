import { Check, GitCompare, History, PlaneLanding, Upload } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api/client'
import type { Observation, PredictionSummary, Reconciliation } from '../api/types'
import { OverlayChart, ResidualChart } from '../components/charts'
import { Callout, Card, DecisionPill, ErrorBox, Field, KV, PageHeader, Spinner, Stat, Tag } from '../components/ui'
import { useAppStore } from '../store/useAppStore'
import { CHANNEL_LABELS, CONDITION_LABELS, DECISION_LABELS, fmt, RESPONSE_LABELS } from '../utils/format'
import { useAction, useApi } from '../utils/useApi'

export default function ReconciliationPage() {
  const { selectedComponentId, setSelectedComponentId, lastReconciliationId, setLastReconciliationId, pushToast, refreshKey, bump } = useAppStore()
  const comps = useApi(() => api.components({ modelled: true }), [refreshKey])
  const comp = comps.data?.find((c) => c.id === selectedComponentId) ?? comps.data?.[0]
  const cid = comp?.id ?? ''
  const preds = useApi(() => api.predictions({ component_id: cid }), [cid, refreshKey], !!cid)
  const flights = useApi(() => api.flights({ aircraft_id: comp?.aircraft_id }), [comp?.aircraft_id, refreshKey], !!comp?.aircraft_id)
  const recs = useApi(() => api.reconciliations(cid), [cid, refreshKey], !!cid)
  const obs = useApi(() => api.observations({ component_id: cid }), [cid, refreshKey], !!cid)
  const [predId, setPredId] = useState('')
  const [obsId, setObsId] = useState('')
  const [anomaly, setAnomaly] = useState('none')
  const [rec, setRec] = useState<Reconciliation | null>(null)
  const [channel, setChannel] = useState('')
  const [manual, setManual] = useState<Record<string, string>>({})
  const [file, setFile] = useState<File | null>(null)

  const selPred: PredictionSummary | undefined = preds.data?.find((p) => p.id === predId) ?? preds.data?.find((p) => p.status === 'pending') ?? preds.data?.[0]
  useEffect(() => {
    if (selPred && selPred.id !== predId) setPredId(selPred.id)
  }, [selPred, predId])
  const flight = flights.data?.find((f) => f.id === selPred?.flight_id)
  const flightObs = (obs.data ?? []).filter((o: Observation) => o.flight_id === selPred?.flight_id)
  useEffect(() => {
    if (lastReconciliationId && !rec) api.reconciliation(lastReconciliationId).then(setRec).catch(() => setLastReconciliationId(null))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastReconciliationId])
  useEffect(() => {
    if (!rec && !lastReconciliationId && recs.data?.length) api.reconciliation(recs.data[0].id).then((x) => { setRec(x); setLastReconciliationId(x.id) }).catch(() => undefined)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recs.data])
  useEffect(() => {
    if (rec && !rec.channels[channel]) setChannel(Object.keys(rec.channels)[0])
  }, [rec, channel])

  const complete = useAction(async () => {
    if (!flight) throw new Error('Select a prediction first.')
    const r = await api.completeFlight(flight.id, anomaly)
    bump()
    pushToast('success', `${flight.id} flown (synthetic); ${r.observation_ids.length} observations recorded${anomaly !== 'none' ? ` with injected anomaly "${anomaly}"` : ''}.`)
  })
  const upload = useAction(async () => {
    if (!file) throw new Error('Choose a CSV file.')
    const r = await api.importCsv('flight_observations', file)
    if (!r.ok) throw new Error(r.problems.join(' '))
    bump()
    pushToast('success', `${r.imported?.length ?? 0} observation record(s) imported from ${file.name}.`)
  })
  const enterManual = useAction(async () => {
    if (!flight) throw new Error('Select a prediction first.')
    const means: Record<string, number> = {}
    for (const [k, v] of Object.entries(manual)) {
      if (v.trim() === '') continue
      const n = Number(v)
      if (!Number.isFinite(n)) throw new Error(`${CHANNEL_LABELS[k] ?? k}: observed mean must be numeric.`)
      means[k] = n
    }
    if (!Object.keys(means).length) throw new Error('Enter at least one observed channel mean.')
    const o = await api.manualObservation({ component_id: cid, flight_id: flight.id, channel_means: means, note: 'manual test observation' })
    bump()
    setObsId(o.id)
    pushToast('success', 'Manual observation stored (provenance: manual).')
  })
  const reconcile = useAction(async () => {
    if (!selPred) throw new Error('Select a prediction.')
    const r = await api.reconcile({ prediction_id: selPred.id, flight_record_id: obsId || null })
    setRec(r)
    setLastReconciliationId(r.id)
    bump()
    pushToast(r.gate.decision === 'reject' ? 'warning' : 'success', `Reconciliation ${r.id}: ${DECISION_LABELS[r.gate.decision]}.`)
  })
  const apply = useAction(async (override?: string) => {
    if (!rec) return
    const r = await api.applyReconciliation(rec.id, override ?? null)
    setRec(r.reconciliation)
    bump()
    pushToast(r.update.applied ? 'success' : 'warning', r.update.summary)
  })
  const commit = useAction(async () => {
    if (!rec) return
    await api.commitPrediction(rec.prediction_id)
    bump()
    pushToast('success', `Flight ${rec.flight_id} incorporated into the component's operating history (as-flown model estimate).`)
  })
  const committed = preds.data?.find((p) => p.id === rec?.prediction_id)?.committed
  const channelsPredicted = ['load_kN', 'strain_microstrain', 'temperature_c', 'pressure_bar', 'vibration_g']
  return (
    <div className="space-y-4">
      <PageHeader title="Prediction reconciliation" lede="The stored pre-flight prediction for a flight is compared with the actual post-flight observation of the same component and flight ID. Forecast error is split into schedule deviation and response-model error; reliable residuals may correct only the operational response model (Stage A). A sensor discrepancy is never treated as structural damage." />
      <div className="grid xl:grid-cols-3 gap-4">
        <Card title="1 · Stored prediction" dense>
          <Field label="Component instance" className="mb-2">
            <select className="input" value={cid} onChange={(e) => { setSelectedComponentId(e.target.value); setRec(null); setPredId(''); setObsId('') }}>
              {(comps.data ?? []).map((c) => <option key={c.id} value={c.id}>{c.id} — {c.name}</option>)}
            </select>
          </Field>
          <Field label="Pre-flight prediction">
            <select className="input" value={selPred?.id ?? ''} onChange={(e) => { setPredId(e.target.value); setObsId('') }}>
              {(preds.data ?? []).map((p) => <option key={p.id} value={p.id}>{p.flight_id} · v{p.model_version} · {p.status}{p.committed ? ' · in history' : ''}</option>)}
            </select>
            {(preds.data ?? []).length === 0 && <div className="text-[11.5px] text-amber mt-1">No prediction yet — <Link to="/predictions" className="underline">generate one first</Link>.</div>}
          </Field>
          {flight && (
            <div className="text-[12px] mt-2 space-y-0.5">
              <div>Flight <span className="num">{flight.id}</span> · {flight.flight_date} · {flight.route_or_mission}</div>
              <div>Status: {flight.status === 'completed' ? <span className="text-green">completed ({flight.completion_source ?? flight.actual?.source})</span> : <span className="text-amber">scheduled — not yet flown</span>}</div>
              <div>Observations of {cid} for this flight: <span className="num">{flightObs.length}</span></div>
            </div>
          )}
        </Card>
        <Card title="2 · Actual post-flight data" dense>
          <div className="space-y-3">
            <div>
              <div className="label mb-1">A — Complete the flight (synthetic reference aircraft)</div>
              <div className="flex gap-2">
                <select className="input" value={anomaly} onChange={(e) => setAnomaly(e.target.value)} aria-label="Data-quality anomaly" disabled={flight?.status === 'completed'}>
                  <option value="none">Clean observations</option>
                  <option value="dropout">Inject data-link dropout (45 % missing)</option>
                  <option value="outliers">Inject outliers (20 % corrupted)</option>
                  <option value="sensor_bias">Inject +60 % sensor scale fault</option>
                  <option value="wrong_component">Observation from wrong installation</option>
                </select>
                <button className="btn-primary shrink-0" onClick={() => complete.run()} disabled={complete.busy || !flight || flight.status === 'completed'} data-testid="complete-flight"><PlaneLanding size={14} /> Fly</button>
              </div>
              <div className="text-[11px] text-ink-3 mt-1">Generates actual conditions and SYNTHETIC ACTUAL-FLIGHT OBSERVATIONS for every modelled component on the aircraft.</div>
              <ErrorBox error={complete.error} />
            </div>
            <div>
              <div className="label mb-1">B — Upload flight-data CSV</div>
              <div className="flex gap-2 items-center">
                <input type="file" accept=".csv" className="text-[12px]" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
                <button className="btn-secondary shrink-0" onClick={() => upload.run()} disabled={upload.busy || !file}><Upload size={14} /> Import</button>
              </div>
              <div className="text-[11px] text-ink-3 mt-1">Template: <a className="text-accent underline" href={api.templateUrl('flight_observations')}>flight_observations.csv</a> (keyed by flight_id; the flight must be completed via flight_actuals.csv first).</div>
              <ErrorBox error={upload.error} />
            </div>
            <div>
              <div className="label mb-1">C — Manual observation (testing)</div>
              <div className="grid grid-cols-2 gap-2">
                {channelsPredicted.map((ch) => <input key={ch} className="input" placeholder={`${CHANNEL_LABELS[ch] ?? ch} mean`} value={manual[ch] ?? ''} onChange={(e) => setManual({ ...manual, [ch]: e.target.value })} />)}
              </div>
              <button className="btn-secondary mt-2" onClick={() => enterManual.run()} disabled={enterManual.busy || !flight || flight.status !== 'completed'}>Store manual observation</button>
              <ErrorBox error={enterManual.error} />
            </div>
          </div>
        </Card>
        <Card title="3 · Reconcile" dense>
          <Field label="Observation record" hint="default: the latest observation of this component for the predicted flight" className="mb-2">
            <select className="input" value={obsId} onChange={(e) => setObsId(e.target.value)}>
              <option value="">— latest for this flight —</option>
              {flightObs.map((o) => <option key={o.id} value={o.id}>{o.id} · {o.provenance}{o.anomaly !== 'none' ? ` · ${o.anomaly}` : ''}</option>)}
            </select>
          </Field>
          <button className="btn-primary" onClick={() => reconcile.run()} disabled={reconcile.busy || !selPred || flight?.status !== 'completed'} data-testid="reconcile"><GitCompare size={14} /> {reconcile.busy ? 'Comparing…' : 'Compare prediction vs actual'}</button>
          <ErrorBox error={reconcile.error} />
          <div className="mt-3">
            <div className="label mb-1">Previous reconciliations</div>
            {recs.loading && !recs.data ? <Spinner /> : (
              <ul className="space-y-1 max-h-[200px] overflow-y-auto">
                {(recs.data ?? []).map((r) => (
                  <li key={r.id}>
                    <button className={`w-full text-left border rounded px-2 py-1 text-[12px] ${rec?.id === r.id ? 'border-accent bg-accent-soft' : 'border-line hover:bg-paper'}`} onClick={() => api.reconciliation(r.id).then((x) => { setRec(x); setLastReconciliationId(x.id) })}>
                      <div className="flex items-center gap-2"><DecisionPill decision={r.final_decision ?? r.gate.decision} /><span className="num text-ink-3">{r.flight_id} · v{r.model_version} · {fmt.pct(r.summary.mean_relative_error)}</span>{r.applied && <Check size={12} className="text-green" />}</div>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Card>
      </div>

      {rec && (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-[15px] font-semibold">Reconciliation {rec.id}</h2>
            <span className="text-[12.5px] text-ink-2">{rec.component_id} · flight {rec.flight_id} · prediction {rec.prediction_id} (v{rec.prediction_model_version}) · <Tag kind={rec.observation_provenance} /> {rec.observation_anomaly !== 'none' && <Tag kind="assumption">anomaly: {rec.observation_anomaly}</Tag>}</span>
          </div>
          <Callout kind="warning" title={rec.observation_label}>{rec.note}</Callout>
          <div className="grid grid-cols-2 md:grid-cols-6 gap-2">
            <Stat label="Forecast error" value={fmt.pct(rec.summary.forecast_mean_relative_error)} hint="pre-flight prediction vs actual (incl. schedule deviation)" />
            <Stat label="Response-model error" value={fmt.pct(rec.summary.mean_relative_error)} hint="as-flown re-prediction vs actual" />
            <Stat label="Usable channels" value={`${rec.summary.channels_usable} / ${rec.summary.channels_total}`} hint={`worst: ${CHANNEL_LABELS[rec.summary.worst_channel] ?? rec.summary.worst_channel}`} />
            <Stat label="Max missing fraction" value={fmt.pct(rec.gate.max_missing_fraction)} tone={rec.gate.max_missing_fraction > 0.1 ? 'warn' : 'default'} />
            <Stat label="Max outlier fraction" value={fmt.pct(rec.gate.max_outlier_fraction)} tone={rec.gate.max_outlier_fraction > 0.05 ? 'warn' : 'default'} />
            <Stat label="Gate decision" value={<DecisionPill decision={rec.final_decision ?? rec.gate.decision} />} hint={rec.applied ? 'update applied' : rec.applied_update_id ? 'recorded, not applied' : 'pending'} />
          </div>
          <Card title="Why does the prediction differ?" dense>
            <ul className="list-disc pl-4 text-[12.5px] space-y-0.5">{(rec.explanation ?? []).map((e, i) => <li key={i}>{e}</li>)}</ul>
            {rec.condition_deviation && Object.keys(rec.condition_deviation).length > 0 && (
              <table className="table mt-2 text-[12px]"><thead><tr><th>Condition</th><th>Planned / estimated</th><th>Actual (as flown)</th><th>Provenance of planned value</th></tr></thead>
                <tbody>{Object.entries(rec.condition_deviation).map(([k, v]) => <tr key={k}><td>{CONDITION_LABELS[k] ?? k}</td><td className="num">{String(v.planned)}</td><td className="num">{String(v.actual)}</td><td className="text-ink-3">{rec.forecast?.condition_provenance?.[k]}</td></tr>)}</tbody></table>
            )}
          </Card>
          <div className="grid xl:grid-cols-3 gap-4">
            <Card title="Predicted vs actual (as-flown conditions)" subtitle="Same physical quantity, unit and time base; actual interpolated onto the predicted 30 s grid" className="xl:col-span-2" actions={<select className="input w-[200px]" value={channel} onChange={(e) => setChannel(e.target.value)}>{Object.keys(rec.channels).map((c) => <option key={c} value={c}>{CHANNEL_LABELS[c] ?? c}</option>)}</select>}>
              {channel && rec.channels[channel]?.predicted ? <div className="space-y-3"><OverlayChart rec={rec} channel={channel} /><ResidualChart rec={rec} channel={channel} /></div> : <div className="text-[12px] text-ink-3">No overlapping observation for this channel.</div>}
            </Card>
            <Card title="Residuals and measurement reliability" dense>
              <div className="overflow-x-auto"><table className="table whitespace-nowrap text-[12px]">
                <thead><tr><th>Channel</th><th>Forecast err</th><th>Response err</th><th>Bias</th><th>RMSE</th><th>Missing</th><th>Outliers</th><th>SNR</th><th>Reliab.</th></tr></thead>
                <tbody>
                  {Object.entries(rec.channels).map(([k, c]) => (
                    <tr key={k} className={c.usable ? '' : 'text-ink-3'}>
                      <td>{CHANNEL_LABELS[k] ?? k} <span className="text-[10px]">{c.unit}</span></td>
                      <td className="num">{fmt.pct(rec.forecast?.channels[k]?.relative_error)}</td>
                      <td className="num">{fmt.pct(c.relative_error)}</td>
                      <td className="num">{fmt.num(c.mean_bias, 3)}</td>
                      <td className="num">{fmt.num(c.rmse, 3)}</td>
                      <td className="num">{fmt.pct(c.missing_fraction, 0)}</td>
                      <td className="num">{fmt.pct(c.outlier_fraction, 1)}</td>
                      <td className="num">{c.snr != null ? c.snr.toFixed(1) : '—'}</td>
                      <td className="num">{c.reliability != null ? c.reliability.toFixed(2) : '—'}{!c.usable && ' ✕'}</td>
                    </tr>
                  ))}
                </tbody>
              </table></div>
              <div className="text-[11px] text-ink-3 mt-1">Reliability = 1 − 1.5·missing − 4·outliers − 0.3·[SNR&lt;2], clipped to [0, 1]; channels below 0.4 are excluded. Outliers: MAD-robust |z| &gt; 3.5.</div>
            </Card>
          </div>
          <div className="grid xl:grid-cols-2 gap-4">
            <Card title="Proposed operational-model correction (Stage A)" subtitle="Recursive least squares on the as-flown baseline regressor — response parameters only" dense>
              {Object.keys(rec.proposals).length === 0 ? <div className="text-[12px] text-ink-3">No usable channel produced a parameter estimate.</div> : (
                <table className="table"><thead><tr><th>Response parameter</th><th>Current</th><th>RLS estimate</th><th>Change</th><th>From channels</th></tr></thead>
                  <tbody>{Object.entries(rec.proposals).map(([p, v]) => <tr key={p}><td>{RESPONSE_LABELS[p] ?? p}</td><td className="num">{v.before.toFixed(4)}</td><td className="num">{v.proposed.toFixed(4)}</td><td className={`num ${Math.abs(v.relative_change) > 0.4 ? 'text-red' : ''}`}>{v.relative_change >= 0 ? '+' : ''}{fmt.pct(v.relative_change)}</td><td className="text-ink-2">{v.channels.map((c) => CHANNEL_LABELS[c] ?? c).join(', ')}</td></tr>)}</tbody></table>
              )}
              <div className="mt-2 text-[12px]"><div className="label mb-1">Per-channel estimates</div><KV rows={Object.entries(rec.channels).filter(([, c]) => c.theta_estimate != null).map(([k, c]) => ({ k: CHANNEL_LABELS[k] ?? k, v: `${c.response_param}: ${c.theta_twin?.toFixed(3)} → ${c.theta_estimate?.toFixed(3)} (SE ${c.theta_standard_error != null ? c.theta_standard_error.toFixed(4) : '—'})` }))} /></div>
            </Card>
            <Card title="Evidence gate (Stage C) → controlled update → history incorporation" dense>
              <div className="flex items-center gap-2 mb-2"><DecisionPill decision={rec.gate.decision} /><span className="text-[12px] text-ink-2">blend {fmt.pct(rec.gate.blend, 0)} of the proposed change</span></div>
              <ul className="text-[12px] list-disc pl-4 space-y-0.5">{rec.gate.reasons.map((r, i) => <li key={i}>{r}</li>)}</ul>
              <div className="mt-3 flex flex-wrap gap-2">
                {!rec.applied_update_id ? (
                  <>
                    <button className="btn-primary" onClick={() => apply.run()} disabled={apply.busy} data-testid="apply-update"><Check size={14} /> Apply gate decision ({DECISION_LABELS[rec.gate.decision]})</button>
                    {rec.gate.decision !== 'reject' && rec.gate.decision !== 'accept' && <button className="btn-secondary" onClick={() => apply.run('accept')} disabled={apply.busy}>Engineer override: accept fully</button>}
                    {rec.gate.decision !== 'reject' && <button className="btn-danger" onClick={() => apply.run('reject')} disabled={apply.busy}>Engineer override: reject</button>}
                  </>
                ) : (
                  <Callout kind={rec.applied ? 'success' : 'warning'}>{rec.applied ? `Update applied (${DECISION_LABELS[rec.final_decision ?? rec.gate.decision]}); subsequent predictions use the corrected response parameters — ` : 'Recorded as not applied — '}<Link to="/model-history" className="underline">model evolution</Link>.</Callout>
                )}
                {rec.applied_update_id && !committed && <button className="btn-secondary" onClick={() => commit.run()} disabled={commit.busy} data-testid="commit"><History size={14} /> Incorporate flight into operating history (as-flown state)</button>}
                {committed && <span className="text-[12px] text-green">Flight incorporated into the component's operating history.</span>}
              </div>
              <ErrorBox error={apply.error ?? commit.error} />
              <div className="mt-3 text-[11.5px] text-ink-3">Stage A changes response parameters only. Crack length, Miner damage, creep strain and wear change only through <Link className="text-accent" to="/inspections">inspection evidence</Link>. When a discrepancy cannot be attributed, uncertainty is inflated and the case is flagged for engineering investigation.</div>
            </Card>
          </div>
        </>
      )}
    </div>
  )
}
