import { ClipboardCheck, Wand2, Wrench } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { api } from '../api/client'
import type { Inspection } from '../api/types'
import { Callout, Card, DecisionPill, ErrorBox, Field, PageHeader, Spinner, Tag } from '../components/ui'
import { useAppStore } from '../store/useAppStore'
import { DECISION_LABELS, fmt, fmtState, stateLabel } from '../utils/format'
import { useAction, useApi } from '../utils/useApi'

export default function InspectionsPage() {
  const { selectedComponentId, setSelectedComponentId, pushToast, refreshKey, bump } = useAppStore()
  const comps = useApi(() => api.components(), [refreshKey])
  const methods = useApi(() => api.inspectionMethods(), [])
  const list = useApi(() => api.inspections(), [refreshKey])
  const mnt = useApi(() => api.maintenance(), [refreshKey])
  const comp = comps.data?.find((c) => c.id === selectedComponentId)
  const [form, setForm] = useState({ component_id: selectedComponentId, inspection_date: new Date().toISOString().slice(0, 10), method: 'ultrasonic', observed_defect: '', quantity: 'crack_length_m', measured_value: '', measurement_uncertainty: '', confidence: 'high', source: 'NDT report', notes: '' })
  const [mform, setMform] = useState({ maintenance_date: new Date().toISOString().slice(0, 10), activity: '', repair_or_replacement: 'none', quantity: '', value: '', reference: '' })
  const [last, setLast] = useState<Inspection | null>(null)
  useEffect(() => setForm((f) => ({ ...f, component_id: selectedComponentId })), [selectedComponentId])
  const quantities = useMemo(() => Object.keys(methods.data?.quantity_units ?? {}).filter((q) => Object.keys(comp?.state ?? {}).includes(q)), [comp, methods.data])
  useEffect(() => {
    if (quantities.length && !quantities.includes(form.quantity)) setForm((f) => ({ ...f, quantity: quantities[0] }))
  }, [quantities, form.quantity])
  const submit = useAction(async () => {
    if (!form.component_id) throw new Error('Select a component.')
    const mv = form.measured_value.trim() === '' ? null : Number(form.measured_value)
    const mu = form.measurement_uncertainty.trim() === '' ? null : Number(form.measurement_uncertainty)
    if (mv !== null && (!Number.isFinite(mv) || mv < 0)) throw new Error('Measured value must be a non-negative number.')
    if (mu !== null && (!Number.isFinite(mu) || mu <= 0)) throw new Error('Measurement uncertainty must be a positive number.')
    const r = await api.createInspection({ ...form, quantity: mv === null ? null : form.quantity, measured_value: mv, measurement_uncertainty: mu, unit: methods.data?.quantity_units[form.quantity] ?? null })
    setLast(r)
    bump()
    pushToast(r.update?.applied ? 'success' : r.update ? 'warning' : 'info', r.update ? `${DECISION_LABELS[r.update.decision]}: ${r.update.reasons[0] ?? 'damage state updated'}` : 'Inspection recorded (no quantitative update).')
  })
  const synthetic = useAction(async () => {
    if (!comp?.model_type) throw new Error('Select a modelled component.')
    const q = form.quantity
    const sd = Number(form.measurement_uncertainty) || (q === 'crack_length_m' ? 0.1 : q === 'wear_indicator' ? 0.02 : 5)
    const unit = methods.data?.quantity_units[q] ?? ''
    const scale = { mm: 1e-3, 'µm': 1e-6, '%': 1e-2, '-': 1 }[unit] ?? 1
    const r = await api.syntheticInspection(comp.id, q, sd * scale, form.method, 11)
    setLast(r)
    bump()
    pushToast(r.update?.applied ? 'success' : 'warning', `Synthetic ${r.method_label}: ${r.measured_value} ± ${r.measurement_uncertainty} ${r.unit} — ${r.update ? DECISION_LABELS[r.update.decision] : 'recorded'}.`)
  })
  const addMaint = useAction(async () => {
    if (!comp) throw new Error('Select a component.')
    if (!mform.activity.trim()) throw new Error('Describe the maintenance activity.')
    const body: Record<string, unknown> = { component_id: comp.id, maintenance_date: mform.maintenance_date, activity: mform.activity.trim(), repair_or_replacement: mform.repair_or_replacement, maintenance_reference: mform.reference, apply: true }
    if (mform.quantity && mform.value.trim() !== '') {
      const v = Number(mform.value)
      if (!Number.isFinite(v) || v < 0) throw new Error('Damage after maintenance must be a non-negative number.')
      body.damage_after = { [mform.quantity]: v / stateLabel(mform.quantity).scale }
    }
    const r = await api.createMaintenance(body)
    bump()
    pushToast('success', r.update ? r.update.summary : 'Maintenance record stored.')
    setMform({ ...mform, activity: '', value: '' })
  })
  const unit = methods.data?.quantity_units[form.quantity] ?? ''
  const filtered = (list.data ?? []).filter((i) => !selectedComponentId || i.component_id === selectedComponentId)
  const mfiltered = (mnt.data ?? []).filter((m) => !selectedComponentId || m.component_id === selectedComponentId)
  return (
    <div className="space-y-4">
      <PageHeader title="Inspection evidence & maintenance" lede="Component-specific inspection findings are the only evidence that may change an estimated damage state (Stage B); maintenance repairs and replacements reset it. Each record carries method, value, units, uncertainty and provenance; accepted findings are fused with the model estimate and written to the audit trail." />
      <div className="grid xl:grid-cols-3 gap-4">
        <Card title="Record inspection finding" className="xl:col-span-2">
          <div className="grid md:grid-cols-3 gap-3">
            <Field label="Component instance"><select className="input" value={form.component_id} onChange={(e) => setSelectedComponentId(e.target.value)}>{(comps.data ?? []).map((c) => <option key={c.id} value={c.id}>{c.id} — {c.name}{c.model_type ? '' : ' (no model)'}</option>)}</select></Field>
            <Field label="Inspection date"><input type="date" className="input" value={form.inspection_date} onChange={(e) => setForm({ ...form, inspection_date: e.target.value })} /></Field>
            <Field label="Method"><select className="input" value={form.method} onChange={(e) => setForm({ ...form, method: e.target.value })}>{Object.entries(methods.data?.methods ?? {}).map(([k, m]) => <option key={k} value={k}>{m.label}{m.quantitative ? '' : ' (qualitative)'}</option>)}</select></Field>
            <Field label="Observed defect" className="md:col-span-2"><input className="input" value={form.observed_defect} onChange={(e) => setForm({ ...form, observed_defect: e.target.value })} placeholder="e.g. edge crack at lug bore" /></Field>
            <Field label="Confidence"><select className="input" value={form.confidence} onChange={(e) => setForm({ ...form, confidence: e.target.value })}><option value="high">high</option><option value="medium">medium</option><option value="low">low</option></select></Field>
            <Field label="Measured quantity" hint={comp?.model_type ? `Current twin estimate: ${fmtState(form.quantity, comp.state[form.quantity])}` : 'No damage-state variables for this component.'}><select className="input" value={form.quantity} onChange={(e) => setForm({ ...form, quantity: e.target.value })} disabled={!quantities.length}>{quantities.map((q) => <option key={q} value={q}>{stateLabel(q).label} ({methods.data?.quantity_units[q]})</option>)}</select></Field>
            <Field label={`Measured value (${unit})`} hint="Leave empty for a qualitative record."><input className="input" type="number" min={0} step="any" value={form.measured_value} onChange={(e) => setForm({ ...form, measured_value: e.target.value })} /></Field>
            <Field label={`Measurement uncertainty, 1σ (${unit})`} hint="If omitted, 25 % of the value is assumed and confidence reduced."><input className="input" type="number" min={0} step="any" value={form.measurement_uncertainty} onChange={(e) => setForm({ ...form, measurement_uncertainty: e.target.value })} /></Field>
            <Field label="Source / provenance"><input className="input" value={form.source} onChange={(e) => setForm({ ...form, source: e.target.value })} /></Field>
            <Field label="Notes" className="md:col-span-2"><input className="input" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></Field>
          </div>
          <div className="flex flex-wrap items-center gap-2 mt-3">
            <button className="btn-primary" onClick={() => submit.run()} disabled={submit.busy} data-testid="submit-inspection"><ClipboardCheck size={14} /> Submit finding</button>
            <button className="btn-secondary" onClick={() => synthetic.run()} disabled={synthetic.busy || !comp?.model_type} title="Draw a measurement from the hidden reference model (demo aid)"><Wand2 size={14} /> Generate synthetic measurement</button>
            <span className="text-[11.5px] text-ink-3">Synthetic measurements are drawn from the hidden reference model with the stated uncertainty and labelled as such.</span>
          </div>
          <ErrorBox error={submit.error ?? synthetic.error} />
          {last?.update && <div className="mt-3"><Callout kind={last.update.applied ? 'success' : last.update.decision === 'reject' ? 'error' : 'warning'} title={`${DECISION_LABELS[last.update.decision]} — z = ${last.update.z_score.toFixed(2)}`}>{last.update.applied ? `Posterior ${stateLabel(last.quantity ?? '').label}: ${fmt.num(last.update.posterior_value, 5)} ± ${fmt.num(last.update.posterior_sigma, 3)} ${last.update.unit} (1σ). ` : ''}{last.update.reasons.join(' ')}</Callout></div>}
        </Card>
        <Card title="Record maintenance intervention" subtitle="A repair sets the stated damage variable; a replacement resets the whole state to new" dense>
          <div className="space-y-2">
            <Field label="Date"><input type="date" className="input" value={mform.maintenance_date} onChange={(e) => setMform({ ...mform, maintenance_date: e.target.value })} /></Field>
            <Field label="Activity"><input className="input" value={mform.activity} onChange={(e) => setMform({ ...mform, activity: e.target.value })} placeholder="e.g. Piston seal set replaced" /></Field>
            <Field label="Type"><select className="input" value={mform.repair_or_replacement} onChange={(e) => setMform({ ...mform, repair_or_replacement: e.target.value })}><option value="none">none (record only)</option><option value="repair">repair</option><option value="replacement">replacement (new component state)</option></select></Field>
            {mform.repair_or_replacement !== 'none' && (
              <div className="grid grid-cols-2 gap-2">
                <Field label="Damage after"><select className="input" value={mform.quantity} onChange={(e) => setMform({ ...mform, quantity: e.target.value })}><option value="">—</option>{quantities.map((q) => <option key={q} value={q}>{stateLabel(q).label}</option>)}</select></Field>
                <Field label={`Value (${mform.quantity ? stateLabel(mform.quantity).unit : ''})`}><input className="input" type="number" min={0} step="any" value={mform.value} onChange={(e) => setMform({ ...mform, value: e.target.value })} /></Field>
              </div>
            )}
            <Field label="Reference"><input className="input" value={mform.reference} onChange={(e) => setMform({ ...mform, reference: e.target.value })} placeholder="work order" /></Field>
            <button className="btn-primary" onClick={() => addMaint.run()} disabled={addMaint.busy || !comp} data-testid="submit-maintenance"><Wrench size={14} /> Record maintenance</button>
            <ErrorBox error={addMaint.error} />
          </div>
          <div className="mt-3 text-[11.5px] text-ink-2 space-y-1">
            <div><b>Fusion:</b> x_post = (x_model/σ_m² + x_meas/σ_i²)/(1/σ_m² + 1/σ_i²); σ_m grows with flights since the last accepted damage update. A crack found where the model carried none initialises the state at the measurement.</div>
            <div><b>Gate:</b> qualitative method → request more evidence; σ_i &gt; 50 % of value → request more evidence; measurement &gt; 3σ below a monotonic state → reject (contradictory); |z| &gt; 4 or low confidence → reduced confidence.</div>
          </div>
        </Card>
      </div>
      <div className="grid xl:grid-cols-2 gap-4">
        <Card title="Inspection records" subtitle={selectedComponentId ? `Component ${selectedComponentId}` : 'All components'} dense>
          {list.loading && !list.data ? <Spinner /> : filtered.length === 0 ? <div className="text-[12px] text-ink-3">No inspection records for this component yet.</div> : (
            <table className="table text-[12px]"><thead><tr><th>Date</th><th>Method</th><th>Finding</th><th>Measured</th><th>Conf.</th><th>Provenance</th><th>Decision</th><th>Posterior</th></tr></thead>
              <tbody>{filtered.map((i) => <tr key={i.id}><td className="num">{i.inspection_date}</td><td>{i.method_label}</td><td>{i.observed_defect || <span className="text-ink-3">—</span>}</td><td className="num">{i.measured_value != null ? `${i.measured_value} ± ${i.measurement_uncertainty ?? '?'} ${i.unit ?? ''}` : '—'}</td><td>{i.confidence}</td><td><Tag kind={i.provenance} /></td><td>{i.update ? <DecisionPill decision={i.update.decision} /> : <span className="text-ink-3 text-[11px]">no update</span>}</td><td className="num">{i.update?.applied ? `${fmt.num(i.update.posterior_value, 5)} ± ${fmt.num(i.update.posterior_sigma, 3)} ${i.update.unit}` : '—'}</td></tr>)}</tbody></table>
          )}
        </Card>
        <Card title="Maintenance records" subtitle={selectedComponentId ? `Component ${selectedComponentId}` : 'All components'} dense>
          {mnt.loading && !mnt.data ? <Spinner /> : mfiltered.length === 0 ? <div className="text-[12px] text-ink-3">No maintenance records.</div> : (
            <table className="table text-[12px]"><thead><tr><th>Date</th><th>Activity</th><th>Type</th><th>Damage after</th><th>Reference</th><th>Provenance</th><th>Applied</th></tr></thead>
              <tbody>{mfiltered.map((m) => <tr key={m.id}><td className="num">{m.maintenance_date}</td><td>{m.activity}</td><td>{m.repair_or_replacement}</td><td className="num">{m.damage_after ? Object.entries(m.damage_after).map(([k, v]) => `${stateLabel(k).label} ${fmtState(k, v)}`).join(', ') : '—'}</td><td className="num">{m.maintenance_reference}</td><td><Tag kind={m.provenance} /></td><td>{m.applied_in_history ? <span className="text-green">yes</span> : <span className="text-ink-3">pending replay</span>}</td></tr>)}</tbody></table>
          )}
        </Card>
      </div>
    </div>
  )
}
