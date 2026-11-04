import { PlaneLanding, Plus } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api/client'
import type { Flight } from '../api/types'
import { Callout, Card, ErrorBox, Field, PageHeader, Spinner, Tag } from '../components/ui'
import { useAppStore } from '../store/useAppStore'
import { CONDITION_LABELS, fmt } from '../utils/format'
import { useAction, useApi } from '../utils/useApi'

export default function FlightsPage() {
  const { pushToast, refreshKey, bump } = useAppStore()
  const aircraft = useApi(() => api.aircraft(), [refreshKey])
  const [acId, setAcId] = useState('AIRCRAFT-001')
  const flights = useApi(() => api.flights({ aircraft_id: acId }), [acId, refreshKey])
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({ flight_date: '2026-11-20', route_or_mission: 'DEMO-A → DEMO-B', duration_min: '120', landing_cycles: '1', payload_fraction: '0.75', expected_temperature_c: '18', expected_environment: 'benign', notes: '' })
  const create = useAction(async () => {
    const dur = Number(form.duration_min)
    if (!Number.isFinite(dur) || dur < 5) throw new Error('Duration must be at least 5 minutes.')
    const f = await api.createFlight({ aircraft_id: acId, flight_date: form.flight_date, route_or_mission: form.route_or_mission, duration_min: dur, landing_cycles: Number(form.landing_cycles) || 1, payload_fraction: form.payload_fraction === '' ? null : Number(form.payload_fraction), expected_temperature_c: form.expected_temperature_c === '' ? null : Number(form.expected_temperature_c), expected_environment: form.expected_environment || null, notes: form.notes })
    pushToast('success', `Scheduled flight ${f.id} entered.`)
    setShowForm(false)
    bump()
  })
  const complete = useAction(async (flightId: string) => {
    const r = await api.completeFlight(flightId)
    pushToast('success', `${flightId} flown (synthetic reference aircraft); ${r.observation_ids.length} component observations recorded.`)
    bump()
  })
  const scheduled = (flights.data ?? []).filter((f) => f.status === 'scheduled')
  const completed = (flights.data ?? []).filter((f) => f.status === 'completed').slice().reverse()
  return (
    <div className="space-y-4">
      <PageHeader title="Flights" lede="Upcoming schedule (information known before the flight) and completed flight history (actual as-flown conditions and the component observations attached to each flight ID). Scheduled and actual information are stored separately so that no pre-flight prediction can use post-flight data." actions={<button className="btn-primary" onClick={() => setShowForm((s) => !s)}><Plus size={14} /> Enter scheduled flight</button>} />
      <Card dense>
        <div className="flex flex-wrap items-end gap-3">
          <Field label="Aircraft" className="w-[420px]">
            <select className="input" value={acId} onChange={(e) => setAcId(e.target.value)}>
              {(aircraft.data ?? []).map((a) => <option key={a.id} value={a.id}>{a.id} — {a.registration_or_demo_id} · {a.aircraft_type}</option>)}
            </select>
          </Field>
          {aircraft.data?.find((a) => a.id === acId) && <div className="text-[12px] text-ink-2 pb-2">{aircraft.data.find((a) => a.id === acId)!.components?.length} component instances · {aircraft.data.find((a) => a.id === acId)!.flights_completed} completed · {aircraft.data.find((a) => a.id === acId)!.flights_scheduled} scheduled <Tag kind={aircraft.data.find((a) => a.id === acId)!.provenance} /></div>}
        </div>
      </Card>
      {showForm && (
        <Card title="Enter a known upcoming flight" subtitle="Only information available before the flight. Operating conditions not entered here are estimated from comparable historical flights when a prediction is made.">
          <div className="grid md:grid-cols-4 gap-3">
            <Field label="Flight date"><input type="date" className="input" value={form.flight_date} onChange={(e) => setForm({ ...form, flight_date: e.target.value })} /></Field>
            <Field label="Route / mission identifier"><input className="input" value={form.route_or_mission} onChange={(e) => setForm({ ...form, route_or_mission: e.target.value })} /></Field>
            <Field label="Planned duration (min)"><input type="number" className="input" value={form.duration_min} onChange={(e) => setForm({ ...form, duration_min: e.target.value })} /></Field>
            <Field label="Landing cycles"><input type="number" className="input" value={form.landing_cycles} onChange={(e) => setForm({ ...form, landing_cycles: e.target.value })} /></Field>
            <Field label="Planned payload fraction (0–1)" hint="optional; drives the planned load factor"><input type="number" step="0.05" className="input" value={form.payload_fraction} onChange={(e) => setForm({ ...form, payload_fraction: e.target.value })} /></Field>
            <Field label="Forecast temperature (°C)" hint="optional"><input type="number" className="input" value={form.expected_temperature_c} onChange={(e) => setForm({ ...form, expected_temperature_c: e.target.value })} /></Field>
            <Field label="Expected environment"><select className="input" value={form.expected_environment} onChange={(e) => setForm({ ...form, expected_environment: e.target.value })}><option value="">unknown</option><option>benign</option><option>humid</option><option>marine</option><option>desert</option></select></Field>
            <Field label="Notes"><input className="input" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></Field>
          </div>
          <div className="flex gap-2 mt-3"><button className="btn-primary" onClick={() => create.run()} disabled={create.busy}>Save scheduled flight</button><button className="btn-secondary" onClick={() => setShowForm(false)}>Cancel</button></div>
          <ErrorBox error={create.error} />
        </Card>
      )}
      {flights.loading && !flights.data && <Spinner />}
      <ErrorBox error={flights.error} />
      <Card title="Upcoming flight schedule" subtitle="Known before the flight · missing conditions are indicated" dense>
        {scheduled.length === 0 ? <div className="text-[12px] text-ink-3">No scheduled flights. Enter one above or import a schedule on Settings & data.</div> : (
          <table className="table">
            <thead><tr><th>Flight</th><th>Date</th><th>Route</th><th>Planned duration</th><th>Payload</th><th>Forecast T</th><th>Environment</th><th>Not in schedule</th><th>Predictions</th><th></th></tr></thead>
            <tbody>
              {scheduled.map((f: Flight) => (
                <tr key={f.id}>
                  <td className="num">{f.id} <Tag kind={f.provenance} /></td>
                  <td className="num">{f.flight_date}</td>
                  <td>{f.route_or_mission}</td>
                  <td className="num">{f.scheduled.duration_min} min</td>
                  <td className="num">{f.scheduled.payload_fraction != null ? fmt.pct(f.scheduled.payload_fraction, 0) : <span className="text-amber">missing</span>}</td>
                  <td className="num">{f.scheduled.expected_temperature_c != null ? `${f.scheduled.expected_temperature_c} °C` : <span className="text-amber">missing</span>}</td>
                  <td>{f.scheduled.expected_environment ?? <span className="text-amber">missing</span>}</td>
                  <td className="text-ink-3 text-[11px]">load variation, manoeuvre, vibration, intensity → from comparable flights</td>
                  <td className="num">{f.predictions?.length ? f.predictions.map((p) => <div key={p.id}><Link className="text-accent" to={`/predictions?prediction=${p.id}`}>{p.component_id}</Link> <span className="text-ink-3">{p.status}</span></div>) : <span className="text-ink-3">none yet</span>}</td>
                  <td><button className="btn-secondary" onClick={() => complete.run(f.id)} disabled={complete.busy} title="Demonstration: the reference aircraft flies this flight and synthetic observations are generated for every modelled component"><PlaneLanding size={13} /> Complete flight (synthetic)</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <ErrorBox error={complete.error} />
        <div className="text-[11px] text-ink-3 mt-2">In operation, a flight is completed by importing its actual conditions (flight_actuals.csv) and component observations (flight_observations.csv). The button generates both from the hidden reference model for the demonstration.</div>
      </Card>
      <Card title="Flight history" subtitle="Completed flights with as-flown conditions and the component observations attached to each flight ID" dense>
        {completed.length === 0 ? <div className="text-[12px] text-ink-3">No completed flights.</div> : (
          <div className="overflow-x-auto">
            <table className="table whitespace-nowrap text-[12px]">
              <thead><tr><th>Flight</th><th>Date</th><th>Route</th><th>Planned → actual duration</th>{['load_factor', 'manoeuvre_intensity', 'temperature_c', 'vibration_level', 'operating_intensity', 'environment'].map((k) => <th key={k}>{CONDITION_LABELS[k]}</th>)}<th>Observations</th><th>Predictions</th><th>Source</th></tr></thead>
              <tbody>
                {completed.map((f: Flight) => (
                  <tr key={f.id}>
                    <td className="num"><Link className="text-accent" to={`/predictions?flight=${f.id}`}>{f.id}</Link></td>
                    <td className="num">{f.flight_date}</td>
                    <td>{f.route_or_mission}</td>
                    <td className="num">{f.scheduled.duration_min} → {f.actual?.duration_min} min</td>
                    {['load_factor', 'manoeuvre_intensity', 'temperature_c', 'vibration_level', 'operating_intensity', 'environment'].map((k) => <td key={k} className="num">{(f.actual as Record<string, unknown> | null)?.[k] as string ?? '—'}</td>)}
                    <td className="num">{f.observations?.length ?? 0} <span className="text-ink-3">({f.observations?.map((o) => o.component_id.split('-')[0]).filter((v, i, a) => a.indexOf(v) === i).join(', ')})</span></td>
                    <td className="num">{f.predictions?.length ?? 0}</td>
                    <td className="text-ink-3">{f.completion_source ?? f.actual?.source}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      <Callout kind="warning">Synthetic flights are flown by the hidden reference aircraft model; their observations are labelled SYNTHETIC ACTUAL-FLIGHT OBSERVATION — SIMULATED GROUND TRUTH and are never represented as real telemetry.</Callout>
    </div>
  )
}
