import { Play, RotateCcw } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api/client'
import type { DemoResult } from '../api/types'
import { useAppStore } from '../store/useAppStore'
import { fmt, stateLabel } from '../utils/format'
import { Callout, ErrorBox } from './ui'

export function DemoRunner({ initial, compact }: { initial?: DemoResult | null; compact?: boolean }) {
  const [result, setResult] = useState<DemoResult | null>(initial ?? null)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<unknown>(null)
  const [demoId, setDemoId] = useState('engine_mount')
  const [shown, setShown] = useState<number>(initial ? initial.steps.length : 0)
  useEffect(() => {
    if (!result) return
    if (shown >= result.steps.length) return
    const t = setTimeout(() => setShown((n) => n + 1), 220)
    return () => clearTimeout(t)
  }, [result, shown])
  const { pushToast, bump, setSelectedComponentId, setLastPredictionId, setLastReconciliationId } = useAppStore()

  const run = async () => {
    setBusy('run')
    setError(null)
    try {
      const r = await api.runDemo(demoId, true)
      setShown(0)
      setResult(r)
      setSelectedComponentId(r.component_id)
      setLastPredictionId(r.ids.next_prediction_id)
      setLastReconciliationId(r.ids.reconciliation_id)
      bump()
      pushToast('success', `Demo "${r.title}" completed deterministically (seed ${r.seed}).`)
    } catch (e) {
      setError(e)
    } finally {
      setBusy(null)
    }
  }
  const reset = async () => {
    setBusy('reset')
    try {
      await api.resetDemo()
      setResult(null)
      setLastPredictionId(null)
      setLastReconciliationId(null)
      bump()
      pushToast('info', 'Database reset to the seeded fleet and its synthetic history (twins not yet initialised).')
    } catch (e) {
      setError(e)
    } finally {
      setBusy(null)
    }
  }
  const s = result ? result.experiment.summary : null
  const scale = result ? stateLabel(result.key_metric).scale : 1
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <select className="input w-[380px]" value={demoId} onChange={(e) => setDemoId(e.target.value)} aria-label="Demo scenario">
          <option value="engine_mount">Engine Mount Fatigue Assessment — ENG-MOUNT-001</option>
          <option value="hydraulic_actuator">Hydraulic Actuator Seal-Wear Assessment — HYD-ACT-001</option>
        </select>
        <button className="btn-primary" onClick={run} disabled={busy !== null} data-testid="run-demo">
          <Play size={14} /> {busy === 'run' ? 'Running demo sequence…' : 'Run demo sequence'}
        </button>
        <button className="btn-secondary" onClick={reset} disabled={busy !== null} data-testid="reset-demo">
          <RotateCcw size={14} /> Reset demo data
        </button>
        <span className="text-[11.5px] text-ink-3">Resets the fleet, initialises every twin from its own history, then runs the next-flight prediction → actual flight → reconciliation → updates → next prediction loop.</span>
      </div>
      <ErrorBox error={error} />
      {busy === 'run' && <Callout kind="info">Replaying component histories (6 twins × 12 flights), predicting the scheduled flight with Monte Carlo sampling, generating synthetic observations, reconciling and running the chronological A/B/C experiment… (≈ 5 s)</Callout>}
      {result && (
        <div className="space-y-2">
          <Callout kind="warning" title={result.label}>Seed {result.seed}. Observations and inspections are drawn from a hidden reference model; the twin never reads its parameters.</Callout>
          <ol className={`grid gap-1.5 ${compact ? 'grid-cols-1' : 'grid-cols-1 xl:grid-cols-2'}`}>
            {result.steps.slice(0, shown).map((st) => (
              <li key={st.step} className="flex gap-2 border border-line rounded-md px-3 py-2 bg-surface-2 animate-[fadein_.35s_ease]" style={{ borderLeft: `3px solid ${st.step <= 5 ? '#6f8196' : st.step <= 8 ? '#38bdf8' : st.step <= 11 ? '#f5b041' : st.step <= 13 ? '#3ddc97' : '#a78bfa'}` }}>
                <span className="num text-[11px] text-white bg-graphite rounded px-1.5 h-fit mt-0.5">{st.step}</span>
                <div className="min-w-0">
                  <div className="text-[12.5px] font-medium">{st.title}</div>
                  <div className="text-[12px] text-ink-2">{st.detail}</div>
                </div>
              </li>
            ))}
          </ol>
          {s && (
            <div className="card p-3">
              <div className="text-[12.5px] font-medium mb-1">Chronological experiment on the component's own completed flights — error against the hidden reference</div>
              <table className="table">
                <thead><tr><th>Model variant</th><th>Mean load forecast error</th><th>Mean response error (as-flown)</th><th>Mean |{stateLabel(result.key_metric).label}| error ({result.key_unit})</th><th>Final |error|</th><th>RUL vs reference (flights)</th><th>Final model</th></tr></thead>
                <tbody>
                  {Object.entries(s).map(([k, v]) => (
                    <tr key={k} className={k === 'C' ? 'font-medium' : ''}>
                      <td>{k} — {v.label}</td>
                      <td className="num">{fmt.pct(v.mean_forecast_rel_error)}</td>
                      <td className="num">{fmt.pct(v.mean_as_flown_rel_error)}</td>
                      <td className="num">{v.mean_abs_state_error == null ? '—' : fmt.num(v.mean_abs_state_error * scale, 3)}</td>
                      <td className="num">{v.final_abs_state_error == null ? '—' : fmt.num(v.final_abs_state_error * scale, 3)}</td>
                      <td className="num">{v.twin_rul_flights != null ? fmt.int(v.twin_rul_flights) : '—'} vs {v.truth_rul_flights != null ? fmt.int(v.truth_rul_flights) : '—'}</td>
                      <td className="num">v{v.final_model_version}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="flex flex-wrap items-center gap-3 mt-2 text-[12.5px]">
                <span className={result.experiment.conclusions.operational_calibration_reduced_forecast_error ? 'text-green' : 'text-red'}>Operational calibration {result.experiment.conclusions.operational_calibration_reduced_forecast_error ? 'reduced' : 'did not reduce'} load forecast error</span>
                <span className={result.experiment.conclusions.two_stage_reduced_state_error ? 'text-green' : 'text-red'}>Two-stage updating {result.experiment.conclusions.two_stage_reduced_state_error ? 'reduced' : 'did not reduce'} damage-state error</span>
                <span className="text-ink-3">{result.experiment.conclusions.note}</span>
                <span className="text-ink-3">Explore: <Link className="text-accent underline" to="/predictions">predictions</Link> · <Link className="text-accent underline" to="/reconciliation">reconciliation</Link> · <Link className="text-accent underline" to="/model-history">model evolution</Link> · <Link className="text-accent underline" to="/validation">validation</Link></span>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
