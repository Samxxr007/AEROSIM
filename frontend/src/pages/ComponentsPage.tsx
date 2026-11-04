import { Plus, Search } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { api } from '../api/client'
import type { ModelType } from '../api/types'
import { Callout, Card, ErrorBox, Field, PageHeader, Spinner, StatusPill, Tag } from '../components/ui'
import { useAppStore } from '../store/useAppStore'
import { fmt, fmtState, KEY_METRIC } from '../utils/format'
import { useAction, useApi } from '../utils/useApi'

export default function ComponentsPage() {
  const refreshKey = useAppStore((s) => s.refreshKey)
  const [q, setQ] = useState('')
  const [system, setSystem] = useState('')
  const [modelled, setModelled] = useState<'all' | 'yes' | 'no'>('all')
  const [showForm, setShowForm] = useState(false)
  const { data, error, loading, refetch } = useApi(() => api.components(), [refreshKey])
  const cat = useApi(() => api.catalogue(), [])
  const aircraft = useApi(() => api.aircraft(), [refreshKey])
  const rows = useMemo(() => (data ?? []).filter((c) => (!system || c.system === system) && (modelled === 'all' || (modelled === 'yes') === !!c.model_type) && (!q || `${c.id} ${c.name} ${c.material} ${c.description} ${c.serial_number} ${c.part_number} ${c.degradation_mechanisms.join(' ')}`.toLowerCase().includes(q.toLowerCase()))), [data, q, system, modelled])
  return (
    <div className="space-y-4">
      <PageHeader title="Component registry" lede="Individual component instances — each with its own aircraft, part and serial number, installation date, baseline condition, history and digital twin. Six instances carry implemented degradation models; the others are registered failure categories awaiting a model." actions={<button className="btn-primary" onClick={() => setShowForm((s) => !s)}><Plus size={14} /> New component instance</button>} />
      {showForm && <NewComponentForm systems={cat.data?.systems ?? []} aircraft={(aircraft.data ?? []).map((a) => a.id)} onDone={() => { setShowForm(false); refetch() }} />}
      <Card dense>
        <div className="flex flex-wrap items-end gap-3">
          <Field label="Search" className="w-[300px]"><div className="relative"><Search size={13} className="absolute left-2 top-2.5 text-ink-3" /><input className="input pl-7" placeholder="ID, name, S/N, material, mechanism…" value={q} onChange={(e) => setQ(e.target.value)} /></div></Field>
          <Field label="System" className="w-[240px]"><select className="input" value={system} onChange={(e) => setSystem(e.target.value)}><option value="">All systems</option>{(cat.data?.systems ?? []).map((s) => <option key={s} value={s}>{s}</option>)}</select></Field>
          <Field label="Prediction model" className="w-[180px]"><select className="input" value={modelled} onChange={(e) => setModelled(e.target.value as 'all' | 'yes' | 'no')}><option value="all">All</option><option value="yes">Implemented</option><option value="no">Catalogue only</option></select></Field>
          <div className="text-[12px] text-ink-3 pb-2">{rows.length} of {data?.length ?? 0} instances</div>
        </div>
      </Card>
      {loading && !data && <Spinner />}
      <ErrorBox error={error} />
      {data && (
        <Card dense>
          <div className="overflow-x-auto">
            <table className="table whitespace-nowrap text-[12px]">
              <thead><tr><th>Component ID</th><th>Name</th><th>Aircraft · position</th><th>P/N · S/N · installed</th><th>System</th><th>Material</th><th>History</th><th>Current key state</th><th>Governing RUL</th><th>Status</th><th>Model</th><th>Provenance</th></tr></thead>
              <tbody>
                {rows.map((c) => (
                  <tr key={c.id}>
                    <td className="num"><Link to={`/components/${c.id}`} className="text-accent hover:underline">{c.id}</Link></td>
                    <td><Link to={`/components/${c.id}`} className="hover:underline">{c.name}</Link></td>
                    <td className="text-ink-2">{c.aircraft_id} · {c.position || '—'}</td>
                    <td className="num text-ink-2">{c.part_number} · {c.serial_number} · {c.installation_date}</td>
                    <td className="text-ink-2">{c.system}</td>
                    <td className="text-ink-2">{c.material}</td>
                    <td>{c.model_type ? (c.history_initialised ? <span className="text-green">initialised ({c.evidence_summary?.completed_flights_with_observations} fl / {c.evidence_summary?.inspections} insp / {c.evidence_summary?.maintenance_records} mnt)</span> : <span className="text-amber">baseline only</span>) : '—'}</td>
                    <td className="num">{c.model_type ? fmtState(KEY_METRIC[c.model_type], c.state[KEY_METRIC[c.model_type]]) : '—'}</td>
                    <td className="num">{c.assessment.remaining_life?.governing_remaining_flights != null ? `${fmt.int(c.assessment.remaining_life.governing_remaining_flights)} flights` : '—'}</td>
                    <td><StatusPill status={c.assessment.status} /></td>
                    <td className="num">{c.model_type ? `${c.model_type} v${c.model_version}` : <span className="text-ink-3">none</span>}</td>
                    <td><Tag kind={c.provenance} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
      {cat.data && (
        <Card title="Extended failure catalogue" subtitle="Registered failure categories. Only those marked are backed by an implemented quantitative model in this prototype.">
          <div className="grid md:grid-cols-3 gap-3 text-[12px]">
            {Object.entries(cat.data.failure_catalogue).map(([group, items]) => (
              <div key={group}><div className="font-semibold mb-1">{group}</div>
                <ul className="space-y-0.5">{items.map((it) => <li key={it} className="flex items-center gap-1.5"><span className={`inline-block w-1.5 h-1.5 rounded-full ${cat.data!.implemented[it] ? 'bg-accent' : 'bg-line-strong'}`} /><span className={cat.data!.implemented[it] ? 'text-ink' : 'text-ink-2'}>{it}</span>{cat.data!.implemented[it] && <span className="text-[10px] text-accent">model: {cat.data!.implemented[it]}</span>}</li>)}</ul>
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  )
}

function NewComponentForm({ systems, aircraft, onDone }: { systems: string[]; aircraft: string[]; onDone: () => void }) {
  const navigate = useNavigate()
  const pushToast = useAppStore((s) => s.pushToast)
  const [form, setForm] = useState({ id: '', aircraft_id: aircraft[0] ?? 'AIRCRAFT-001', name: '', system: systems[0] ?? 'Airframe and structures', position: '', material: '', manufacturer: '', part_number: '', serial_number: '', installation_date: '2026-01-01', description: '', model_type: '' as '' | ModelType, initial_condition: '', mechanisms: '' })
  const [initCrack, setInitCrack] = useState('')
  const action = useAction(async () => {
    if (!form.name.trim()) throw new Error('Name is required.')
    const state: Record<string, number> = {}
    if (form.model_type === 'engine_mount' || form.model_type === 'landing_gear') {
      const a = Number(initCrack)
      if (initCrack !== '' && (!Number.isFinite(a) || a < 0)) throw new Error('Initial crack length must be a non-negative number in mm.')
      if (initCrack !== '') state.crack_length_m = a / 1e3
    }
    const c = await api.createComponent({ id: form.id.trim() || undefined, aircraft_id: form.aircraft_id || null, name: form.name.trim(), system: form.system, position: form.position, material: form.material, manufacturer: form.manufacturer, part_number: form.part_number, serial_number: form.serial_number, installation_date: form.installation_date, description: form.description, model_type: form.model_type || null, initial_condition: form.initial_condition, degradation_mechanisms: form.mechanisms.split(',').map((s) => s.trim()).filter(Boolean), state, provenance: 'manual' })
    pushToast('success', `Component instance ${c.id} created.`)
    onDone()
    navigate(`/components/${c.id}`)
  })
  return (
    <Card title="New component instance" subtitle="Model parameters default to the illustrative values of the selected model; the entered state becomes the documented baseline (provenance: manual input).">
      <div className="grid md:grid-cols-4 gap-3">
        <Field label="Component ID (optional)"><input className="input" value={form.id} onChange={(e) => setForm({ ...form, id: e.target.value })} placeholder="e.g. WING-SPAR-002" /></Field>
        <Field label="Aircraft"><select className="input" value={form.aircraft_id} onChange={(e) => setForm({ ...form, aircraft_id: e.target.value })}>{aircraft.map((a) => <option key={a}>{a}</option>)}</select></Field>
        <Field label="Name"><input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
        <Field label="Position"><input className="input" value={form.position} onChange={(e) => setForm({ ...form, position: e.target.value })} placeholder="e.g. LH" /></Field>
        <Field label="System"><select className="input" value={form.system} onChange={(e) => setForm({ ...form, system: e.target.value })}>{systems.map((s) => <option key={s}>{s}</option>)}</select></Field>
        <Field label="Manufacturer"><input className="input" value={form.manufacturer} onChange={(e) => setForm({ ...form, manufacturer: e.target.value })} /></Field>
        <Field label="Part number"><input className="input" value={form.part_number} onChange={(e) => setForm({ ...form, part_number: e.target.value })} /></Field>
        <Field label="Serial number"><input className="input" value={form.serial_number} onChange={(e) => setForm({ ...form, serial_number: e.target.value })} /></Field>
        <Field label="Installation date"><input type="date" className="input" value={form.installation_date} onChange={(e) => setForm({ ...form, installation_date: e.target.value })} /></Field>
        <Field label="Material"><input className="input" value={form.material} onChange={(e) => setForm({ ...form, material: e.target.value })} /></Field>
        <Field label="Degradation model" hint="Leave empty for a catalogue-only entry.">
          <select className="input" value={form.model_type} onChange={(e) => setForm({ ...form, model_type: e.target.value as '' | ModelType })}>
            <option value="">None (catalogue entry)</option><option value="engine_mount">Engine mount — fatigue + crack growth</option><option value="landing_gear">Landing gear — fatigue + crack + corrosion</option><option value="turbine_blade">Turbine blade — creep + thermal fatigue</option><option value="hydraulic_actuator">Hydraulic actuator — seal wear</option>
          </select>
        </Field>
        {(form.model_type === 'engine_mount' || form.model_type === 'landing_gear') && <Field label="Initial crack length (mm)" hint="0 or empty = no detected crack"><input className="input" type="number" min={0} step={0.1} value={initCrack} onChange={(e) => setInitCrack(e.target.value)} /></Field>}
        <Field label="Known mechanisms (comma-separated)" className="md:col-span-2"><input className="input" value={form.mechanisms} onChange={(e) => setForm({ ...form, mechanisms: e.target.value })} /></Field>
        <Field label="Description" className="md:col-span-2"><input className="input" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></Field>
        <Field label="Initial condition" className="md:col-span-2"><input className="input" value={form.initial_condition} onChange={(e) => setForm({ ...form, initial_condition: e.target.value })} /></Field>
      </div>
      <div className="flex items-center gap-2 mt-3"><button className="btn-primary" onClick={() => action.run()} disabled={action.busy}>Create component instance</button><button className="btn-secondary" onClick={onDone}>Cancel</button></div>
      {action.error ? <div className="mt-2"><ErrorBox error={action.error} /></div> : null}
      <div className="mt-2"><Callout kind="info">Historical observations, inspections and maintenance for the new instance can be imported on Settings & data; the twin is then initialised from that history.</Callout></div>
    </Card>
  )
}
