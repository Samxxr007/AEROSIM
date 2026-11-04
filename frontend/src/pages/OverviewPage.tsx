import { ArrowRight, Plane, Radio } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { api } from '../api/client'
import { DemoRunner } from '../components/DemoRunner'
import { Scene } from '../components/three'
import Aircraft, { type Hotspot } from '../components/three/Aircraft'
import { FALLBACK_LIMITS, healthColor } from '../components/three/signals'
import { DecisionPill, ErrorBox, Spinner, StatusPill, Tag } from '../components/ui'
import { useAppStore } from '../store/useAppStore'
import { useLiveFeed } from '../store/useLive'
import { fmt, fmtState, KEY_METRIC } from '../utils/format'
import { useApi } from '../utils/useApi'

const PHASE_CYCLE = ['taxi', 'takeoff', 'climb', 'cruise', 'manoeuvring', 'descent', 'landing']

export default function OverviewPage() {
  const refreshKey = useAppStore((s) => s.refreshKey)
  const { snapshot, lastChange } = useLiveFeed()
  const { data, error, loading } = useApi(() => api.overview(), [refreshKey, lastChange])
  const navigate = useNavigate()
  const selected = useAppStore((s) => s.selectedComponentId)
  const setSelected = useAppStore((s) => s.setSelectedComponentId)
  const [flying, setFlying] = useState(false)
  const [phaseIdx, setPhaseIdx] = useState(0)
  useEffect(() => {
    if (!flying) return
    const t = setInterval(() => setPhaseIdx((i) => (i + 1) % PHASE_CYCLE.length), 2200)
    return () => clearInterval(t)
  }, [flying])

  const modelled = useMemo(() => (data?.components ?? []).filter((k) => k.model_type), [data])
  const hotspots: Hotspot[] = useMemo(
    () =>
      modelled.map((k) => {
        const key = KEY_METRIC[k.model_type!]
        const lim = FALLBACK_LIMITS[k.model_type!][key]
        const fromState = lim ? Math.min(1, (k.state[key] ?? 0) / lim) : 0
        const health = k.min_margin != null ? Math.max(0, Math.min(1, 1 - k.min_margin)) : fromState
        return { id: k.id, name: k.name, model_type: k.model_type, position: k.position, health, status: k.status }
      }),
    [modelled],
  )
  const sel = modelled.find((k) => k.id === selected) ?? modelled[0]

  if (loading && !data) return <Spinner label="Loading fleet…" />
  if (error) return <ErrorBox error={error} />
  if (!data) return null
  const c = data.counts

  return (
    <div className="space-y-3">
      {/* ------------------------------------------------------------ hero strip */}
      <div className="flex flex-wrap items-center gap-3">
        <div>
          <h1 className="text-[20px] font-semibold text-white leading-tight">Fleet overview</h1>
          <p className="text-[12px] text-ink-3">Learn from every actual flight · update with reliable inspection evidence · improve the next component-life prediction.</p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <Kpi label="flights" v={`${c.flights_completed} / ${c.flights_scheduled}`} hint="completed / scheduled" />
          <Kpi label="predictions" v={c.predictions} />
          <Kpi label="updates applied" v={c.model_updates_applied} hint={`${c.model_updates_rejected} gated out`} tone="good" />
          <Kpi label="review" v={c.review_required} tone={c.review_required > 0 ? 'warn' : 'default'} />
          <Link to={`/live/${sel?.id ?? ''}`} className="btn-primary"><Radio size={14} /> Open live twin</Link>
        </div>
      </div>

      {/* ------------------------------------------------------------ 3D fleet + health */}
      <div className="grid grid-cols-12 gap-3">
        <div className="col-span-12 xl:col-span-8 card overflow-hidden">
          <div className="relative h-full min-h-[480px]">
            <Scene camera={[5.2, 3.2, 6.4]} target={[0, 0.2, 0]} shadowY={-0.72} className="absolute inset-0" autoRotate={!flying} minDistance={4} maxDistance={16} fov={34}>
              <Aircraft hotspots={hotspots} selected={sel?.id} onSelect={(id) => setSelected(id)} flying={flying} phase={flying ? PHASE_CYCLE[phaseIdx] : 'idle'} />
            </Scene>
            <div className="absolute left-3 top-3 pointer-events-none">
              <div className="text-[11px] uppercase tracking-[0.14em] text-ink-3">{data.aircraft[0]?.id} · {data.aircraft[0]?.registration_or_demo_id}</div>
              <div className="text-[14px] text-white font-semibold">{data.aircraft[0]?.aircraft_type}</div>
              <div className="text-[11px] text-ink-2">{modelled.length} component twins · click a marker to select</div>
            </div>
            <div className="absolute right-3 top-3 flex gap-2">
              <button className={`btn-secondary !py-1 ${flying ? 'border-accent text-accent-2' : ''}`} onClick={() => setFlying((f) => !f)}><Plane size={13} /> {flying ? `in flight · ${PHASE_CYCLE[phaseIdx]}` : 'animate flight'}</button>
            </div>
            <div className="absolute left-3 bottom-3 flex gap-3 text-[10.5px] text-ink-3 pointer-events-none">
              <span><span className="inline-block w-2 h-2 rounded-full bg-green mr-1" />&lt; 45 % of review limit</span>
              <span><span className="inline-block w-2 h-2 rounded-full bg-amber mr-1" />45–75 %</span>
              <span><span className="inline-block w-2 h-2 rounded-full bg-red mr-1" />&gt; 75 %</span>
            </div>
          </div>
        </div>
        <div className="col-span-12 xl:col-span-4 space-y-2">
          {modelled.map((k) => {
            const h = hotspots.find((x) => x.id === k.id)!
            const active = k.id === sel?.id
            return (
              <button key={k.id} onClick={() => setSelected(k.id)} onDoubleClick={() => navigate(`/live/${k.id}`)} className={`w-full text-left card px-3 py-2 transition-all ${active ? 'border-accent/70 glow-ring' : 'hover:border-line-strong'}`}>
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full shrink-0" style={{ background: healthColor(h.health), boxShadow: `0 0 8px ${healthColor(h.health)}` }} />
                  <span className="num text-[12.5px] text-white">{k.id}</span>
                  <span className="text-[11px] text-ink-3 truncate">{k.name} · {k.position}</span>
                  <span className="ml-auto num text-[10.5px] text-ink-3">v{k.model_version}</span>
                </div>
                <div className="flex items-center gap-2 mt-1.5">
                  <div className="flex-1 h-1.5 rounded bg-graphite border border-line overflow-hidden"><div className="h-full" style={{ width: `${h.health * 100}%`, background: healthColor(h.health) }} /></div>
                  <span className="num text-[11px]" style={{ color: healthColor(h.health) }}>{(h.health * 100).toFixed(0)} %</span>
                </div>
                <div className="flex items-center gap-2 mt-1.5 text-[11px]">
                  <StatusPill status={k.status} />
                  <span className="num text-ink-2">{fmtState(KEY_METRIC[k.model_type!], k.state[KEY_METRIC[k.model_type!]])}</span>
                  {k.remaining_life != null && <span className="num text-ink-3">RUL {fmt.int(k.remaining_life)} fl.</span>}
                  {k.last_reconciliation && <span className="ml-auto"><DecisionPill decision={k.last_reconciliation.final_decision ?? k.last_reconciliation.gate.decision} /></span>}
                </div>
              </button>
            )
          })}
        </div>
      </div>

      {/* ------------------------------------------------------------ selected twin strip */}
      {sel && (
        <div className="card px-3 py-2.5 flex flex-wrap items-center gap-x-5 gap-y-1 text-[12px]">
          <div><span className="label mr-1.5">selected</span><span className="num text-white">{sel.id}</span> <span className="text-ink-3">{sel.name}</span></div>
          <div><span className="label mr-1.5">history</span>{sel.history_initialised ? <span className="text-green">initialised</span> : <span className="text-amber">not initialised</span>} <span className="text-ink-3 num">{sel.data_availability?.observations ?? 0} obs · {sel.data_availability?.inspections ?? 0} insp · {sel.data_availability?.maintenance ?? 0} mnt</span></div>
          <div><span className="label mr-1.5">latest inspection</span>{sel.latest_inspection ? <span className="num">{sel.latest_inspection.inspection_date} {sel.latest_inspection.method_label} {sel.latest_inspection.measured_value != null ? `${sel.latest_inspection.measured_value} ± ${sel.latest_inspection.measurement_uncertainty} ${sel.latest_inspection.unit}` : sel.latest_inspection.observed_defect}</span> : <span className="text-ink-3">none</span>}</div>
          <div><span className="label mr-1.5">next flight</span>{sel.next_scheduled_flight ? <span className="num">{sel.next_scheduled_flight.id} · {sel.next_scheduled_flight.flight_date}</span> : <span className="text-ink-3">none</span>}</div>
          <div><span className="label mr-1.5">next prediction</span><span className="text-ink-2">{sel.next_prediction_status}</span></div>
          <div className="ml-auto flex gap-2">
            <Link to={`/live/${sel.id}`} className="btn-primary !py-1"><Radio size={13} /> Live twin</Link>
            <Link to={`/components/${sel.id}`} className="btn-secondary !py-1">Profile <ArrowRight size={13} /></Link>
          </div>
        </div>
      )}

      {/* ------------------------------------------------------------ flight line + activity */}
      <div className="grid grid-cols-12 gap-3">
        <div className="col-span-12 xl:col-span-8 card px-3 py-2.5">
          <div className="label mb-2">flight line · {data.aircraft[0]?.id}</div>
          <div className="flex items-center gap-1 overflow-x-auto pb-1">
            {(snapshot?.flights ?? []).map((f) => (
              <Link key={f.id} to={`/live/${sel?.id ?? ''}?flight=${f.id}`} className={`shrink-0 rounded border px-2 py-1 text-[10.5px] num ${f.status === 'completed' ? 'border-line text-ink-2 bg-graphite/60' : 'border-accent/50 text-accent-2 bg-accent-soft'}`} title={`${f.route_or_mission} · ${f.flight_date}`}>
                {f.id.replace('AC001-', '')}
                <div className="text-[9px] text-ink-3">{f.flight_date.slice(5)}</div>
              </Link>
            ))}
          </div>
          <div className="text-[10.5px] text-ink-3 mt-1">grey = completed (observation by flight ID) · cyan = scheduled (pre-flight prediction target). Click to open the flight in the live twin.</div>
        </div>
        <div className="col-span-12 xl:col-span-4 card px-3 py-2.5">
          <div className="label mb-1.5 flex items-center gap-1.5"><span className="live-dot inline-block w-1.5 h-1.5 rounded-full bg-green" /> activity</div>
          <ul className="text-[11.5px] space-y-1 max-h-[96px] overflow-y-auto">
            {(snapshot?.activity ?? data.recent_activity).slice(0, 8).map((a) => (
              <li key={a.id} className="flex gap-2"><span className="num text-ink-3 shrink-0">{new Date(a.created_at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span><span className="truncate" title={a.message}><Tag kind={a.kind}>{a.kind}</Tag> {a.message}</span></li>
            ))}
          </ul>
        </div>
      </div>

      {/* ------------------------------------------------------------ demo */}
      <div className="card px-4 py-3">
        <div className="flex items-baseline justify-between mb-2">
          <div className="text-[13px] font-semibold">Demonstration — flight-by-flight learning loop</div>
          <div className="text-[11px] text-ink-3">deterministic · every step can be done by hand on the other pages</div>
        </div>
        <DemoRunner initial={data.demo} compact />
      </div>
      <div className="text-[10.5px] text-ink-3">{data.data_provenance_note} AeroSim is a research and engineering demonstration prototype; it makes no airworthiness, dispatch or maintenance decisions.</div>
    </div>
  )
}

function Kpi({ label, v, hint, tone = 'default' }: { label: string; v: string | number; hint?: string; tone?: 'default' | 'good' | 'warn' }) {
  const c = tone === 'good' ? 'text-green' : tone === 'warn' ? 'text-amber' : 'text-white'
  return (
    <div className="card px-3 py-1.5 min-w-[92px]">
      <div className="label">{label}</div>
      <div className={`num text-[16px] leading-tight ${c}`}>{v}</div>
      {hint && <div className="text-[9.5px] text-ink-3">{hint}</div>}
    </div>
  )
}
