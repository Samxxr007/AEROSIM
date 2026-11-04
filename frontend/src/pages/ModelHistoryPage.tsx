import { Activity, ClipboardCheck, GitCompare, History, Radio, Target, Wrench } from 'lucide-react'
import { useMemo } from 'react'
import { api } from '../api/client'
import { SeriesChart } from '../components/charts'
import { Callout, Card, DecisionPill, ErrorBox, Field, PageHeader, Spinner, Tag } from '../components/ui'
import { useAppStore } from '../store/useAppStore'
import { fmt, RESPONSE_LABELS, stateLabel } from '../utils/format'
import { useApi } from '../utils/useApi'

const ICON = { simulation: Activity, observation: Radio, reconciliation: GitCompare, inspection: ClipboardCheck, model_update: History, prediction: Target, maintenance: Wrench }

export default function ModelHistoryPage() {
  const { selectedComponentId, setSelectedComponentId, refreshKey } = useAppStore()
  const comps = useApi(() => api.components({ modelled: true }), [refreshKey])
  const { data, error, loading } = useApi(() => api.modelHistory(selectedComponentId), [selectedComponentId, refreshKey])
  const comp = comps.data?.find((c) => c.id === selectedComponentId)
  const paramSeries = useMemo(() => {
    if (!data) return []
    const applied = [...data.updates].filter((u) => u.applied).sort((a, b) => a.version_after - b.version_after)
    const rows: Record<string, number | string>[] = [{ version: 'v1', load_transfer_factor: 1, thermal_response_factor: 1, vibration_response_factor: 1, pressure_response_factor: 1 }]
    let cur: Record<string, number> = { load_transfer_factor: 1, thermal_response_factor: 1, vibration_response_factor: 1, pressure_response_factor: 1 }
    for (const u of applied) {
      cur = { ...cur }
      for (const [k, c] of Object.entries(u.changes)) if (k in cur) cur[k] = c.after
      rows.push({ version: `v${u.version_after}`, ...cur })
    }
    return rows
  }, [data])
  const errSeries = useMemo(() => (data ? [...data.reconciliations].sort((a, b) => ((a as { seq?: number }).seq ?? 0) - ((b as { seq?: number }).seq ?? 0)).map((r) => ({ label: `${(r.flight_id ?? '').replace('AC001-', '')} v${r.model_version}`, response: r.summary.mean_relative_error * 100, forecast: (r.summary.forecast_mean_relative_error ?? r.summary.mean_relative_error) * 100, decision: r.gate.decision })) : []), [data])
  return (
    <div className="space-y-4">
      <PageHeader title="Model evolution history" lede="How this component's digital twin changed over successive flights: every prediction, observation, reconciliation, inspection, maintenance event and update decision — applied or not — in chronological order, with prediction error across flights and response parameters by version." actions={<Field label="Component instance"><select className="input w-[340px]" value={selectedComponentId} onChange={(e) => setSelectedComponentId(e.target.value)}>{(comps.data ?? []).map((c) => <option key={c.id} value={c.id}>{c.id} — {c.name}</option>)}</select></Field>} />
      {loading && !data && <Spinner />}
      <ErrorBox error={error} />
      {data && (
        <>
          <div className="grid xl:grid-cols-2 gap-4">
            <Card dense>{errSeries.length ? <SeriesChart data={errSeries} xKey="label" series={[{ key: 'forecast', name: 'Forecast error (%)', color: '#7b8794', dashed: true }, { key: 'response', name: 'Response-model error (%)' }]} title="Prediction error across successive flights" unitNote="% · lower is better · not guaranteed to decrease" yFormatter={(v) => `${v.toFixed(1)} %`} /> : <div className="text-[12px] text-ink-3 p-4">No reconciliations yet for this component — initialise the twin from its history.</div>}</Card>
            <Card dense>{paramSeries.length > 1 ? <SeriesChart data={paramSeries} xKey="version" series={Object.keys(RESPONSE_LABELS).map((k) => ({ key: k, name: RESPONSE_LABELS[k] }))} title="Response parameters by model version" unitNote="dimensionless factors" yFormatter={(v) => v.toFixed(3)} /> : <div className="text-[12px] text-ink-3 p-4">No applied Stage-A updates yet — response parameters are at their prior values (1.0).</div>}</Card>
          </div>
          <div className="grid xl:grid-cols-5 gap-4">
            <Card title="Learning timeline" subtitle={`${data.timeline.length} events · chronological`} className="xl:col-span-2" dense>
              {data.timeline.length === 0 ? <div className="text-[12px] text-ink-3">No events yet.</div> : (
                <ol className="relative border-l border-line ml-2 space-y-2 max-h-[700px] overflow-y-auto pr-1">
                  {data.timeline.map((e) => {
                    const Icon = ICON[e.type] ?? History
                    return (
                      <li key={e.id} className="ml-4">
                        <span className={`absolute -left-[9px] mt-1 w-4 h-4 rounded-full border bg-white flex items-center justify-center ${e.type === 'model_update' ? (e.applied ? 'border-green text-green' : 'border-red text-red') : 'border-line-strong text-ink-3'}`}><Icon size={9} /></span>
                        <div className="text-[12.5px] font-medium flex items-center gap-2 flex-wrap">{e.title}{e.version && <span className="num text-[11px] text-ink-3">v{e.version}</span>}{e.decision && <DecisionPill decision={e.decision} />}{e.anomaly && e.anomaly !== 'none' && <Tag kind="assumption">{e.anomaly}</Tag>}</div>
                        <div className="text-[12px] text-ink-2">{e.detail}</div>
                        <div className="num text-[10.5px] text-ink-3">{fmt.date(e.ts)} · {e.id}</div>
                      </li>
                    )
                  })}
                </ol>
              )}
            </Card>
            <Card title="Model updates" subtitle="Accepted and rejected updates with previous → updated parameters and the evidence used" className="xl:col-span-3" dense>
              {data.updates.length === 0 ? <div className="text-[12px] text-ink-3">No updates recorded.</div> : (
                <div className="space-y-2 max-h-[700px] overflow-y-auto pr-1">
                  {data.updates.map((u) => (
                    <div key={u.id} className={`border rounded px-3 py-2 ${u.applied ? 'border-line' : 'border-red/30 bg-red-soft/40'}`}>
                      <div className="flex flex-wrap items-center gap-2 text-[12.5px]"><span className="font-medium">{u.stage === 'A_operational' ? 'Stage A — operational model' : u.stage === 'B_damage_state' ? 'Stage B — damage state' : 'Not applied'}</span><DecisionPill decision={u.decision} /><span className="num text-ink-3">v{u.version_before} → v{u.version_after}</span>{u.flight_id && <span className="num text-ink-3">{u.flight_id}</span>}<span className="num text-ink-3 ml-auto">{fmt.date(u.created_at)}</span></div>
                      <div className="text-[12px] text-ink-2 mt-0.5">{u.summary}</div>
                      {Object.keys(u.changes).length > 0 && (
                        <table className="table mt-1"><thead><tr><th>Quantity</th><th>Previous</th><th>Updated</th><th>Detail</th></tr></thead>
                          <tbody>{Object.entries(u.changes).map(([k, c]) => <tr key={k}><td>{RESPONSE_LABELS[k] ?? stateLabel(k).label}</td><td className="num">{fmt.num(c.before, 5)}</td><td className="num">{fmt.num(c.after, 5)}</td><td className="text-ink-3 text-[11px] num">{Object.entries(c).filter(([kk]) => !['before', 'after', 'unit'].includes(kk)).map(([kk, v]) => `${kk}=${typeof v === 'number' ? fmt.num(v, 4) : v}`).join(' · ')}</td></tr>)}</tbody></table>
                      )}
                      <div className="text-[11px] text-ink-3 mt-1">Evidence: {String((u.evidence as { type?: string }).type ?? '—')} {(u.evidence as { reconciliation_id?: string }).reconciliation_id ?? (u.evidence as { inspection_id?: string }).inspection_id ?? (u.evidence as { maintenance_id?: string }).maintenance_id ?? ''}</div>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          </div>
          {comp && <Callout kind="info">Current model version for {comp.id}: <b>v{comp.model_version}</b>. Rejected or deferred updates leave the version unchanged but are kept in the audit trail. Error is not guaranteed to decrease: a low-quality observation can increase uncertainty or be rejected.</Callout>}
        </>
      )}
    </div>
  )
}
