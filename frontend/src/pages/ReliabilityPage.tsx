import { useMemo, useState } from 'react'
import { api } from '../api/client'
import { Card, Callout, ErrorBox, Field, PageHeader, Tag } from '../components/ui'
import { useAppStore } from '../store/useAppStore'
import { useApi } from '../utils/useApi'

type TrustResult = {
  decision?: string
  score?: number
  reasons?: string[]
  eligible_for_operational_calibration?: boolean
  eligible_for_damage_update?: boolean
  damage_update_note?: string
}
type CalibrationResult = {
  status?: string
  calibrated?: boolean
  calibration_count?: number
  minimum_required?: number
  point_estimate?: number
  interval?: { lower: number; upper: number; unit: string } | null
  interval_width?: number
  empirical_calibration_coverage?: number
  reason?: string
  assumptions?: string[]
}
type FederatedResult = {
  status?: string
  algorithm?: string
  eligible_clients?: number
  sample_count_total?: number
  shared_parameters?: Record<string, number> | null
  raw_records_shared?: boolean
  reason?: string
  security_note?: string
  local_personalization?: string
  rejected_clients?: { client_id: string; reason: string }[]
}

const demoRecords = [
  { record_id: 'SENSOR-OK-001', source: 'flight-recorder-A', provenance: 'uploaded', event_time: '2026-10-29T08:15:00+00:00', component_id: 'ENG-MOUNT-001', aircraft_id: 'AC001', flight_id: 'AC001-2026-10-29-01', expected_component_id: 'ENG-MOUNT-001', required_fields: ['temperature_c', 'vibration'], payload: { temperature_c: 420, vibration: 2.8 }, numeric_values: { temperature_c: 420, vibration: 2.8 }, engineering_bounds: { temperature_c: { min: -50, max: 900 }, vibration: { min: 0, max: 30 } }, sensor_quality: 'good' },
  { record_id: 'SENSOR-CONFLICT-002', source: 'maintenance-export-B', provenance: 'uploaded', component_id: 'ENG-MOUNT-001', expected_component_id: 'ENG-MOUNT-001', cross_source_conflict: true, required_fields: ['temperature_c'], payload: { temperature_c: 430 }, numeric_values: { temperature_c: 430 } },
  { record_id: 'SENSOR-INVALID-003', source: 'unknown-sensor', provenance: 'uploaded', component_id: 'ENG-MOUNT-001', expected_component_id: 'ENG-MOUNT-001', numeric_values: { stress_mpa: 950 }, engineering_bounds: { stress_mpa: { min: 0, max: 500 } } },
]

