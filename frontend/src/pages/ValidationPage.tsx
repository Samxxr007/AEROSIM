import { RefreshCw } from 'lucide-react'
import { useState } from 'react'
import { api } from '../api/client'
import type { Experiment, PHM2019Report } from '../api/types'
import { SeriesChart } from '../components/charts'
import { Callout, Card, ErrorBox, Field, PageHeader, Spinner, Stat } from '../components/ui'
import { useAppStore } from '../store/useAppStore'
import { fmt, RESPONSE_LABELS, stateLabel } from '../utils/format'
import { useApi } from '../utils/useApi'

const VARIANT_COLORS: Record<string, string> = { A: '#6f8196', B: '#f5b041', C: '#38bdf8', C_sparse: '#a78bfa' }

export default function ValidationPage() {
  const [force, setForce] = useState(false)
  const { selectedComponentId, setSelectedComponentId, refreshKey } = useAppStore()
  const comps = useApi(() => api.components({ modelled: true }), [refreshKey])
  const { data, error, loading, refetch } = useApi(() => api.validation(force, selectedComponentId), [force, selectedComponentId, refreshKey])
  const phm = useApi(() => api.phm2019(), [refreshKey])
  const [open, setOpen] = useState<string | null>(null)
  const exp = data?.experiment
  const scale = exp ? stateLabel(exp.key_metric).scale : 1
  const unit = exp ? stateLabel(exp.key_metric).unit : ''
  return (
    <div className="space-y-4">
      <PageHeader title="Validation" lede="Actual results of the backend test-suite (pytest, run on request) and a chronological, flight-by-flight experiment on the selected component's own completed flights: Model A (static physics), Model B (operationally calibrated), Model C (two-stage with inspection evidence) and C-sparse (only the first inspection), all measured against the hidden reference that generated the observations. Nothing on this page is hard-coded." actions={<><Field label="Component instance"><select className="input w-[300px]" value={selectedComponentId} onChange={(e) => setSelectedComponentId(e.target.value)}>{(comps.data ?? []).map((c) => <option key={c.id} value={c.id}>{c.id}</option>)}</select></Field><button className="btn-secondary mt-4" onClick={() => { setForce(true); refetch() }} disabled={loading}><RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> Re-run tests</button></>} />
      {loading && !data && <Spinner label="Running the test-suite and the chronological experiment…" />}
      <ErrorBox error={error} />
      <PHMBenchmark report={phm.data ?? undefined} loading={phm.loading} error={phm.error} onRefresh={phm.refetch} />
      {data && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
            <Stat label="Tests passed" value={data.tests.totals.passed} tone="good" />
            <Stat label="Failed" value={data.tests.totals.failed} tone={data.tests.totals.failed ? 'bad' : 'default'} />
            <Stat label="Errors" value={data.tests.totals.errors} tone={data.tests.totals.errors ? 'bad' : 'default'} />
            <Stat label="Skipped" value={data.tests.totals.skipped} />
            <Stat label="Suite runtime" value={data.tests.elapsed_s} unit="s" hint={`ran ${data.tests.ran_at} · exit ${data.tests.return_code}`} />
          </div>
          {data.tests.return_code !== 0 && <Callout kind="error" title="Test suite reported failures">{data.tests.stdout_tail.slice(-800)}</Callout>}
          <Card title="Test results by module" subtitle="Click a module to list its test cases" dense>
            <div className="grid md:grid-cols-6 gap-2">
              {data.tests.groups.map((g) => <button key={g.file} onClick={() => setOpen(open === g.file ? null : g.file)} className={`text-left border rounded px-3 py-2 ${open === g.file ? 'border-accent bg-accent-soft' : 'border-line hover:bg-paper'}`}><div className="num text-[12px] font-medium">{g.file}</div><div className={`num text-[18px] ${g.passed === g.total ? 'text-green' : 'text-red'}`}>{g.passed}/{g.total}</div></button>)}
            </div>
            {open && <table className="table mt-3"><thead><tr><th>Test</th><th>Status</th><th>Time</th><th>Message</th></tr></thead><tbody>{data.tests.groups.find((g) => g.file === open)?.cases.map((c) => <tr key={c.name}><td className="num">{c.name}</td><td className={c.status === 'passed' ? 'text-green' : 'text-red'}>{c.status}</td><td className="num">{c.time_s.toFixed(3)} s</td><td className="text-[11.5px] text-ink-2">{c.message}</td></tr>)}</tbody></table>}
          </Card>
          {exp && (
            <>
              <Scoreboard exp={exp} />
              <Card title={`Chronological model comparison — ${exp.component_id} (${exp.n_flights} completed flights)`} subtitle={exp.leakage_control}>
                <table className="table">
                  <thead><tr><th>Variant</th><th>Mean load forecast error</th><th>1st half → 2nd half</th><th>Mean response error (as-flown)</th><th>Mean |{stateLabel(exp.key_metric).label}| error ({unit})</th><th>Final |error| ({unit})</th><th>RUL twin vs reference (flights)</th><th>Gate decisions (acc / red / more / rej)</th><th>Final model</th></tr></thead>
                  <tbody>
                    {Object.entries(exp.summary).map(([k, v]) => (
                      <tr key={k} className={k === 'C' ? 'font-medium' : ''}>
                        <td><span className="inline-block w-2 h-2 rounded-full mr-1" style={{ background: VARIANT_COLORS[k] }} />{k} — {v.label}</td>
                        <td className="num">{fmt.pct(v.mean_forecast_rel_error)}</td>
                        <td className="num">{fmt.pct(v.forecast_error_first_half)} → {fmt.pct(v.forecast_error_second_half)}</td>
                        <td className="num">{fmt.pct(v.mean_as_flown_rel_error)}</td>
                        <td className="num">{v.mean_abs_state_error == null ? '—' : fmt.num(v.mean_abs_state_error * scale, 3)}</td>
                        <td className="num">{v.final_abs_state_error == null ? '—' : fmt.num(v.final_abs_state_error * scale, 3)}</td>
                        <td className="num">{v.twin_rul_flights != null ? fmt.int(v.twin_rul_flights) : '—'} vs {v.truth_rul_flights != null ? fmt.int(v.truth_rul_flights) : '—'}{v.rul_error_flights != null ? ` (${v.rul_error_flights >= 0 ? '+' : ''}${fmt.int(v.rul_error_flights)})` : ''}</td>
                        <td className="num">{v.gate_decisions.accept} / {v.gate_decisions.accept_reduced_confidence} / {v.gate_decisions.request_more_evidence} / {v.gate_decisions.reject}</td>
                        <td className="num">v{v.final_model_version} · k_L {v.final_response_params.load_transfer_factor.toFixed(3)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div className="flex flex-wrap gap-3 mt-2 text-[12.5px]">
                  <span className={exp.conclusions.operational_calibration_reduced_forecast_error ? 'text-green' : 'text-red'}>B vs A: operational calibration {exp.conclusions.operational_calibration_reduced_forecast_error ? 'reduced' : 'did not reduce'} the load forecast error</span>
                  <span className={exp.conclusions.two_stage_reduced_state_error ? 'text-green' : 'text-red'}>C vs A: two-stage updating {exp.conclusions.two_stage_reduced_state_error ? 'reduced' : 'did not reduce'} the damage-state error</span>
                  <span className="text-ink-3">{exp.conclusions.note}</span>
                </div>
                <div className="grid xl:grid-cols-2 gap-3 mt-3">
                  <SeriesChart data={exp.variants.A.flights.map((f, i) => ({ flight: f.flight_id.replace('AC001-', ''), reference: (f.truth_state ?? 0) * scale, A: (exp.variants.A.flights[i].twin_state ?? 0) * scale, B: (exp.variants.B.flights[i]?.twin_state ?? 0) * scale, C: (exp.variants.C.flights[i]?.twin_state ?? 0) * scale, C_sparse: (exp.variants.C_sparse.flights[i]?.twin_state ?? 0) * scale }))} xKey="flight" series={[{ key: 'reference', name: 'Hidden reference', color: '#3ddc97', dashed: true }, { key: 'A', name: 'A static', color: VARIANT_COLORS.A }, { key: 'B', name: 'B calibrated', color: VARIANT_COLORS.B }, { key: 'C', name: 'C two-stage', color: VARIANT_COLORS.C }, { key: 'C_sparse', name: 'C sparse inspections', color: VARIANT_COLORS.C_sparse }]} title={`${stateLabel(exp.key_metric).label} after each flight (${unit})`} unitNote={unit} />
                  <SeriesChart data={exp.variants.A.flights.map((f, i) => ({ flight: f.flight_id.replace('AC001-', ''), A: (exp.variants.A.flights[i].forecast_rel_error ?? 0) * 100, B: (exp.variants.B.flights[i]?.forecast_rel_error ?? 0) * 100, C: (exp.variants.C.flights[i]?.forecast_rel_error ?? 0) * 100 }))} xKey="flight" series={[{ key: 'A', name: 'A static', color: VARIANT_COLORS.A }, { key: 'B', name: 'B calibrated', color: VARIANT_COLORS.B }, { key: 'C', name: 'C two-stage', color: VARIANT_COLORS.C }]} title="Load forecast error per flight (%)" unitNote="pre-flight prediction vs actual" yFormatter={(v) => `${v.toFixed(1)} %`} />
                </div>
                <div className="text-[11.5px] text-ink-3 mt-2">A and B never learn a damage state that only an inspection can reveal (e.g. a crack): sensor data cannot establish structural damage, which is why their state error stays at the hidden crack size. C-sparse shows the effect of fewer inspections. The forecast error includes deviation between planned and actual flight conditions; the response error isolates the model.</div>
              </Card>
            </>
          )}
          <Card title="Hidden reference models (revealed for validation only)" subtitle="The digital twins never read these values; they generate the synthetic histories and observations." dense>
            <div className="grid xl:grid-cols-3 gap-3">
              {data.reference_models.map((r) => (
                <div key={r.component_id} className="border border-line rounded p-2 text-[12px]">
                  <div className="font-medium mb-1">{r.component_id} · {r.flights_generated} synthetic flights generated</div>
                  <table className="table"><thead><tr><th>Quantity</th><th>Reference</th><th>Twin</th></tr></thead>
                    <tbody>
                      {Object.entries(r.true_response_params).map(([k, v]) => <tr key={k}><td>{RESPONSE_LABELS[k] ?? k}</td><td className="num">{v.toFixed(3)}</td><td className="num">{r.twin_response_params[k]?.toFixed(3)}</td></tr>)}
                      {Object.entries(r.true_param_overrides).map(([k, v]) => <tr key={k}><td>{k}</td><td className="num">{fmt.num(v, 4)}</td><td className="num">{fmt.num(r.twin_params[k], 4)}</td></tr>)}
                      {Object.entries(r.true_state).filter(([k]) => !['flights', 'cumulative_cycles', 'landings', 'hot_hours', 'operating_hours'].includes(k)).map(([k, v]) => <tr key={k}><td>{stateLabel(k).label}</td><td className="num">{fmt.num(v, 5)}</td><td className="num">{fmt.num(r.twin_state[k], 5)}</td></tr>)}
                    </tbody></table>
                  <div className="text-ink-3 mt-1">Sensor noise σ: {Object.entries(r.sensor_noise).map(([k, v]) => `${k} ${v}`).join(' · ')}{Object.keys(r.sensor_bias).length ? ` · bias: ${Object.entries(r.sensor_bias).map(([k, v]) => `${k} ${v}`).join(', ')}` : ''}</div>
                </div>
              ))}
            </div>
          </Card>
          <Callout kind="warning">Monte Carlo intervals shown elsewhere are sample percentiles under stated input distributions; no coverage calibration has been performed. Test results verify mathematical implementation and workflow logic on synthetic ground truth, not real-world predictive accuracy.</Callout>
        </>
      )}
    </div>
  )
}


function PHMBenchmark({ report, loading, error, onRefresh }: {
  report?: PHM2019Report
  loading: boolean
  error?: unknown
  onRefresh: () => void
}) {
  const metric = (value: number | null | undefined) => value == null ? '—' : fmt.num(value, 3)
  return (
    <Card title="External experimental benchmark — PHM 2019 aluminum lap joint"
      subtitle="Independent crack-growth validation using optical measurements; never mixed with synthetic aircraft flights."
      actions={<button className="btn-secondary" onClick={onRefresh} disabled={loading}><RefreshCw size={13} className={loading ? 'animate-spin' : ''} /> Refresh dataset</button>}>
      {loading && !report && <Spinner label="Checking the local PHM dataset folder…" />}
      {Boolean(error) && <ErrorBox error={error} />}
      {report?.status === 'not_ready' && (
        <Callout kind="warning" title="Dataset files not detected">
          <div className="space-y-2">
            <p>Download the raw PHM 2019 archive and extract it under <span className="num">data/external/phm2019/raw/</span>. AeroSim reads the optical crack-length tables from the T1–T6 specimen description workbooks.</p>
            <p><a className="text-accent underline" href={report.download_url} target="_blank" rel="noreferrer">Download the PHM archive from the PHM Society mirror</a> · <a className="text-accent underline" href={report.source_url} target="_blank" rel="noreferrer">NASA dataset record</a></p>
            <ul className="list-disc pl-5">{report.instructions?.map((line) => <li key={line}>{line}</li>)}</ul>
            <p className="text-[11px] text-ink-3">Expected local folder: {report.data_directory}</p>
          </div>
        </Callout>
      )}
      {report?.status === 'invalid' && <Callout kind="error" title="PHM dataset validation failed">{report.error}</Callout>}
      {report?.status === 'ready' && report.rolling_origin && report.signal_features && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            <Stat label="Optical labels loaded" value={report.labels_loaded ?? 0} />
            <Stat label="Training specimens" value={report.specimens?.length ?? 0} />
            <Stat label="Rolling-origin scored points" value={report.rolling_origin.summary.scored_points} />
            <Stat label="Signal files detected" value={report.signal_features.files_found} />
          </div>
          <div className="text-[11.5px] text-ink-2 mt-2">{report.provenance_note}</div>
          <div className="text-[11.5px] text-ink-3 mt-1">{report.method_note}</div>
          <div className="overflow-x-auto mt-3">
            <table className="table text-[12px]">
              <thead><tr><th>Specimen</th><th>Labelled points</th><th>Scored points</th><th>Last-value MAE (mm)</th><th>Linear-trend MAE (mm)</th><th>Last-value RMSE (mm)</th><th>Linear-trend RMSE (mm)</th></tr></thead>
              <tbody>{report.rolling_origin.by_specimen.map((row) => (
                <tr key={row.specimen}>
                  <td className="num">{row.specimen}</td><td className="num">{row.labelled_points}</td><td className="num">{row.scored_points}</td>
                  <td className="num">{metric(row.last_value_mae_mm)}</td><td className="num">{metric(row.linear_trend_mae_mm)}</td>
                  <td className="num">{metric(row.last_value_rmse_mm)}</td><td className="num">{metric(row.linear_trend_rmse_mm)}</td>
                </tr>
              ))}</tbody>
              <tfoot><tr className="font-medium"><td>Overall</td><td>—</td><td className="num">{report.rolling_origin.summary.scored_points}</td>
                <td className="num">{metric(report.rolling_origin.summary.last_value_mae_mm)}</td><td className="num">{metric(report.rolling_origin.summary.linear_trend_mae_mm)}</td>
                <td className="num">{metric(report.rolling_origin.summary.last_value_rmse_mm)}</td><td className="num">{metric(report.rolling_origin.summary.linear_trend_rmse_mm)}</td></tr></tfoot>
            </table>
          </div>
          <div className="grid md:grid-cols-2 gap-3 mt-3">
            <div className="border border-line rounded p-3">
              <div className="text-[12px] font-medium mb-2">Lamb-wave signal coverage</div>
              <div className="text-[12px] text-ink-2">Parsed files: {report.signal_features.files_found - report.signal_features.files_unparsed} / {report.signal_features.files_found}</div>
              <div className="text-[12px] text-ink-2">Cycles with features: {report.signal_features.cycles_with_signal_features}</div>
              <div className="text-[12px] text-ink-2">Labelled cycles matched to signals: {report.signal_features.labelled_cycles_with_signals}</div>
            </div>
            <div className="border border-line rounded p-3">
              <div className="text-[12px] font-medium mb-2">Signal feature correlation with measured crack length</div>
              {Object.entries(report.signal_features.feature_correlations_with_crack_length).map(([key, value]) => <div key={key} className="flex justify-between gap-2 text-[12px] text-ink-2"><span>{key}</span><span className="num">{value == null ? 'n/a' : fmt.num(value, 3)}</span></div>)}
              <div className="text-[10.5px] text-ink-3 mt-1">{report.signal_features.note}</div>
            </div>
          </div>
          {report.warnings?.length ? <Callout kind="warning" title="Dataset parsing warnings"><ul className="list-disc pl-5">{report.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul></Callout> : null}
          {report.physics_paris_loo?.status === 'ready' && report.physics_paris_loo.summary && (
            <Card title="Independent physics check — Paris crack-growth integrator" subtitle="Leave-one-specimen-out: fit C,m on other training coupons, then forecast the held-out specimen sequentially with AeroSim's integrate_paris implementation." dense>
              <div className="grid grid-cols-3 gap-2 mb-3">
                <Stat label="Held-out forecast points" value={report.physics_paris_loo.summary.scored_points} />
                <Stat label="Crack-length MAE" value={metric(report.physics_paris_loo.summary.mae_mm)} unit="mm" />
                <Stat label="Crack-length RMSE" value={metric(report.physics_paris_loo.summary.rmse_mm)} unit="mm" />
              </div>
              <div className="overflow-x-auto">
                <table className="table text-[12px]">
                  <thead><tr><th>Held-out specimen</th><th>Status</th><th>Scored points</th><th>MAE (mm)</th><th>RMSE (mm)</th><th>Fitted Paris m</th><th>Fitted Paris C</th><th>Training specimens</th></tr></thead>
                  <tbody>{report.physics_paris_loo.by_specimen.map((fold) => (
                    <tr key={fold.specimen}>
                      <td className="num">{fold.specimen}</td><td>{fold.status}</td>
                      <td className="num">{fold.scored_points ?? '—'}</td>
                      <td className="num">{metric(fold.mae_mm)}</td><td className="num">{metric(fold.rmse_mm)}</td>
                      <td className="num">{metric(fold.fitted_parameters?.paris_m as number | undefined)}</td>
                      <td className="num">{metric(fold.fitted_parameters?.paris_C_m_per_cycle_per_MPa_sqrt_m_pow_m as number | undefined)}</td>
                      <td className="num">{Array.isArray(fold.fitted_parameters?.training_specimens) ? (fold.fitted_parameters?.training_specimens as string[]).join(', ') : '—'}</td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
              <div className="text-[11px] text-ink-2 mt-2">{report.physics_paris_loo.method_note}</div>
              <Callout kind="warning">{report.physics_paris_loo.transfer_limit}</Callout>
            </Card>
          )}
          {report.physics_paris_loo?.status === 'not_run' && (
            <Callout kind="warning" title="Paris-law external comparison not run">{report.physics_paris_loo.reason ?? 'Loading profiles or sufficient held-out measurements were not available.'}</Callout>
          )}
          <div className="text-[11px] text-ink-3 mt-2">T7 and T8 are intentionally excluded from scored metrics because the challenge provides no optical crack-length ground truth.</div>
        </>
      )}
    </Card>
  )
}

function Scoreboard({ exp }: { exp: Experiment }) {
  const sc = stateLabel(exp.key_metric).scale
  const unit = stateLabel(exp.key_metric).unit
  const A = exp.summary.A, B = exp.summary.B, C = exp.summary.C
  const ref = C?.truth_rul_flights
  const cells = [
    { label: 'load forecast error', sub: 'A static → B calibrated', a: fmt.pct(A?.mean_forecast_rel_error), c: fmt.pct(B?.mean_forecast_rel_error), good: (B?.mean_forecast_rel_error ?? 1) < (A?.mean_forecast_rel_error ?? 0) },
    { label: `final |${stateLabel(exp.key_metric).label}| error`, sub: 'A static → C two-stage', a: A?.final_abs_state_error != null ? `${fmt.num(A.final_abs_state_error * sc, 3)} ${unit}` : '—', c: C?.final_abs_state_error != null ? `${fmt.num(C.final_abs_state_error * sc, 3)} ${unit}` : '—', good: (C?.final_abs_state_error ?? 1) < (A?.final_abs_state_error ?? 0) },
    { label: 'remaining life vs hidden reference', sub: `reference ${ref != null ? fmt.int(ref) : '—'} flights`, a: A?.twin_rul_flights != null ? fmt.int(A.twin_rul_flights) : '—', c: C?.twin_rul_flights != null ? fmt.int(C.twin_rul_flights) : '—', good: ref != null && C?.twin_rul_flights != null && A?.twin_rul_flights != null && Math.abs(C.twin_rul_flights - ref) < Math.abs(A.twin_rul_flights - ref) },
  ]
  return (
    <div className="grid md:grid-cols-3 gap-3">
      {cells.map((x) => (
        <div key={x.label} className="card px-4 py-3">
          <div className="label">{x.label}</div>
          <div className="flex items-end gap-3 mt-1">
            <div><div className="text-[10px] text-ink-3">static model</div><div className="num text-[20px] text-ink-2 line-through decoration-red/60">{x.a}</div></div>
            <div className="text-ink-3 pb-1">→</div>
            <div><div className="text-[10px] text-ink-3">self-evolving twin</div><div className={`num text-[26px] leading-none ${x.good ? 'text-green' : 'text-amber'}`}>{x.c}</div></div>
          </div>
          <div className="text-[10.5px] text-ink-3 mt-1">{x.sub} · measured chronologically against the hidden reference</div>
        </div>
      ))}
    </div>
  )
}
