import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api/client'
import { Callout, Card, ErrorBox, PageHeader, Spinner, Tag } from '../components/ui'
import { useAppStore } from '../store/useAppStore'
import { useApi } from '../utils/useApi'

type Action = { priority: string; action: string; basis: string; timing: string }
type Driver = { factor: string; severity: string; evidence: string }
type Recommendation = {
  component_id: string; component_name: string; risk_score: number; risk_level: string
  assessment_status: string; potential_consequences: string[]; governing_mechanism?: string; remaining_life_flights?: number | null
  minimum_margin?: number | null; risk_drivers: Driver[]
  related_components: { component_id: string; name: string; relationship: string; assessment_status?: string; review_required: boolean }[]
  maintenance_context?: { maintenance_date?: string; activity?: string; repair_or_replacement?: string; days_since?: number | null; reference?: string } | null
  upcoming_flight?: { id?: string; flight_date?: string; route_or_mission?: string; operational_stressors?: string[] } | null
  recommended_actions: Action[]; relationship_note: string; limitations: string[]
}
type FleetResult = { count: number; risk_distribution: Record<string, number>; recommendations: Recommendation[] }

const riskKind = (level: string) => level === 'critical' ? 'bad' : level === 'high' ? 'warn' : level === 'moderate' ? 'assumption' : 'good'
const priorityKind = (p: string) => p === 'urgent' || p === 'high' ? 'bad' : p === 'medium' ? 'warn' : 'info'