export default function ReliabilityPage() {
  const { selectedComponentId } = useAppStore()
  const [trustRows] = useState(demoRecords)
  const [trustResult, setTrustResult] = useState<{ total?: number; counts?: Record<string, number>; records?: TrustResult[] } | null>(null)
  const [trustBusy, setTrustBusy] = useState(false)
  const [trustError, setTrustError] = useState<unknown>(null)
  const [calibration, setCalibration] = useState<CalibrationResult | null>(null)
  const [calibrationBusy, setCalibrationBusy] = useState(false)
  const [calibrationError, setCalibrationError] = useState<unknown>(null)
  const [fed, setFed] = useState<FederatedResult | null>(null)
  const [fedError, setFedError] = useState<unknown>(null)
  const [fedBusy, setFedBusy] = useState(false)
  const trustSummary = useApi(() => api.dataTrustSummary(), [])
  const selectedRecords = useMemo(() => trustRows.filter((r) => r.component_id === selectedComponentId), [trustRows, selectedComponentId])

  async function evaluateTrust() {
    setTrustBusy(true); setTrustError(null)
    try { setTrustResult(await api.dataTrustBatch(trustRows)) } catch (e) { setTrustError(e) } finally { setTrustBusy(false) }
  }
  async function calibrate() {
    setCalibrationBusy(true); setCalibrationError(null)
    try { setCalibration(await api.conformalRul(selectedComponentId) as CalibrationResult) } catch (e) { setCalibrationError(e) } finally { setCalibrationBusy(false) }
  }
  async function runFederated() {
    setFedBusy(true); setFedError(null)
    try {
      setFed(await api.federatedAggregate([
        { client_id: 'Operator-A', sample_count: 120, parameters: { load_transfer_factor: 1.04, thermal_response_factor: 0.98, vibration_response_factor: 1.02 } },
        { client_id: 'Operator-B', sample_count: 85, parameters: { load_transfer_factor: 1.01, thermal_response_factor: 1.03, vibration_response_factor: 1.00 } },
        { client_id: 'Operator-C', sample_count: 60, parameters: { load_transfer_factor: 1.06, thermal_response_factor: 1.00, vibration_response_factor: 1.04 } },
      ]) as FederatedResult)
    } catch (e) { setFedError(e) } finally { setFedBusy(false) }
  }

  return <div className="space-y-4">
    <PageHeader title="Reliability & collaborative learning" lede="Data provenance and quality screening, chronological conformal RUL calibration, and an optional multi-operator federated aggregation demonstrator." />
    <div className="grid xl:grid-cols-2 gap-4">
      <Card title="1 · Data Trust Gate" subtitle="Evaluate incoming records before operational calibration. A sensor anomaly is never converted directly into component damage." dense>
        <div className="flex flex-wrap items-center gap-2 mb-2">
          <Tag kind="info">Accept</Tag><Tag kind="assumption">Reduced confidence</Tag><Tag kind="warn">Quarantine</Tag><Tag kind="bad">Reject</Tag>
        </div>
        <div className="text-[11.5px] text-ink-3 mb-2">Demo set: {trustRows.length} records · {selectedRecords.length} currently linked to {selectedComponentId}</div>
        <button className="btn-primary" onClick={evaluateTrust} disabled={trustBusy}>{trustBusy ? 'Evaluating…' : 'Evaluate incoming records'}</button>
        <ErrorBox error={trustError as Error | null} />
        {trustResult && <div className="mt-3 space-y-2">
          <div className="grid grid-cols-4 gap-1 text-center text-[11px]">
            {Object.entries(trustResult.counts ?? {}).map(([k,v]) => <div className="border border-line rounded p-2" key={k}><div className="num text-lg">{v}</div><div className="text-ink-3">{k.replaceAll('_',' ')}</div></div>)}
          </div>
          {(trustResult.records ?? []).map((r,i) => <div className="border border-line rounded p-2 text-[11.5px]" key={i}>
            <div className="flex justify-between gap-2"><b>{String((r as TrustResult & {record_id?:string}).record_id ?? 'record')}</b><Tag kind={r.decision === 'accept' ? 'good' : r.decision === 'reject' ? 'bad' : r.decision === 'quarantine' ? 'warn' : 'assumption'}>{r.decision}</Tag></div>
            <div className="text-ink-3 mt-1">Trust score {r.score ?? '—'} · operational calibration: {r.eligible_for_operational_calibration ? 'eligible' : 'blocked'} · damage update: never via this gate</div>
            {(r.reasons ?? []).map((reason) => <div className="text-ink-2 mt-1" key={reason}>• {reason}</div>)}
          </div>)}
        </div>}
        <div className="mt-3 text-[11px] text-ink-3">Persisted decisions: {String((trustSummary.data as {total?:number} | undefined)?.total ?? '—')}</div>
      </Card>
      <Card title="2 · Conformal RUL calibration" subtitle="Calibrates a point RUL estimate using chronological, paired historical predicted/actual RUL residuals." dense>
        <Callout kind="info">Existing Monte Carlo P5/P50/P95 outputs remain uncalibrated sample percentiles. This section uses a separate residual-calibration set.</Callout>
        <button className="btn-primary mt-3" onClick={calibrate} disabled={calibrationBusy}>{calibrationBusy ? 'Calibrating…' : 'Calibrate selected component'}</button>
        <ErrorBox error={calibrationError as Error | null} />
        {calibration && <div className="mt-3 border border-line rounded p-3 text-[12px] space-y-2">
          <div className="flex items-center gap-2"><Tag kind={calibration.calibrated ? 'good' : 'warn'}>{calibration.status}</Tag><span className="text-ink-3">{calibration.calibration_count ?? 0} / {calibration.minimum_required ?? 20} calibration records</span></div>
          {calibration.interval ? <div className="grid grid-cols-3 gap-2">
            <Metric label="Point RUL" value={calibration.point_estimate} />
            <Metric label="Lower bound" value={calibration.interval.lower} />
            <Metric label="Upper bound" value={calibration.interval.upper} />
          </div> : <p className="text-ink-2">{calibration.reason ?? 'More chronological RUL residuals are required.'}</p>}
          {calibration.empirical_calibration_coverage != null && <div>Empirical calibration coverage: {(calibration.empirical_calibration_coverage*100).toFixed(1)}%</div>}
          {(calibration.assumptions ?? []).map((a) => <p className="text-ink-3" key={a}>• {a}</p>)}
        </div>}
        <RulRecordForm componentId={selectedComponentId} onSaved={() => setCalibration(null)} />
      </Card>
    </div>
    <Card title="3 · Federated learning extension" subtitle="Three synthetic operator nodes contribute model parameters; raw flight and component records stay local." dense>
      <div className="grid md:grid-cols-3 gap-2 mb-3">
        {['Operator A','Operator B','Operator C'].map((x) => <div className="border border-line rounded p-3" key={x}><div className="font-medium text-[12px]">{x}</div><div className="text-[11px] text-ink-3">Local component history · local twin state · local adaptation</div><div className="text-[10px] mt-2 text-green">Only model parameter update submitted</div></div>)}
      </div>
      <div className="flex items-center gap-3 flex-wrap"><button className="btn-primary" onClick={runFederated} disabled={fedBusy}>{fedBusy ? 'Aggregating…' : 'Run federated aggregation demo'}</button><span className="text-[11px] text-ink-3">Sample-count-weighted FedAvg · no raw records transferred</span></div>
      <ErrorBox error={fedError as Error | null} />
      {fed && <div className="mt-3 border border-line rounded p-3 text-[12px]">
        <div className="flex gap-2 items-center"><Tag kind={fed.status === 'aggregated' ? 'good' : 'warn'}>{fed.status}</Tag><span className="text-ink-3">{fed.eligible_clients ?? 0} eligible operators · {fed.sample_count_total ?? 0} local samples</span></div>
        {fed.shared_parameters && <table className="table mt-2"><thead><tr><th>Shared parameter</th><th>Aggregated value</th></tr></thead><tbody>{Object.entries(fed.shared_parameters).map(([k,v]) => <tr key={k}><td>{k}</td><td className="num">{v.toFixed(5)}</td></tr>)}</tbody></table>}
        <p className="text-ink-3 mt-2">{fed.security_note}</p>
      </div>}
      <Callout kind="warning" title="Extension prototype, not a secure deployment">Federated aggregation does not by itself guarantee privacy. Authentication, secure aggregation, differential privacy, poisoning defence and governance are not implemented. Local personalization and component histories remain separate.</Callout>
    </Card>
  </div>
}

