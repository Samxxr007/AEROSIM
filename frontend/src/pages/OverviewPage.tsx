import { Link } from 'react-router-dom'
import { api } from '../api/client'
import { DemoRunner } from '../components/DemoRunner'
import { SystemDependencyDiagram } from '../components/schematics'
import { Callout, Card, DecisionPill, ErrorBox, PageHeader, Spinner, Stat, StatusPill, Tag } from '../components/ui'
import { useAppStore } from '../store/useAppStore'
import { fmt, fmtState, KEY_METRIC } from '../utils/format'
import { useApi } from '../utils/useApi'

export default function OverviewPage() {
  const refreshKey = useAppStore((s) => s.refreshKey)
  const { data, error, loading } = useApi(() => api.overview(), [refreshKey])
  if (loading && !data) return <Spinner label="Loading dashboard…" />
  if (error) return <ErrorBox error={error} />
  if (!data) return null
  const c = data.counts
  const modelled = data.components.filter((k) => k.model_type)
  const others = data.components.filter((k) => !k.model_type)
  return (
    <div className="space-y-4">
      <PageHeader title="Overview" lede="Per-component digital twins built from each component's own flight observations, inspection findings, maintenance history and engineering specifications. All fleet records are synthetic demonstration data unless tagged otherwise." />

      <Card title="AeroSim — Historical-Data-Driven, Self-Evolving Aircraft Component Digital Twin" subtitle="Learn from every actual flight. Update with reliable inspection evidence. Improve the next component-life prediction.">
        <div className="grid md:grid-cols-5 gap-3 text-[12.5px]">
          <div><div className="label mb-1">Foundation</div>Each physical component instance has its own record: historical sensor observations, inspection findings, maintenance events and specifications. Two parts with the same part number never share a damage state.</div>
          <div><div className="label mb-1">Initialisation</div>The twin's current condition is estimated by replaying the component's own history chronologically: flights advance the physics, inspections correct the damage state, maintenance resets it.</div>
          <div><div className="label mb-1">Pre-flight prediction</div>For the next scheduled flight, conditions come from the schedule first, then from comparable historical flights, then from documented engineering estimates — each field tagged. The prediction is stored immutably with model and input-data versions.</div>
          <div><div className="label mb-1">Post-flight learning</div>The stored prediction is compared with the actual observation of the same flight ID. Reliable residuals may correct only the operational response model (Stage A); only inspection evidence changes the damage state (Stage B); every decision is gated and recorded (Stage C).</div>
          <div><div className="label mb-1">Proposed contribution</div>The controlled separation of operational correction from inspection-confirmed damage updating, evaluated chronologically against a hidden reference model (static vs calibrated vs two-stage). Measured, not asserted.</div>
        </div>
      </Card>

      <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-8 gap-2">
        <Stat label="Aircraft / components" value={`${data.aircraft.length} / ${c.components}`} hint={`${c.modelled_components} with prediction models`} />
        <Stat label="Flights completed / scheduled" value={`${c.flights_completed} / ${c.flights_scheduled}`} />
        <Stat label="Observations on record" value={c.observations} hint="post-flight component records" />
        <Stat label="Pre-flight predictions" value={c.predictions} />
        <Stat label="Reconciliations" value={c.reconciliations} />
        <Stat label="Inspections / maintenance" value={`${c.inspections} / ${c.maintenance}`} />
        <Stat label="Updates applied" value={c.model_updates_applied} tone="good" hint={`${c.model_updates_rejected} not applied`} />
        <Stat label="Requiring review" value={c.review_required} tone={c.review_required > 0 ? 'warn' : 'default'} hint="margin < 25 % or RUL < 100 flights" />
      </div>

      <Card title="Demonstration — flight-by-flight learning loop" subtitle="One action runs the complete historical-data-driven workflow deterministically; every step can also be done manually on the other pages.">
        <DemoRunner initial={data.demo} />
      </Card>

      <Card title="Component digital twins" subtitle={`Aircraft ${data.aircraft.map((a) => `${a.id} (${a.registration_or_demo_id}, ${a.aircraft_type})`).join('; ')}`}>
        <div className="overflow-x-auto">
          <table className="table text-[11.5px]">
            <thead>
              <tr><th>Component</th><th>History</th><th>Latest inspection</th><th>Current estimated state</th><th>Next scheduled flight</th><th>Last prediction</th><th>Last observation</th><th>Last reconciliation</th><th>Latest accepted update</th><th>Next prediction</th></tr>
            </thead>
            <tbody>
              {modelled.map((k) => (
                <tr key={k.id}>
                  <td>
                    <Link to={`/components/${k.id}`} className="text-accent hover:underline num">{k.id}</Link>
                    <div className="text-ink-2">{k.name}</div>
                    <div className="text-ink-3">{k.aircraft_id} · {k.position} · {k.model_type} v{k.model_version} <Tag kind={k.provenance} /></div>
                  </td>
                  <td>
                    {k.history_initialised ? <span className="text-green">initialised</span> : <span className="text-amber">not initialised</span>}
                    <div className="text-ink-3">{k.data_availability?.observations ?? 0} obs · {k.data_availability?.inspections ?? 0} insp · {k.data_availability?.maintenance ?? 0} mnt</div>
                    <div className="text-ink-3">{k.data_availability?.measured_channels.join(', ')}</div>
                  </td>
                  <td>{k.latest_inspection ? <><div>{k.latest_inspection.inspection_date} {k.latest_inspection.method_label}</div><div className="text-ink-3 num">{k.latest_inspection.measured_value != null ? `${k.latest_inspection.measured_value} ± ${k.latest_inspection.measurement_uncertainty} ${k.latest_inspection.unit}` : k.latest_inspection.observed_defect}</div></> : <span className="text-ink-3">none</span>}</td>
                  <td>
                    <div className="num">{fmtState(KEY_METRIC[k.model_type!], k.state[KEY_METRIC[k.model_type!]])}</div>
                    <div className="flex items-center gap-1"><StatusPill status={k.status} /><span className="text-ink-3 num">{k.remaining_life != null ? `${fmt.int(k.remaining_life)} fl.` : ''}</span></div>
                  </td>
                  <td>{k.next_scheduled_flight ? <><div className="num">{k.next_scheduled_flight.id}</div><div className="text-ink-3">{k.next_scheduled_flight.flight_date} · {k.next_scheduled_flight.route_or_mission}</div></> : <span className="text-ink-3">none</span>}</td>
                  <td>{k.last_prediction ? <><div className="num">{k.last_prediction.flight_id} <span className="text-ink-3">v{k.last_prediction.model_version}</span></div><div className="text-ink-3">{k.last_prediction.status}{k.last_prediction.threshold_crossing_fraction != null ? ` · P(cross) ${fmt.pct(k.last_prediction.threshold_crossing_fraction)}` : ''}</div></> : <span className="text-ink-3">none</span>}</td>
                  <td>{k.last_observation ? <><div className="num">{k.last_observation.flight_id}</div><Tag kind={k.last_observation.provenance} /></> : <span className="text-ink-3">none</span>}</td>
                  <td>{k.last_reconciliation ? <><DecisionPill decision={k.last_reconciliation.final_decision ?? k.last_reconciliation.gate.decision} /><div className="text-ink-3 num">forecast {fmt.pct(k.last_reconciliation.forecast_summary?.mean_relative_error)} · response {fmt.pct(k.last_reconciliation.summary.mean_relative_error)}</div></> : <span className="text-ink-3">none</span>}</td>
                  <td>{k.latest_accepted_update ? <><div>{k.latest_accepted_update.stage === 'A_operational' ? 'Stage A' : 'Stage B'} → v{k.latest_accepted_update.version_after}</div><div className="text-ink-3 truncate max-w-[220px]" title={k.latest_accepted_update.summary}>{k.latest_accepted_update.summary}</div></> : <span className="text-ink-3">none</span>}</td>
                  <td className="text-ink-2">{k.next_prediction_status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {others.length > 0 && <div className="text-[11.5px] text-ink-3 mt-2">{others.length} further component instances are registered without a quantitative model: {others.map((o) => o.id).join(', ')}.</div>}
      </Card>

      <div className="grid xl:grid-cols-3 gap-4">
        <Card title="Latest model update" dense>
          {data.latest_update ? (
            <div className="text-[12.5px] space-y-1">
              <div className="flex items-center gap-2"><DecisionPill decision={data.latest_update.decision} /><span className="num text-ink-3">v{data.latest_update.version_before}→v{data.latest_update.version_after}</span>{data.latest_update.flight_id && <span className="num text-ink-3">{data.latest_update.flight_id}</span>}</div>
              <div>{data.latest_update.summary}</div>
              <div className="text-ink-3">{data.latest_update.component_id} · {fmt.date(data.latest_update.created_at)}</div>
            </div>
          ) : <div className="text-[12.5px] text-ink-3">No model update yet. Run the demo or initialise a twin from its history.</div>}
        </Card>
        <Card title="Latest prediction-vs-actual comparison" dense>
          {data.latest_reconciliation ? (
            <div className="text-[12.5px] space-y-1">
              <div className="flex items-center gap-2"><DecisionPill decision={data.latest_reconciliation.gate.decision} /><span className="num">response error {fmt.pct(data.latest_reconciliation.summary.mean_relative_error)}</span></div>
              <div className="text-ink-3">{data.latest_reconciliation.component_id} · {data.latest_reconciliation.flight_id} · model v{data.latest_reconciliation.model_version}</div>
              <Link to="/reconciliation" className="text-accent hover:underline">Open reconciliation →</Link>
            </div>
          ) : <div className="text-[12.5px] text-ink-3">No reconciliation yet.</div>}
        </Card>
        <Card title="Recent activity" dense>
          <ul className="text-[12px] space-y-1.5 max-h-[220px] overflow-y-auto">
            {data.recent_activity.map((a) => (
              <li key={a.id} className="flex gap-2">
                <span className="num text-ink-3 shrink-0 w-[62px]">{new Date(a.created_at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span>
                <span><Tag kind={a.kind}>{a.kind}</Tag> {a.message}</span>
              </li>
            ))}
          </ul>
        </Card>
      </div>
      <Card title="Digital-twin data flow" subtitle="Which evidence may change which part of the twin" dense><SystemDependencyDiagram /></Card>
      <Callout kind="info">{data.data_provenance_note} AeroSim is a research and engineering demonstration prototype; it makes no airworthiness, dispatch or maintenance decisions.</Callout>
    </div>
  )
}