export default function MaintenanceIntelligencePage() {
  const refreshKey = useAppStore((s) => s.refreshKey)
  const [level, setLevel] = useState('all')
  const [selected, setSelected] = useState('')
  const { data, error, loading, refetch } = useApi(() => api.maintenanceIntelligence() as Promise<FleetResult>, [refreshKey])
  const rows = useMemo(() => (data?.recommendations ?? []).filter(r => level === 'all' || r.risk_level === level), [data, level])
  const active = rows.find(r => r.component_id === selected) ?? rows[0]
  return <div className="space-y-4">
    <PageHeader title="Maintenance intelligence & risk mitigation" lede="Connect component degradation, failure consequences, related component condition and upcoming mission exposure to produce explainable maintenance and operational mitigation recommendations." actions={<button className="btn-secondary" onClick={() => refetch()}>Refresh assessment</button>} />
    <Callout kind="warning" title="Advisory research prototype">Risk scores are prioritisation indices, not probabilities of failure. Recommendations do not replace approved maintenance data, OEM limits, licensed engineering judgement or dispatch authority.</Callout>
    {loading && !data && <Spinner />}
    <ErrorBox error={error} />
    {data && <>
      <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
        <Card dense><div className="text-[11px] text-ink-3">Assessed components</div><div className="num text-2xl">{data.count}</div></Card>
        {(['critical','high','moderate','low'] as const).map(k => <Card dense key={k}><div className="text-[11px] text-ink-3 capitalize">{k} risk</div><div className="num text-2xl">{data.risk_distribution?.[k] ?? 0}</div></Card>)}
      </div>
      <div className="grid xl:grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)] gap-4">
        <Card title="Fleet risk register" subtitle="Ranked by transparent condition and context rules" dense>
          <div className="flex gap-2 flex-wrap mb-3">
            {['all','critical','high','moderate','low'].map(v => <button key={v} onClick={() => {setLevel(v);setSelected('')}} className={`px-2 py-1 rounded border text-[11px] ${level===v?'border-accent bg-accent/10 text-accent':'border-line text-ink-2'}`}>{v === 'all' ? 'All' : v[0].toUpperCase()+v.slice(1)}</button>)}
          </div>
          <div className="space-y-1.5 max-h-[680px] overflow-y-auto">
            {rows.map(r => <button key={r.component_id} onClick={() => setSelected(r.component_id)} className={`w-full text-left p-2.5 rounded border ${active?.component_id===r.component_id?'border-accent bg-accent/5':'border-line hover:bg-surface-2'}`}>
              <div className="flex justify-between gap-2 items-center"><span className="font-medium text-[12px]">{r.component_name}</span><Tag kind={riskKind(r.risk_level)}>{r.risk_level}</Tag></div>
              <div className="flex justify-between mt-1 text-[10.5px] text-ink-3"><span>{r.component_id}</span><span className="num">Risk index {r.risk_score}/100</span></div>
              <div className="h-1.5 rounded bg-line mt-2 overflow-hidden"><div className="h-full bg-accent" style={{width:`${r.risk_score}%`}} /></div>
            </button>)}
            {!rows.length && <div className="text-[12px] text-ink-3">No components in this risk category.</div>}
          </div>
        </Card>
        {active ? <div className="space-y-3">
          <Card title={active.component_name} subtitle={active.component_id}>
            <div className="flex items-center gap-2 flex-wrap mb-3"><Tag kind={riskKind(active.risk_level)}>{active.risk_level} risk</Tag><Tag kind="info">{active.assessment_status}</Tag><span className="num text-xl">{active.risk_score}/100</span></div>
            <div className="grid grid-cols-3 gap-2 text-[11px]">
              <div className="border border-line rounded p-2"><div className="text-ink-3">Governing RUL</div><div className="num text-lg">{active.remaining_life_flights ?? '—'} <span className="text-[10px]">flights</span></div></div>
              <div className="border border-line rounded p-2"><div className="text-ink-3">Minimum margin</div><div className="num text-lg">{active.minimum_margin == null ? '—' : active.minimum_margin.toFixed(3)}</div></div>
              <div className="border border-line rounded p-2"><div className="text-ink-3">Mechanism</div><div className="text-[12px] mt-1">{active.governing_mechanism ?? '—'}</div></div>
            </div>
            <Link className="text-accent text-[11px] inline-block mt-3 hover:underline" to={`/components/${active.component_id}`}>Open component digital twin →</Link>
          </Card>
          <Card title="Potential failure consequences" dense>
            <ul className="list-disc pl-4 space-y-1 text-[11.5px] text-ink-2">{active.potential_consequences?.map(x=><li key={x}>{x}</li>)}</ul>
            <div className="text-[10px] text-ink-3 mt-2">System-level consequence context only; actual severity depends on aircraft configuration, failure mode, redundancy and approved safety assessment.</div>
          </Card>
          <Card title="Recommended maintenance & operational actions" subtitle="Prioritised actions with evidence and timing">
            <div className="space-y-2">
              {active.recommended_actions.map((a,i) => <div key={i} className="border border-line rounded p-3">
                <div className="flex gap-2 items-center mb-1"><Tag kind={priorityKind(a.priority)}>{a.priority}</Tag><span className="text-[10px] text-ink-3">{a.timing}</span></div>
                <div className="text-[12px] font-medium">{a.action}</div>
                <div className="text-[11px] text-ink-3 mt-1">Basis: {a.basis}</div>
              </div>)}
            </div>
          </Card>
          <Card title="Risk drivers" dense>
            <div className="space-y-2">{active.risk_drivers.map((d,i)=><div key={i} className="flex gap-2 items-start border-b border-line last:border-0 pb-2"><Tag kind={d.severity==='critical'?'bad':d.severity==='high'?'warn':'info'}>{d.severity}</Tag><div><div className="text-[11.5px] font-medium">{d.factor.replaceAll('_',' ')}</div><div className="text-[11px] text-ink-3">{d.evidence}</div></div></div>)}</div>
          </Card>
          <Card title="Component interaction & shared exposure" dense>
            {active.related_components.length ? <div className="space-y-2">{active.related_components.map(p=><div key={p.component_id} className="flex justify-between gap-2 text-[11px] border-b border-line pb-2"><div><Link className="text-accent hover:underline" to={`/components/${p.component_id}`}>{p.name}</Link><div className="text-ink-3">{p.relationship.replaceAll('_',' ')}</div></div><Tag kind={p.review_required?'warn':'info'}>{p.assessment_status ?? 'not assessed'}</Tag></div>)}</div> : <div className="text-[11px] text-ink-3">No related component instances identified from available aircraft, system, part-number and position metadata.</div>}
            <div className="text-[10px] text-ink-3 mt-2">{active.relationship_note}</div>
          </Card>
          {active.maintenance_context && <Card title="Maintenance history context" dense><div className="text-[12px]">{active.maintenance_context.maintenance_date} · {active.maintenance_context.repair_or_replacement}</div><div className="text-[11px] text-ink-3 mt-1">{active.maintenance_context.activity} · {active.maintenance_context.days_since ?? '—'} days since record</div></Card>}
          {active.upcoming_flight && <Card title="Upcoming operational exposure" dense><div className="text-[12px]">{active.upcoming_flight.flight_date} · {active.upcoming_flight.route_or_mission}</div><div className="text-[11px] text-ink-3 mt-1">{active.upcoming_flight.operational_stressors?.join(' · ') || 'No elevated mission stressors identified in available schedule fields.'}</div></Card>}
          <Card title="Model limitations" dense><ul className="list-disc pl-4 space-y-1 text-[10.5px] text-ink-3">{active.limitations.map(x=><li key={x}>{x}</li>)}</ul></Card>
        </div> : <Card><div className="text-[12px] text-ink-3">Select a component from the fleet risk register.</div></Card>}
      </div>
    </>}
  </div>
}