function Metric({label, value}:{label:string; value?:number}) {
  return <div className="border border-line rounded p-2"><div className="text-ink-3 text-[10px]">{label}</div><div className="num text-lg">{value?.toFixed(1) ?? '—'} <span className="text-[10px]">flights</span></div></div>
}

function RulRecordForm({componentId,onSaved}:{componentId:string;onSaved:()=>void}) {
  const [flightId,setFlightId]=useState('')
  const [eventTime,setEventTime]=useState('')
  const [predicted,setPredicted]=useState('')
  const [actual,setActual]=useState('')
  const [message,setMessage]=useState('')
  const [busy,setBusy]=useState(false)
  async function save() {
    setBusy(true); setMessage('')
    try {
      await api.addRulCalibrationRecord(componentId,{flight_id:flightId,event_time:eventTime,predicted_rul:Number(predicted),actual_rul:Number(actual),provenance:'manual_calibration_target'})
      setMessage('Calibration pair stored for this component. Re-run calibration to include it.')
      onSaved()
    } catch(e) { setMessage(e instanceof Error ? e.message : 'Could not save calibration record.') }
    finally { setBusy(false) }
  }
  return <div className="mt-4 pt-3 border-t border-line">
    <div className="text-[12px] font-medium mb-2">Add historical calibration pair</div>
    <div className="grid md:grid-cols-2 gap-2">
      <Field label="Completed flight ID"><input className="input" value={flightId} onChange={e=>setFlightId(e.target.value)} placeholder="AC001-FLT-001" /></Field>
      <Field label="Flight event timestamp"><input className="input" type="datetime-local" value={eventTime} onChange={e=>setEventTime(e.target.value)} /></Field>
      <Field label="RUL predicted before flight (flights)"><input className="input" type="number" min="0" value={predicted} onChange={e=>setPredicted(e.target.value)} /></Field>
      <Field label="Observed/target RUL (flights)"><input className="input" type="number" min="0" value={actual} onChange={e=>setActual(e.target.value)} /></Field>
    </div>
    <button className="btn-secondary mt-2" disabled={busy || !flightId || !eventTime || predicted === '' || actual === ''} onClick={save}>{busy ? 'Saving…' : 'Save calibration pair'}</button>
    {message && <div className="text-[11px] text-ink-3 mt-2">{message}</div>}
  </div>
}
