import { History, Pencil, Radio, Save, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { api } from '../api/client'
import type { ComponentDetail, Parameter } from '../api/types'
import { SeriesChart } from '../components/charts'
import { CAMERA_FOR, ComponentModel, damageFractions, FALLBACK_LIMITS, healthColor, IDLE_SIGNALS, Scene } from '../components/three'
import { Callout, Card, DecisionPill, ErrorBox, Field, KV, PageHeader, Spinner, Stat, StatusPill, Tag } from '../components/ui'
import { useAppStore } from '../store/useAppStore'
import { CHANNEL_LABELS, CONDITION_LABELS, fmt, fmtState, KEY_METRIC, RESPONSE_LABELS, STATE_LABELS, stateLabel } from '../utils/format'
import { useAction, useApi } from '../utils/useApi'

const MARGIN_TO_STATE: Record<string, string> = { margin_fatigue: 'miner_damage', margin_crack: 'crack_length_m', margin_corrosion: 'pit_depth_m', margin_creep: 'creep_strain', margin_thermal_fatigue: 'thermal_fatigue_damage', margin_oxidation: 'oxide_thickness_m', margin_leakage: 'wear_indicator' }

export default function ComponentDetailPage() {
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const [identityOpen, setIdentityOpen] = useState(false)
  const [replacementOpen, setReplacementOpen] = useState(false)
  const [identityDraft, setIdentityDraft] = useState({ effective_date: '2026-11-05', manufacturer: '', part_number: '', serial_number: '', reason: '', maintenance_reference: '' })
  const [replacementDraft, setReplacementDraft] = useState({ replacement_date: '2026-11-05', new_serial_number: '', manufacturer: '', part_number: '', reason: '', maintenance_reference: '' })
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
  const changeIdentity = useAction(async () => {
    const body = {
      effective_date: identityDraft.effective_date,
      reason: identityDraft.reason.trim(),
      maintenance_reference: identityDraft.maintenance_reference.trim(),
      ...(identityDraft.manufacturer.trim() ? { manufacturer: identityDraft.manufacturer.trim() } : {}),
      ...(identityDraft.part_number.trim() ? { part_number: identityDraft.part_number.trim() } : {}),
      ...(identityDraft.serial_number.trim() ? { serial_number: identityDraft.serial_number.trim() } : {}),
    }
    if (!body.manufacturer && !body.part_number && !body.serial_number) throw new Error('Change at least one identity field.')
    await api.changeComponentIdentity(id, body)
    pushToast('success', `Identity correction recorded for ${id}.`)
    setIdentityOpen(false)
    bump()
  })
  const replacePhysicalComponent = useAction(async () => {
    const result = await api.replaceComponent(id, {
      replacement_date: replacementDraft.replacement_date,
      new_serial_number: replacementDraft.new_serial_number.trim(),
      manufacturer: replacementDraft.manufacturer.trim() || undefined,
      part_number: replacementDraft.part_number.trim() || undefined,
      reason: replacementDraft.reason.trim(),
      maintenance_reference: replacementDraft.maintenance_reference.trim(),
    })
    pushToast('success', `${id} retired; replacement ${result.replacement_component.id} created.`)
    setReplacementOpen(false)
    bump()
    navigate(`/components/${result.replacement_component.id}?tab=history`)
  })
  if (loading && !data) return <Spinner label="Loading component…" />
  if (error) return <ErrorBox error={error} />
  if (!data) return null
  const c = data
  const rl = c.assessment.remaining_life
  const key = c.model_type ? KEY_METRIC[c.model_type] : 'miner_damage'
  const cam = c.model_type ? CAMERA_FOR[c.model_type] : CAMERA_FOR.engine_mount
  const limits: Record<string, number | null> = c.model_type ? { ...FALLBACK_LIMITS[c.model_type] } : {}
  for (const [mk, mv] of Object.entries(c.assessment.margins ?? {})) {
    const sv = MARGIN_TO_STATE[mk]
    if (sv && mv != null && c.state[sv] != null && mv < 1) limits[sv] = c.state[sv] / (1 - mv)
  }
  const damage = damageFractions(c.state, limits)
  return (
    <div className="space-y-4">
      <PageHeader
        title={`${c.id} — ${c.name}`}
        lede={<span>{c.aircraft_id} · {c.position} · {c.system} · P/N {c.part_number} · S/N {c.serial_number} · installed {c.installation_date} · {c.material} · <Tag kind={c.provenance} /> · {c.lifecycle_status === 'retired' ? <Tag kind="assumption">retired</Tag> : <Tag kind="uploaded">active instance</Tag>} · model {c.model_type ? `${c.model_type} v${c.model_version}` : 'none (catalogue entry)'}{c.replaced_by_component_id ? <> · replaced by <Link className="text-accent" to={`/components/${c.replaced_by_component_id}`}>{c.replaced_by_component_id}</Link></> : null}</span>}
        actions={c.model_type ? <>{c.lifecycle_status !== 'retired' && <><button className="btn-secondary" onClick={() => { setIdentityDraft({ effective_date: new Date().toISOString().slice(0, 10), manufacturer: c.manufacturer ?? '', part_number: c.part_number ?? '', serial_number: c.serial_number ?? '', reason: '', maintenance_reference: '' }); setIdentityOpen(true) }}>Correct identity</button><button className="btn-secondary" onClick={() => { setReplacementDraft({ replacement_date: new Date().toISOString().slice(0, 10), new_serial_number: '', manufacturer: c.manufacturer ?? '', part_number: c.part_number ?? '', reason: '', maintenance_reference: '' }); setReplacementOpen(true) }}>Replace component</button>{!c.history_initialised && <button className="btn-secondary" onClick={() => initialise.run()} disabled={initialise.busy}><History size={14} /> {initialise.busy ? 'Replaying…' : 'Initialise from history'}</button>}<Link to="/predictions" className="btn-primary">Predict next flight</Link></>}</> : undefined}
      />
      <ErrorBox error={initialise.error} />
      {identityOpen && (
        <Card title="Audited component identity correction" subtitle="Use this for a verified catalogue/nameplate correction. A physical replacement must use the separate replacement operation.">
          <div className="grid md:grid-cols-3 gap-3">
            <Field label="Effective date"><input className="input" type="date" value={identityDraft.effective_date} onChange={(e) => setIdentityDraft({ ...identityDraft, effective_date: e.target.value })} /></Field>
            <Field label="Manufacturer"><input className="input" value={identityDraft.manufacturer} onChange={(e) => setIdentityDraft({ ...identityDraft, manufacturer: e.target.value })} /></Field>
            <Field label="Part number"><input className="input" value={identityDraft.part_number} onChange={(e) => setIdentityDraft({ ...identityDraft, part_number: e.target.value })} /></Field>
            <Field label="Serial number"><input className="input" value={identityDraft.serial_number} onChange={(e) => setIdentityDraft({ ...identityDraft, serial_number: e.target.value })} /></Field>
            <Field label="Maintenance / identity reference"><input className="input" value={identityDraft.maintenance_reference} onChange={(e) => setIdentityDraft({ ...identityDraft, maintenance_reference: e.target.value })} /></Field>
            <Field label="Reason"><input className="input" value={identityDraft.reason} onChange={(e) => setIdentityDraft({ ...identityDraft, reason: e.target.value })} /></Field>
          </div>
          <ErrorBox error={changeIdentity.error} />
          <div className="flex gap-2 mt-3"><button className="btn-primary" onClick={() => changeIdentity.run()} disabled={changeIdentity.busy}>{changeIdentity.busy ? 'Saving…' : 'Record identity correction'}</button><button className="btn-secondary" onClick={() => setIdentityOpen(false)}>Cancel</button></div>
        </Card>
      )}
      {replacementOpen && (
        <Card title="Retire this component and create a replacement instance" subtitle="The old serial number, predictions and historical damage state remain on the retired component ID. The replacement gets a new component ID, fresh state and model version 1.">
          <div className="grid md:grid-cols-3 gap-3">
            <Field label="Replacement installation date"><input className="input" type="date" value={replacementDraft.replacement_date} onChange={(e) => setReplacementDraft({ ...replacementDraft, replacement_date: e.target.value })} /></Field>
            <Field label="New serial number"><input className="input" value={replacementDraft.new_serial_number} onChange={(e) => setReplacementDraft({ ...replacementDraft, new_serial_number: e.target.value })} /></Field>
            <Field label="Manufacturer"><input className="input" value={replacementDraft.manufacturer} onChange={(e) => setReplacementDraft({ ...replacementDraft, manufacturer: e.target.value })} /></Field>
            <Field label="Part number"><input className="input" value={replacementDraft.part_number} onChange={(e) => setReplacementDraft({ ...replacementDraft, part_number: e.target.value })} /></Field>
            <Field label="Work order / reference"><input className="input" value={replacementDraft.maintenance_reference} onChange={(e) => setReplacementDraft({ ...replacementDraft, maintenance_reference: e.target.value })} /></Field>
            <Field label="Replacement reason"><input className="input" value={replacementDraft.reason} onChange={(e) => setReplacementDraft({ ...replacementDraft, reason: e.target.value })} /></Field>
          </div>
          <Callout kind="warning">The replacement starts from the model's default damage state unless a measured baseline is provided through the API. Confirm the baseline from the installation inspection and OEM records before relying on predictions.</Callout>
          <ErrorBox error={replacePhysicalComponent.error} />
          <div className="flex gap-2 mt-3"><button className="btn-primary" onClick={() => replacePhysicalComponent.run()} disabled={replacePhysicalComponent.busy}>{replacePhysicalComponent.busy ? 'Creating replacement…' : 'Retire and create replacement'}</button><button className="btn-secondary" onClick={() => setReplacementOpen(false)}>Cancel</button></div>
        </Card>
      )}
      <div className="flex gap-1 border-b border-line">
        <button className={`px-3 py-1.5 text-[13px] border-b-2 ${tab === 'twin' ? 'border-accent text-ink font-medium' : 'border-transparent text-ink-2'}`} onClick={() => setParams({})}>Digital twin</button>
        <button className={`px-3 py-1.5 text-[13px] border-b-2 ${tab === 'history' ? 'border-accent text-ink font-medium' : 'border-transparent text-ink-2'}`} onClick={() => setParams({ tab: 'history' })}>Historical profile</button>
      </div>

      {tab === 'twin' && (
        <>
          <div className="grid grid-cols-12 gap-3">
            <div className="col-span-12 xl:col-span-7 card overflow-hidden">
              <div className="relative h-full min-h-[440px]">
                {c.model_type ? (
                  <Scene camera={cam.camera} target={cam.target} shadowY={cam.shadowY} className="absolute inset-0" autoRotate>
                    <ComponentModel modelType={c.model_type} signals={IDLE_SIGNALS} damage={damage} />
                  </Scene>
                ) : <div className="absolute inset-0 flex items-center justify-center text-ink-3 text-[12.5px]">Catalogue-only instance — no quantitative model, no 3D twin.</div>}
                <div className="absolute left-3 top-3 pointer-events-none">
                  <div className="text-[11px] uppercase tracking-[0.14em] text-ink-3">current estimated condition · model v{c.model_version}</div>
                  <div className="text-[14px] text-white font-semibold">{c.model?.display_name ?? c.name}</div>
                  <div className="text-[11px] text-ink-2">{c.history_initialised ? 'estimated from the component\u2019s own history (chronological replay)' : 'documented baseline — twin not yet initialised'}</div>
                </div>
                <div className="absolute right-3 top-3"><StatusPill status={c.assessment.status} /></div>
                {c.model_type && <Link to={`/live/${c.id}`} className="absolute right-3 bottom-3 btn-primary !py-1"><Radio size={13} /> Fly next flight in live twin</Link>}
              </div>
            </div>
            <div className="col-span-12 xl:col-span-5 space-y-2">
              <div className="grid grid-cols-2 gap-2">
                <Stat label="Governing remaining life" value={rl?.governing_remaining_flights != null ? fmt.int(rl.governing_remaining_flights) : '—'} unit={rl ? rl.unit : ''} hint={rl?.governing_mechanism ? `governing: ${rl.governing_mechanism.replace(/_/g, ' ')}` : 'not supported for this component'} tone={rl?.governing_remaining_flights != null && rl.governing_remaining_flights < 100 ? 'bad' : rl?.governing_remaining_flights != null && rl.governing_remaining_flights < 500 ? 'warn' : 'default'} />
                <Stat label="Minimum margin" value={c.assessment.min_margin != null ? fmt.pct(c.assessment.min_margin, 1) : '—'} hint="1 − state / review limit, worst mechanism" tone={c.assessment.min_margin != null && c.assessment.min_margin < 0.25 ? 'warn' : 'default'} />
              </div>
              {c.model_type && (
                <div className="card px-3 py-2.5">
                  <div className="label mb-2">damage state vs review limits</div>
                  <div className="space-y-2">
                    {Object.entries(c.state).filter(([k]) => k in STATE_LABELS).map(([k, v]) => {
                      const f = damage.fractions[k]
                      const lastB = c.model_updates.find((u) => u.applied && u.stage === 'B_damage_state' && u.changes[k])
                      const origin = lastB ? ((lastB.evidence as { type?: string }).type === 'maintenance' ? 'maintenance' : 'measured') : c.history_initialised || c.flight_log?.length ? 'simulation' : 'input'
                      return (
                        <div key={k}>
                          <div className="flex items-baseline justify-between text-[12px]"><span className="text-ink-2">{stateLabel(k).label}</span><span className="num text-white">{fmtState(k, v)} <Tag kind={origin} /></span></div>
                          <div className="relative h-1.5 mt-1 rounded bg-graphite border border-line overflow-hidden">{f != null && <div className="h-full" style={{ width: `${f * 100}%`, background: healthColor(f) }} />}</div>
                          <div className="flex justify-between text-[10px] text-ink-3 num"><span>{f != null ? `${(f * 100).toFixed(1)} % of limit` : 'no review limit'}</span><span>{!lastB && !c.history_initialised ? c.baseline_provenance?.[k] : ''}</span></div>
                        </div>
                      )
                    })}
                  </div>
                  {c.uncertainty_inflation && c.uncertainty_inflation > 1 ? <div className="mt-2 text-[11px] text-amber">Prediction uncertainty inflated ×{c.uncertainty_inflation.toFixed(2)} after unattributed discrepancies.</div> : null}
                </div>
              )}
              {c.twin && (
                <div className="card px-3 py-2.5 grid grid-cols-2 gap-x-3 gap-y-1.5 text-[11.5px]">
                  <div><div className="label">next scheduled flight</div>{c.twin.next_scheduled_flight ? <span className="num">{c.twin.next_scheduled_flight.id} · {c.twin.next_scheduled_flight.flight_date}</span> : '—'}</div>
                  <div><div className="label">last prediction</div>{c.twin.last_prediction ? <span className="num">{c.twin.last_prediction.flight_id} · v{c.twin.last_prediction.model_version} · {c.twin.last_prediction.status}</span> : '—'}</div>
                  <div><div className="label">last observation</div>{c.twin.last_observation ? <span className="num">{c.twin.last_observation.flight_id} <Tag kind={c.twin.last_observation.provenance} /></span> : '—'}</div>
                  <div><div className="label">last reconciliation</div>{c.twin.last_reconciliation ? <span><DecisionPill decision={c.twin.last_reconciliation.final_decision ?? c.twin.last_reconciliation.gate.decision} /> <span className="num text-ink-3">{fmt.pct(c.twin.last_reconciliation.summary.mean_relative_error)}</span></span> : '—'}</div>
                  <div className="col-span-2"><div className="label">next prediction</div>{c.twin.next_prediction_status}</div>
                  <div className="col-span-2"><div className="label">twin basis</div>{c.history_initialised ? <span className="text-green">own history · {c.evidence_summary?.completed_flights_with_observations} flights · {c.evidence_summary?.inspections} inspections · {c.evidence_summary?.maintenance_records} maintenance</span> : <span className="text-amber">documented baseline — not yet replayed</span>}</div>
                </div>
              )}
            </div>
          </div>
          {c.model_type && (
            <div className="grid xl:grid-cols-2 gap-3">
              <Card title="Operational response parameters" subtitle="Calibrated by Stage-A updates (flight reconciliation) only" dense>
                <div className="grid grid-cols-2 gap-2">
                  {Object.entries(c.response_params).map(([k, v]) => {
                    const cal = c.model_updates.some((u) => u.applied && u.stage === 'A_operational' && u.changes[k])
                    return <div key={k} className="rounded border border-line bg-graphite/60 px-2.5 py-1.5"><div className="label !text-[9.5px]">{RESPONSE_LABELS[k] ?? k}</div><div className="num text-[18px] leading-tight text-white">{v.toFixed(4)}</div><Tag kind={cal ? 'calibrated' : 'assumption'} /></div>
                  })}
                </div>
                <div className="mt-2"><div className="label mb-1">engineering margins (reference mission)</div><KV rows={Object.entries(c.assessment.margins ?? {}).map(([k, v]) => ({ k: k.replace('margin_', '').replace(/_/g, ' '), v: fmt.pct(v, 1) }))} /></div>
              </Card>
              <Card title="Model-update history" subtitle="Every accepted or rejected change, with its evidence" dense>
                {c.model_updates.length === 0 ? <div className="text-[12px] text-ink-3">No updates yet.</div> : (
                  <ul className="space-y-1 text-[12px] max-h-[260px] overflow-y-auto">{c.model_updates.map((u) => <li key={u.id} className={`border-l-2 pl-2 ${u.applied ? 'border-green' : 'border-red'}`}><div className="flex items-center gap-2"><DecisionPill decision={u.decision} /><span className="num text-ink-3">v{u.version_before}→v{u.version_after}</span><span className="text-ink-3">{u.update_type ?? u.stage}</span>{u.flight_id && <span className="num text-ink-3">{u.flight_id}</span>}</div><div className="text-ink-2">{u.summary}</div></li>)}</ul>
                )}
              </Card>
            </div>
          )}
          <details className="card">
            <summary className="cursor-pointer px-4 py-2.5 text-[12.5px] font-medium text-ink-2 hover:text-white">Remaining-life breakdown, description and geometry</summary>
            <div className="px-4 pb-4 grid md:grid-cols-2 gap-4 text-[12.5px]">
              <div><p className="text-ink-2">{c.description}</p><div className="mt-2"><KV mono={false} rows={[{ k: 'Baseline condition', v: c.initial_condition }, { k: 'Geometry', v: Object.entries(c.geometry).map(([k, v]) => `${k}: ${v}`).join(' · ') || '—' }, { k: 'Manufacturer', v: c.manufacturer || '—' }]} /></div></div>
              <div><div className="label mb-1">Remaining-life breakdown</div><KV rows={Object.entries(rl ?? {}).filter(([k]) => !['unit', 'governing_remaining_flights', 'governing_mechanism'].includes(k)).map(([k, v]) => ({ k: k.replace(/_/g, ' '), v: typeof v === 'number' ? fmt.num(v, 4) : v == null ? '—' : String(v) }))} /><div className="text-[11px] text-ink-3 mt-1">Unit: {rl?.unit}. Not converted to calendar time — no validated operating schedule.</div></div>
            </div>
          </details>
          {c.model && (
            <details className="card">
              <summary className="cursor-pointer px-4 py-2.5 text-[12.5px] font-medium text-ink-2 hover:text-white">Material, geometry and model parameters · governing equations</summary>
              <div className="px-4 pb-4 grid xl:grid-cols-2 gap-4">
                <ParametersCard comp={c} onSaved={refetch} />
                <Card title="Governing equations, required measurements and legitimate outputs" subtitle="As applied to this component">
                  <ul className="space-y-1.5">{c.model.equations.map((e) => <li key={e.name} className="flex items-baseline gap-3 text-[12.5px]"><span className="text-ink-3 w-[150px] shrink-0">{e.name}</span><code className="num bg-graphite px-1.5 py-0.5 rounded">{e.text}</code></li>)}</ul>
                  <div className="mt-3 text-[12px] text-ink-2 space-y-1">
                    <div><b>Mechanisms:</b> {c.model.mechanisms.join(', ')}</div>
                    <div><b>Flight conditions used:</b> {c.model.relevant_mission_inputs.map((k) => CONDITION_LABELS[k] ?? k).join(', ')}</div>
                    <div><b>Measurements reconciled:</b> {hist.data?.measured_quantities.map((k) => CHANNEL_LABELS[k] ?? k).join(', ') || '—'}{hist.data?.unavailable_quantities.length ? ` · not available for this instance: ${hist.data.unavailable_quantities.map((k) => CHANNEL_LABELS[k] ?? k).join(', ')}` : ''}</div>
                    <div><b>Legitimate outputs:</b> operational response, physical damage state ({Object.keys(c.state).map((k) => stateLabel(k).label).join(', ')}), remaining life in flights of the reference mission, model-derived threshold-crossing fraction (uncalibrated). Sensor residuals never establish damage directly.</div>
                    <div><b>Uncertain inputs sampled by Monte Carlo:</b> {Object.entries(c.model.uncertain_parameters).map(([k, v]) => `${k} (${v.class}, ${v.dist}${v.cov ? `, CoV ${v.cov}` : ''}${v.sd_abs ? `, σ ${v.sd_abs}` : ''})`).join('; ')}</div>
                  </div>
                  <div className="mt-3"><Callout kind="warning">Default parameters are illustrative demonstration values of the stated material class (provenance "assumption"). Replace with qualified data before any real assessment.</Callout></div>
                </Card>
              </div>
            </details>
          )}
        </>
      )}

      {tab === 'history' && (
        <>
          {hist.loading && !hist.data ? <Spinner /> : hist.data && (
            <>
              <Card title="Baseline at history start" subtitle={`${hist.data.baseline_date} · each value tagged with its origin`} dense>
                <KV mono={false} rows={Object.entries(hist.data.baseline_state ?? {}).map(([k, v]) => ({ k: stateLabel(k).label, v: <span><span className="num">{fmtState(k, v)}</span> <span className="text-ink-3">— {hist.data!.baseline_provenance?.[k] ?? 'specification / default'}</span></span> }))} />
                {c.history_initialised && c.evidence_summary && <div className="text-[12px] text-ink-2 mt-2">Chronological replay: {c.evidence_summary.completed_flights_replayed ?? c.evidence_summary.completed_flights_with_observations} completed flights ({c.evidence_summary.completed_flights_with_observations} with sensor observations, {c.evidence_summary.completed_flights_without_sensor_observations ?? 0} without sensors), {c.evidence_summary.operational_records ?? 0} operational summaries, {c.evidence_summary.load_histories ?? 0} stress histories, {c.evidence_summary.inspections} inspections and {c.evidence_summary.maintenance_records} maintenance records.</div>}
              </Card>
              <Card title="Historical sensor observations" subtitle={`${hist.data.observations.length} flights · measured: ${hist.data.measured_quantities.map((k) => CHANNEL_LABELS[k] ?? k).join(', ') || '—'} · unavailable: ${hist.data.unavailable_quantities.map((k) => CHANNEL_LABELS[k] ?? k).join(', ') || '—'}`} dense>
                {hist.data.observations.length === 0 ? <div className="text-[12px] text-ink-3">No observation records for this instance.</div> : (
                  <>
                    <div className="grid md:grid-cols-2 xl:grid-cols-4 gap-3">
                      {hist.data.measured_quantities.map((k, i) => (
                        <SeriesChart key={k} data={hist.data!.observations.map((o) => ({ flight: o.flight_id.replace('AC001-', ''), mean: o.summary[k]?.mean ?? null, max: o.summary[k]?.max ?? null }))} xKey="flight" series={[{ key: 'mean', name: 'flight mean', color: ['#38bdf8', '#f5b041', '#a78bfa', '#3ddc97'][i % 4] }, { key: 'max', name: 'flight max', color: ['#38bdf8', '#f5b041', '#a78bfa', '#3ddc97'][i % 4], dashed: true }]} title={CHANNEL_LABELS[k] ?? k} unitNote={hist.data!.observations[0]?.summary[k] ? { load_kN: 'kN', strain_microstrain: 'µε', temperature_c: '°C', pressure_bar: 'bar', vibration_g: 'g RMS' }[k] : ''} height={160} />
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
                <Card title="Uploaded operational summary records" subtitle="Linked summaries feed as-flown conditions during chronological replay; unlinked records remain traceable but are excluded." dense>
                  {(hist.data.operational_records ?? []).length === 0 ? <div className="text-[12px] text-ink-3">No operational summaries uploaded.</div> : (
                    <div className="overflow-x-auto"><table className="table text-[12px]"><thead><tr><th>Date</th><th>Flight ID</th><th>Duration</th><th>Landing cycles</th><th>Load factor</th><th>Max temp.</th><th>Environment</th><th>Source</th></tr></thead>
                      <tbody>{(hist.data.operational_records ?? []).map((r) => <tr key={r.id}><td className="num">{r.operational_date}</td><td className="num">{r.flight_id ?? 'unlinked'}</td><td className="num">{r.conditions.duration_min ?? '—'} min</td><td className="num">{r.conditions.landing_cycles ?? '—'}</td><td className="num">{r.conditions.load_factor ?? '—'}</td><td className="num">{r.conditions.temperature_c ?? '—'} °C</td><td>{r.environment ?? '—'}</td><td><Tag kind={r.provenance} /> {r.automatic_twin_replay ? <Tag kind="uploaded">replay input</Tag> : <Tag kind="assumption">not linked</Tag>} <span className="text-ink-3">{r.source}</span></td></tr>)}</tbody></table></div>
                  )}
                  <div className="text-[10.5px] text-ink-3 mt-2">When linked to the component's completed flight, supplied duration, load factor, load variation, manoeuvre, temperature, pressure, vibration, intensity and environment are used by the as-flown physical step. They do not create sensor residuals; Stage A calibration still requires measured channel observations.</div>
                </Card>
                <Card title="Uploaded stress time histories" subtitle="Original MPa samples and rainflow summaries are retained. Only a linked engine-mount critical-net-section declaration is fed to the crack-growth step." dense>
                  {(hist.data.load_histories ?? []).length === 0 ? <div className="text-[12px] text-ink-3">No load-history traces uploaded.</div> : (
                    <div className="space-y-3">
                      {(hist.data.load_histories ?? []).map((r) => (
                        <div key={r.id} className="border border-line rounded p-2">
                          <div className="flex flex-wrap justify-between gap-2 text-[11.5px] mb-1"><span className="font-medium">{r.filename} · {r.flight_id ?? 'not linked to a flight'} · {r.stress_basis ?? 'not_mapped'}</span><span className="num">{r.n_samples} samples · {fmt.num(r.rainflow.n_cycles, 1)} rainflow cycles · max range {fmt.num(r.rainflow.max_range_mpa, 1)} MPa · {r.automatic_twin_replay ? 'used in as-flown physics' : 'archived only'}</span></div>
                          <SeriesChart data={r.samples.map((s) => ({ time_s: s.t_s, stress_mpa: s.stress_mpa }))} xKey="time_s" series={[{ key: 'stress_mpa', name: 'stress', color: '#38bdf8' }]} title="Preserved stress trace" unitNote="MPa" height={145} />
                        </div>
                      ))}
                    </div>
                  )}
                  <div className="text-[10.5px] text-ink-3 mt-2">A critical_net_section declaration is user-supplied and only enables replay for engine_mount; it is not an independent validation of the strain-to-stress transfer, net-section geometry or local stress concentration. Other traces remain archived only.</div>
                </Card>
              </div>
              <Card title="Audited component identity lifecycle" subtitle="Identity corrections and physical replacements are recorded separately from the damage/operating model history." dense>
                {(hist.data.identity_events ?? []).length === 0 ? <div className="text-[12px] text-ink-3">No identity corrections or replacements recorded.</div> : (
                  <div className="overflow-x-auto"><table className="table text-[12px]"><thead><tr><th>Date</th><th>Event</th><th>Old serial</th><th>New serial</th><th>Reference</th><th>Reason</th></tr></thead><tbody>
                    {(hist.data.identity_events ?? []).map((event) => <tr key={event.id}><td className="num">{event.effective_date}</td><td>{event.event_type}</td><td className="num">{event.before_identity?.serial_number ?? '—'}</td><td className="num">{event.after_identity?.serial_number ?? '—'}</td><td className="num">{event.maintenance_reference}</td><td>{event.reason}</td></tr>)}
                  </tbody></table></div>
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
