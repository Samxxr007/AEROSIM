import { History, Pencil, Save, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { api } from '../api/client'
import type { ComponentDetail, Parameter } from '../api/types'
import { SeriesChart } from '../components/charts'
import { ComponentSchematic } from '../components/schematics'
import { Callout, Card, DecisionPill, ErrorBox, Field, KV, PageHeader, Spinner, Stat, StatusPill, Tag } from '../components/ui'
import { useAppStore } from '../store/useAppStore'
import { CHANNEL_LABELS, CONDITION_LABELS, fmt, fmtState, KEY_METRIC, RESPONSE_LABELS, stateLabel } from '../utils/format'
import { useAction, useApi } from '../utils/useApi'

export default function ComponentDetailPage() {
  const { id = '' } = useParams()
  const [params, setParams] = useSearchParams()
  const tab = params.get('tab') === 'history' ? 'history' : 'twin'
  const { refreshKey, setSelectedComponentId, pushToast, bump } = useAppStore()
  const { data, error, loading, refetch } = useApi(() => api.component(id), [id, refreshKey])
  const hist = useApi(() => api.componentHistory(id), [id, refreshKey])
  useEffect(() => {
    if (data?.model_type) setSelectedComponentId(data.id)
  }, [data, setSelectedComponentId])
  const initialise = useAction(async () => {
    const r = await api.initialiseTwin(id)
    bump()
    pushToast('success', `${id} initialised from its own history → model v${r.component.model_version}.`)
  })
  if (loading && !data) return <Spinner label="Loading component…" />
  if (error) return <ErrorBox error={error} />
  if (!data) return null
  const c = data
  const rl = c.assessment.remaining_life
  const key = c.model_type ? KEY_METRIC[c.model_type] : 'miner_damage'
  return (
    <div className="space-y-4">
      <PageHeader
        title={`${c.id} — ${c.name}`}
        lede={<span>{c.aircraft_id} · {c.position} · {c.system} · P/N {c.part_number} · S/N {c.serial_number} · installed {c.installation_date} · {c.material} · <Tag kind={c.provenance} /> · model {c.model_type ? `${c.model_type} v${c.model_version}` : 'none (catalogue entry)'}</span>}
        actions={c.model_type ? <>{!c.history_initialised && <button className="btn-secondary" onClick={() => initialise.run()} disabled={initialise.busy}><History size={14} /> {initialise.busy ? 'Replaying…' : 'Initialise from history'}</button>}<Link to="/predictions" className="btn-primary">Predict next flight</Link></> : undefined}
      />
      <ErrorBox error={initialise.error} />
      <div className="flex gap-1 border-b border-line">
        <button className={`px-3 py-1.5 text-[13px] border-b-2 ${tab === 'twin' ? 'border-accent text-ink font-medium' : 'border-transparent text-ink-2'}`} onClick={() => setParams({})}>Digital twin</button>
        <button className={`px-3 py-1.5 text-[13px] border-b-2 ${tab === 'history' ? 'border-accent text-ink font-medium' : 'border-transparent text-ink-2'}`} onClick={() => setParams({ tab: 'history' })}>Historical profile</button>
      </div>

      {tab === 'twin' && (
        <>
          <div className="flex flex-wrap gap-2">
            <div className="flex-1 min-w-[180px]"><Stat label="Status" value={<StatusPill status={c.assessment.status} />} hint={c.assessment.detail} /></div>
            <Stat label="Governing remaining life" value={rl?.governing_remaining_flights != null ? fmt.int(rl.governing_remaining_flights) : '—'} unit={rl ? rl.unit : ''} hint={rl?.governing_mechanism ? `governing: ${rl.governing_mechanism.replace(/_/g, ' ')}` : 'not supported for this component'} tone={rl?.governing_remaining_flights != null && rl.governing_remaining_flights < 100 ? 'bad' : rl?.governing_remaining_flights != null && rl.governing_remaining_flights < 500 ? 'warn' : 'default'} />
            <Stat label="Minimum engineering margin" value={c.assessment.min_margin != null ? fmt.pct(c.assessment.min_margin, 1) : '—'} hint="1 − (state / threshold), worst mechanism" tone={c.assessment.min_margin != null && c.assessment.min_margin < 0.25 ? 'warn' : 'default'} />
            <Stat label="Model version" value={c.model_type ? `v${c.model_version}` : '—'} hint={`${c.model_updates.filter((u) => u.applied).length} applied / ${c.model_updates.filter((u) => !u.applied).length} not applied`} />
            <Stat label="Twin basis" value={c.history_initialised ? 'own history' : 'baseline'} hint={c.history_initialised ? `${c.evidence_summary?.completed_flights_with_observations} flights · ${c.evidence_summary?.inspections} inspections · ${c.evidence_summary?.maintenance_records} maintenance` : 'documented baseline estimate; not yet replayed'} tone={c.history_initialised ? 'good' : 'warn'} />
          </div>
          {c.twin && (
            <Card title="Twin status" dense>
              <div className="grid md:grid-cols-5 gap-3 text-[12px]">
                <div><div className="label">Next scheduled flight</div>{c.twin.next_scheduled_flight ? <span className="num">{c.twin.next_scheduled_flight.id} · {c.twin.next_scheduled_flight.flight_date}</span> : '—'}</div>
                <div><div className="label">Last pre-flight prediction</div>{c.twin.last_prediction ? <span className="num">{c.twin.last_prediction.flight_id} · v{c.twin.last_prediction.model_version} · {c.twin.last_prediction.status}</span> : '—'}</div>
                <div><div className="label">Last observation</div>{c.twin.last_observation ? <span className="num">{c.twin.last_observation.flight_id} <Tag kind={c.twin.last_observation.provenance} /></span> : '—'}</div>
                <div><div className="label">Last reconciliation</div>{c.twin.last_reconciliation ? <span><DecisionPill decision={c.twin.last_reconciliation.final_decision ?? c.twin.last_reconciliation.gate.decision} /> <span className="num text-ink-3">{fmt.pct(c.twin.last_reconciliation.summary.mean_relative_error)}</span></span> : '—'}</div>
                <div><div className="label">Next prediction</div>{c.twin.next_prediction_status}</div>
              </div>
            </Card>
          )}
          <div className="grid xl:grid-cols-3 gap-4">
            <Card title="Component schematic" subtitle={c.model?.display_name ?? 'No implemented model'}>
              <ComponentSchematic modelType={c.model_type} state={c.state} params={c.parameters} />
              <p className="text-[12.5px] text-ink-2 mt-2">{c.description}</p>
              <div className="mt-2"><KV mono={false} rows={[{ k: 'Baseline condition', v: c.initial_condition }, { k: 'Geometry', v: Object.entries(c.geometry).map(([k, v]) => `${k}: ${v}`).join(' · ') || '—' }, { k: 'Manufacturer', v: c.manufacturer || '—' }]} /></div>
            </Card>
            <Card title="Current estimated damage state" subtitle="Values enter through: baseline (specification/inferred) · as-flown physics · inspection evidence · maintenance">
              {c.model_type ? (
                <>
                  <table className="table"><thead><tr><th>State variable</th><th>Value</th><th>Origin of latest change</th></tr></thead>
                    <tbody>{Object.entries(c.state).map(([k, v]) => {
                      const lastB = c.model_updates.find((u) => u.applied && u.stage === 'B_damage_state' && u.changes[k])
                      const origin = lastB ? ((lastB.evidence as { type?: string }).type === 'maintenance' ? 'maintenance' : 'measured') : c.history_initialised || c.flight_log?.length ? 'simulation' : 'input'
                      return <tr key={k}><td>{stateLabel(k).label}</td><td className="num">{fmtState(k, v)}</td><td><Tag kind={origin} />{!lastB && !c.history_initialised && <span className="text-[10.5px] text-ink-3 ml-1">{c.baseline_provenance?.[k]}</span>}</td></tr>
                    })}</tbody></table>
                  <div className="mt-3"><div className="label mb-1">Engineering margins (reference mission)</div><KV rows={Object.entries(c.assessment.margins ?? {}).map(([k, v]) => ({ k: k.replace('margin_', '').replace(/_/g, ' '), v: fmt.pct(v, 1) }))} /></div>
                  <div className="mt-3"><div className="label mb-1">Remaining-life breakdown</div><KV rows={Object.entries(rl ?? {}).filter(([k]) => !['unit', 'governing_remaining_flights', 'governing_mechanism'].includes(k)).map(([k, v]) => ({ k: k.replace(/_/g, ' '), v: typeof v === 'number' ? fmt.num(v, 4) : v == null ? '—' : String(v) }))} /><div className="text-[11px] text-ink-3 mt-1">Unit: {rl?.unit}. Not converted to calendar time — no validated operating schedule.</div></div>
                  {c.uncertainty_inflation && c.uncertainty_inflation > 1 && <div className="mt-2"><Callout kind="warning">Prediction uncertainty inflated ×{c.uncertainty_inflation.toFixed(2)} after unattributed discrepancies flagged for engineering investigation.</Callout></div>}
                </>
              ) : <Callout kind="info">No quantitative state is tracked for a catalogue-only component instance.</Callout>}
            </Card>
            <Card title="Operational response parameters" subtitle="Calibrated by Stage-A updates (flight reconciliation) only">
              <table className="table"><thead><tr><th>Parameter</th><th>Value</th><th>Origin</th></tr></thead>
                <tbody>{Object.entries(c.response_params).map(([k, v]) => <tr key={k}><td>{RESPONSE_LABELS[k] ?? k}</td><td className="num">{v.toFixed(4)}</td><td><Tag kind={c.model_updates.some((u) => u.applied && u.stage === 'A_operational' && u.changes[k]) ? 'calibrated' : 'assumption'} /></td></tr>)}</tbody></table>
              <div className="mt-3"><div className="label mb-1">Model-update history</div>
                {c.model_updates.length === 0 ? <div className="text-[12px] text-ink-3">No updates yet.</div> : (
                  <ul className="space-y-1 text-[12px] max-h-[260px] overflow-y-auto">{c.model_updates.map((u) => <li key={u.id} className="border-l-2 border-line pl-2"><div className="flex items-center gap-2"><DecisionPill decision={u.decision} /><span className="num text-ink-3">v{u.version_before}→v{u.version_after}</span><span className="text-ink-3">{u.update_type ?? u.stage}</span>{u.flight_id && <span className="num text-ink-3">{u.flight_id}</span>}</div><div className="text-ink-2">{u.summary}</div></li>)}</ul>
                )}
              </div>
            </Card>
          </div>
          {c.model && (
            <div className="grid xl:grid-cols-2 gap-4">
              <ParametersCard comp={c} onSaved={refetch} />
              <Card title="Governing equations, required measurements and legitimate outputs" subtitle="As applied to this component">
                <ul className="space-y-1.5">{c.model.equations.map((e) => <li key={e.name} className="flex items-baseline gap-3 text-[12.5px]"><span className="text-ink-3 w-[150px] shrink-0">{e.name}</span><code className="num bg-paper px-1.5 py-0.5 rounded">{e.text}</code></li>)}</ul>
                <div className="mt-3 text-[12px] text-ink-2 space-y-1">
                  <div><b>Mechanisms:</b> {c.model.mechanisms.join(', ')}</div>
                  <div><b>Flight conditions used:</b> {c.model.relevant_mission_inputs.map((k) => CONDITION_LABELS[k] ?? k).join(', ')}</div>
                  <div><b>Measurements reconciled:</b> {hist.data?.measured_quantities.map((k) => CHANNEL_LABELS[k] ?? k).join(', ') || '—'}{hist.data?.unavailable_quantities.length ? ` · not available for this instance: ${hist.data.unavailable_quantities.map((k) => CHANNEL_LABELS[k] ?? k).join(', ')}` : ''}</div>
                  <div><b>Legitimate outputs:</b> operational response (loads, strain, temperature, pressure, vibration), physical damage state ({Object.keys(c.state).map((k) => stateLabel(k).label).join(', ')}), remaining life in flights of the reference mission, model-derived threshold-crossing fraction (uncalibrated). Sensor residuals never establish damage directly.</div>
                  <div><b>Uncertain inputs sampled by Monte Carlo:</b> {Object.entries(c.model.uncertain_parameters).map(([k, v]) => `${k} (${v.class}, ${v.dist}${v.cov ? `, CoV ${v.cov}` : ''}${v.sd_abs ? `, σ ${v.sd_abs}` : ''})`).join('; ')}</div>
                </div>
                <div className="mt-3"><Callout kind="warning">Default parameters are illustrative demonstration values of the stated material class (provenance "assumption"). Replace with qualified data before any real assessment.</Callout></div>
              </Card>
            </div>
          )}
        </>
      )}

      {tab === 'history' && (
        <>
          {hist.loading && !hist.data ? <Spinner /> : hist.data && (
            <>
              <Card title="Baseline at history start" subtitle={`${hist.data.baseline_date} · each value tagged with its origin`} dense>
                <KV mono={false} rows={Object.entries(hist.data.baseline_state ?? {}).map(([k, v]) => ({ k: stateLabel(k).label, v: <span><span className="num">{fmtState(k, v)}</span> <span className="text-ink-3">— {hist.data!.baseline_provenance?.[k] ?? 'specification / default'}</span></span> }))} />
                {c.history_initialised && c.evidence_summary && <div className="text-[12px] text-ink-2 mt-2">Twin initialised by chronological replay: {c.evidence_summary.completed_flights_with_observations} flights with observations, {c.evidence_summary.inspections} inspections, {c.evidence_summary.maintenance_records} maintenance records → {c.evidence_summary.applied_updates} applied updates, {c.evidence_summary.rejected_updates} not applied.</div>}
              </Card>
              <Card title="Historical sensor observations" subtitle={`${hist.data.observations.length} flights · measured: ${hist.data.measured_quantities.map((k) => CHANNEL_LABELS[k] ?? k).join(', ') || '—'} · unavailable: ${hist.data.unavailable_quantities.map((k) => CHANNEL_LABELS[k] ?? k).join(', ') || '—'}`} dense>
                {hist.data.observations.length === 0 ? <div className="text-[12px] text-ink-3">No observation records for this instance.</div> : (
                  <>
                    <div className="grid md:grid-cols-2 xl:grid-cols-4 gap-3">
                      {hist.data.measured_quantities.map((k, i) => (
                        <SeriesChart key={k} data={hist.data!.observations.map((o) => ({ flight: o.flight_id.replace('AC001-', ''), mean: o.summary[k]?.mean ?? null, max: o.summary[k]?.max ?? null }))} xKey="flight" series={[{ key: 'mean', name: 'flight mean', color: ['#1f6f8b', '#b7791f', '#5b4b8a', '#2f7d4f'][i % 4] }, { key: 'max', name: 'flight max', color: ['#1f6f8b', '#b7791f', '#5b4b8a', '#2f7d4f'][i % 4], dashed: true }]} title={CHANNEL_LABELS[k] ?? k} unitNote={hist.data!.observations[0]?.summary[k] ? { load_kN: 'kN', strain_microstrain: 'µε', temperature_c: '°C', pressure_bar: 'bar', vibration_g: 'g RMS' }[k] : ''} height={160} />
                      ))}
                    </div>
                    <div className="overflow-x-auto mt-2"><table className="table whitespace-nowrap text-[12px]">
                      <thead><tr><th>Flight</th><th>Date</th><th>Route</th><th>Provenance</th>{hist.data.measured_quantities.map((k) => <th key={k}>{CHANNEL_LABELS[k] ?? k} mean / max</th>)}<th>Missing</th><th>As-flown load factor</th><th>Duration</th></tr></thead>
                      <tbody>{hist.data.observations.map((o) => <tr key={o.id}><td className="num">{o.flight_id}</td><td className="num">{o.flight_date}</td><td>{o.route}</td><td><Tag kind={o.provenance} />{o.anomaly !== 'none' && <Tag kind="assumption">{o.anomaly}</Tag>}</td>{hist.data!.measured_quantities.map((k) => <td key={k} className="num">{o.summary[k] ? `${fmt.num(o.summary[k].mean, 4)} / ${fmt.num(o.summary[k].max, 4)}` : <span className="text-ink-3">n/a</span>}</td>)}<td className="num">{fmt.pct(Math.max(0, ...Object.values(o.summary).map((s) => s.missing_fraction)), 0)}</td><td className="num">{o.actual_conditions?.load_factor ?? '—'}</td><td className="num">{o.actual_conditions?.duration_min} min</td></tr>)}</tbody>
                    </table></div>
                  </>
                )}
              </Card>
              <div className="grid xl:grid-cols-2 gap-4">
                <Card title="Inspection records" dense>
                  {hist.data.inspections.length === 0 ? <div className="text-[12px] text-ink-3">None.</div> : (
                    <table className="table text-[12px]"><thead><tr><th>Date</th><th>Method</th><th>Finding</th><th>Measured</th><th>Confidence</th><th>Provenance</th><th>Twin decision</th></tr></thead>
                      <tbody>{hist.data.inspections.map((i) => <tr key={i.id}><td className="num">{i.inspection_date}</td><td>{i.method_label}</td><td>{i.observed_defect}</td><td className="num">{i.measured_value != null ? `${i.measured_value} ± ${i.measurement_uncertainty ?? '?'} ${i.unit ?? ''}` : '—'}</td><td>{i.confidence}</td><td><Tag kind={i.provenance} /></td><td>{i.update ? <DecisionPill decision={i.update.decision} /> : <span className="text-ink-3">no update</span>}</td></tr>)}</tbody></table>
                  )}
                </Card>
                <Card title="Maintenance records" dense>
                  {hist.data.maintenance.length === 0 ? <div className="text-[12px] text-ink-3">No maintenance interventions in the history window.</div> : (
                    <table className="table text-[12px]"><thead><tr><th>Date</th><th>Activity</th><th>Type</th><th>Damage before → after</th><th>Reference</th><th>Provenance</th></tr></thead>
                      <tbody>{hist.data.maintenance.map((m) => <tr key={m.id}><td className="num">{m.maintenance_date}</td><td>{m.activity}</td><td>{m.repair_or_replacement}</td><td className="num">{m.damage_before ? Object.entries(m.damage_before).map(([k, v]) => `${stateLabel(k).label} ${fmtState(k, v)}`).join(', ') : '—'} → {m.damage_after ? Object.entries(m.damage_after).map(([k, v]) => `${fmtState(k, v)}`).join(', ') : 'no change'}</td><td className="num">{m.maintenance_reference}</td><td><Tag kind={m.provenance} /></td></tr>)}</tbody></table>
                  )}
                </Card>
              </div>
              <Card title="Degradation progression (as-flown twin estimates)" subtitle="State after each incorporated flight" dense>
                {hist.data.flight_log.length === 0 ? <div className="text-[12px] text-ink-3">No flights incorporated yet — initialise the twin from history.</div> : (
                  <SeriesChart data={hist.data.flight_log.map((f) => ({ flight: f.flight_id.replace('AC001-', ''), value: (f.state_after[key] ?? 0) * stateLabel(key).scale }))} xKey="flight" series={[{ key: 'value', name: stateLabel(key).label }]} title={`${stateLabel(key).label} after each flight`} unitNote={stateLabel(key).unit} height={220} />
                )}
              </Card>
            </>
          )}
        </>
      )}
    </div>
  )
}

function ParametersCard({ comp, onSaved }: { comp: ComponentDetail; onSaved: () => void }) {
  const pushToast = useAppStore((s) => s.pushToast)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState<Record<string, Parameter>>(comp.parameters)
  useEffect(() => setDraft(comp.parameters), [comp.parameters])
  const save = useAction(async () => {
    const changed: Record<string, { value: number; provenance: string }> = {}
    for (const [k, p] of Object.entries(draft)) {
      if (!Number.isFinite(p.value)) throw new Error(`Parameter ${k} must be numeric.`)
      if (p.value !== comp.parameters[k].value || p.provenance !== comp.parameters[k].provenance) changed[k] = { value: p.value, provenance: p.provenance }
    }
    await api.updateComponent(comp.id, { name: comp.name, system: comp.system, parameters: changed })
    pushToast('success', `${Object.keys(changed).length} parameter(s) saved for ${comp.id}.`)
    setEditing(false)
    onSaved()
  })
  return (
    <Card title="Material, geometry and model parameters" subtitle="Every value is tagged as input, assumption, measured, catalogue or calibrated" actions={editing ? <><button className="btn-primary" onClick={() => save.run()} disabled={save.busy}><Save size={13} /> Save</button><button className="btn-secondary" onClick={() => { setDraft(comp.parameters); setEditing(false) }}><X size={13} /> Cancel</button></> : <button className="btn-secondary" onClick={() => setEditing(true)}><Pencil size={13} /> Edit</button>}>
      {save.error ? <div className="mb-2"><ErrorBox error={save.error} /></div> : null}
      <table className="table"><thead><tr><th>Parameter</th><th>Value</th><th>Unit</th><th>Provenance</th><th>Description</th></tr></thead>
        <tbody>{Object.values(draft).map((p) => <tr key={p.name}><td className="num">{p.name}</td><td className="num">{editing ? <input className="input w-[120px]" type="number" step="any" value={p.value} onChange={(e) => setDraft({ ...draft, [p.name]: { ...p, value: Number(e.target.value) } })} /> : fmt.num(p.value, 4)}</td><td className="text-ink-2">{p.unit}</td><td>{editing ? <select className="input w-[120px]" value={p.provenance} onChange={(e) => setDraft({ ...draft, [p.name]: { ...p, provenance: e.target.value as Parameter['provenance'] } })}>{['input', 'assumption', 'measured', 'catalogue', 'calibrated'].map((o) => <option key={o}>{o}</option>)}</select> : <Tag kind={p.provenance} />}</td><td className="text-ink-2 text-[12px]">{p.description}</td></tr>)}</tbody></table>
      {editing && <Field label="" className="mt-2"><span className="text-[11.5px] text-ink-3">Values are validated by the backend model. Changing parameters does not change the model version; only evidence-based updates do.</span></Field>}
    </Card>
  )
}
