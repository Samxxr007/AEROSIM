import { GitCompare, Save, Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api/client'
import type { CompareResult, Mission, ModelType } from '../api/types'
import { DamageAddedByMissionChart, ScheduleComparisonChart, StressSpectrumChart } from '../components/charts'
import { MissionEditor } from '../components/MissionEditor'
import { Callout, Card, ErrorBox, Field, PageHeader, Spinner, StatusPill } from '../components/ui'
import { useAppStore } from '../store/useAppStore'
import { fmt, fmtState, KEY_METRIC, PROFILE_LABELS, stateLabel, WHAT_IF_LABEL } from '../utils/format'
import { useAction, useApi } from '../utils/useApi'

const DEFAULT_SCHEDULES: { name: string; missions: Mission[] }[] = [
  { name: 'Schedule A — normal', missions: [{ profile: 'normal' }, { profile: 'normal' }, { profile: 'normal' }] },
  { name: 'Schedule B — one increased-load', missions: [{ profile: 'normal' }, { profile: 'increased_load' }, { profile: 'normal' }] },
  { name: 'Schedule C — demanding', missions: [{ profile: 'increased_load' }, { profile: 'high_manoeuvre' }, { profile: 'increased_load' }] },
]

export default function MissionsPage() {
  const { selectedComponentId, setSelectedComponentId, draftMissions, setDraftMissions, pushToast, refreshKey } = useAppStore()
  const comps = useApi(() => api.components({ modelled: true }), [refreshKey])
  const presets = useApi(() => api.missionPresets(), [])
  const scenarios = useApi(() => api.scenarios(selectedComponentId), [selectedComponentId, refreshKey])
  const comp = comps.data?.find((c) => c.id === selectedComponentId) ?? comps.data?.[0]
  const modelType = (comp?.model_type ?? null) as ModelType | null
  const [name, setName] = useState('')
  const [schedules, setSchedules] = useState(DEFAULT_SCHEDULES)
  const [compare, setCompare] = useState<CompareResult | null>(null)
  const [tab, setTab] = useState<'sequence' | 'compare'>('sequence')
  useEffect(() => {
    if (comps.data && !comps.data.find((c) => c.id === selectedComponentId)) setSelectedComponentId(comps.data[0]?.id ?? '')
  }, [comps.data, selectedComponentId, setSelectedComponentId])

  const save = useAction(async () => {
    if (!comp) throw new Error('Select a component.')
    if (!name.trim()) throw new Error('Give the scenario a name.')
    await api.createScenario({ component_id: comp.id, name: name.trim(), missions: draftMissions })
    pushToast('success', `Scenario "${name.trim()}" saved.`)
    setName('')
    scenarios.refetch()
  })
  const del = useAction(async (id: string) => {
    await api.deleteScenario(id)
    scenarios.refetch()
  })
  const runCompare = useAction(async () => {
    if (!comp) throw new Error('Select a component.')
    const r = await api.compare({ component_id: comp.id, schedules: schedules.map((s) => ({ component_id: comp.id, name: s.name, missions: s.missions })), mc_samples: 0 })
    setCompare(r)
  })
  const key = modelType ? KEY_METRIC[modelType] : 'miner_damage'
  const incKey = modelType === 'engine_mount' ? 'crack_length_m' : key
  return (
    <div className="space-y-4">
      <PageHeader title="Engineering what-if — mission studio" lede="Secondary tool: construct hypothetical sequences of 1–10 flights with configurable operating conditions, save them as scenarios, or compare alternative schedules through the component's current calibrated twin. Nothing here changes the twin; actual upcoming-flight predictions are made on the Predictions page." />
      <Callout kind="warning" title={WHAT_IF_LABEL}>Hypothetical conditions explored from the component's current estimated state and model version. Results are not predictions of scheduled flights and must not be used for dispatch or maintenance decisions.</Callout>
      <Card dense>
        <div className="flex flex-wrap items-end gap-3">
          <Field label="Component" className="w-[360px]">
            <select className="input" value={comp?.id ?? ''} onChange={(e) => setSelectedComponentId(e.target.value)}>
              {(comps.data ?? []).map((c) => <option key={c.id} value={c.id}>{c.id} — {c.name}</option>)}
            </select>
          </Field>
          {comp && <div className="text-[12px] text-ink-2 pb-2">Model <span className="num">{comp.model_type} v{comp.model_version}</span> · key state <span className="num">{fmtState(key, comp.state[key])}</span> · <Link to={`/components/${comp.id}`} className="text-accent">profile →</Link></div>}
          <div className="ml-auto flex gap-1">
            <button className={tab === 'sequence' ? 'btn-primary' : 'btn-secondary'} onClick={() => setTab('sequence')}>Mission sequence</button>
            <button className={tab === 'compare' ? 'btn-primary' : 'btn-secondary'} onClick={() => setTab('compare')}><GitCompare size={14} /> Compare schedules</button>
          </div>
        </div>
      </Card>
      {presets.data && (
        <Card title="Demonstration mission profiles" subtitle="Presets are engineering what-if operating conditions; every value can be overridden per mission" dense>
          <div className="grid md:grid-cols-5 gap-2 text-[11.5px]">
            {Object.entries(presets.data.presets).map(([k, p]) => (
              <div key={k} className="border border-line rounded px-2 py-1.5">
                <div className="font-medium text-[12px]">{PROFILE_LABELS[k]}</div>
                <div className="text-ink-3 num">{Object.entries(p).filter(([kk]) => !['name', 'profile'].includes(kk)).map(([kk, v]) => `${kk.replace(/_/g, ' ')}=${v}`).join(' · ') || 'all defaults'}</div>
              </div>
            ))}
            <div className="md:col-span-5 text-ink-3">Phase split of flight time (all profiles): {Object.entries(presets.data.default_phase_fractions).map(([p, f]) => `${p} ${(f * 100).toFixed(0)} %`).join(' · ')}. Phase load/thermal/vibration fractions per component are documented in MODEL_ASSUMPTIONS.md.</div>
          </div>
        </Card>
      )}
      {tab === 'sequence' && (
        <div className="grid xl:grid-cols-3 gap-4">
          <Card title="Upcoming mission sequence" subtitle="Flights are simulated in order; each updates the component state" className="xl:col-span-2">
            <MissionEditor missions={draftMissions} onChange={setDraftMissions} presets={presets.data} modelType={modelType} />
            <div className="flex flex-wrap items-center gap-2 mt-3">
              <input className="input w-[280px]" placeholder="Scenario name" value={name} onChange={(e) => setName(e.target.value)} />
              <button className="btn-secondary" onClick={() => save.run()} disabled={save.busy}><Save size={14} /> Save scenario</button>
              <Link to="/simulation" className="btn-primary">Run what-if sequence →</Link>
            </div>
            <ErrorBox error={save.error} />
          </Card>
          <Card title="Saved scenarios" subtitle="Reopen a sequence for this component" dense>
            {scenarios.loading && !scenarios.data ? <Spinner /> : (scenarios.data ?? []).length === 0 ? <div className="text-[12px] text-ink-3">No saved scenarios for this component.</div> : (
              <ul className="space-y-1.5">
                {(scenarios.data ?? []).map((s) => (
                  <li key={s.id} className="border border-line rounded px-2 py-1.5 text-[12px] flex items-start gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="font-medium truncate">{s.name}</div>
                      <div className="text-ink-3 truncate">{s.missions.map((m) => `${PROFILE_LABELS[m.profile] ?? m.profile}${(m.repeat ?? 1) > 1 ? ` ×${m.repeat}` : ''}`).join(' → ')}</div>
                    </div>
                    <button className="btn-ghost px-1.5" onClick={() => { setDraftMissions(s.missions); pushToast('info', `Scenario "${s.name}" loaded into the editor.`) }}>Open</button>
                    <button className="btn-ghost px-1.5 text-red" onClick={() => del.run(s.id)} aria-label="Delete scenario"><Trash2 size={13} /></button>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      )}
      {tab === 'compare' && (
        <div className="space-y-4">
          <div className="grid xl:grid-cols-3 gap-3">
            {schedules.map((s, i) => (
              <Card key={i} title={<input className="input" value={s.name} onChange={(e) => setSchedules(schedules.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} aria-label={`Schedule ${i + 1} name`} />} dense actions={schedules.length > 1 ? <button className="btn-ghost text-red px-1.5" onClick={() => setSchedules(schedules.filter((_, j) => j !== i))} aria-label="Remove schedule"><Trash2 size={13} /></button> : undefined}>
                <MissionEditor missions={s.missions} onChange={(m) => setSchedules(schedules.map((x, j) => (j === i ? { ...x, missions: m } : x)))} presets={presets.data} modelType={modelType} maxMissions={10} />
              </Card>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <button className="btn-primary" onClick={() => runCompare.run()} disabled={runCompare.busy}><GitCompare size={14} /> {runCompare.busy ? 'Running all schedules…' : 'Run comparison'}</button>
            <button className="btn-secondary" onClick={() => schedules.length < 5 && setSchedules([...schedules, { name: `Schedule ${String.fromCharCode(65 + schedules.length)}`, missions: [{ profile: 'normal' }] }])} disabled={schedules.length >= 5}>Add schedule</button>
            <button className="btn-secondary" onClick={() => setSchedules(DEFAULT_SCHEDULES)}>Reset to A/B/C</button>
          </div>
          <ErrorBox error={runCompare.error} />
          {compare && comp && (
            <>
              <div className="grid xl:grid-cols-2 gap-4">
                <Card dense><ScheduleComparisonChart schedules={compare.schedules} stateKey={key} initial={comp.state[key]} /></Card>
                <Card dense><DamageAddedByMissionChart schedules={compare.schedules} incKey={incKey} /></Card>
              </div>
              <Card title="Schedule comparison" subtitle={`Same component state and model v${compare.model_version} for all schedules`} dense>
                <table className="table">
                  <thead><tr><th>Schedule</th><th>Flights</th><th>Final {stateLabel(key).label}</th><th>Δ over sequence</th><th>Most damaging mission</th><th>Governing RUL after</th><th>Status</th></tr></thead>
                  <tbody>
                    {compare.schedules.map((s) => {
                      const worst = s.missions.reduce((a, m) => ((m.damage_added[incKey] ?? 0) > (a.damage_added[incKey] ?? 0) ? m : a), s.missions[0])
                      return (
                        <tr key={s.name}>
                          <td>{s.name}</td>
                          <td className="num">{s.flights.length}</td>
                          <td className="num">{fmtState(key, s.final_state[key])}</td>
                          <td className="num">{fmtState(key, s.final_state[key] - comp.state[key])}</td>
                          <td>{worst ? `M${worst.index + 1} ${worst.mission.name} (${fmtState(incKey, worst.damage_added[incKey])})` : '—'}</td>
                          <td className="num">{s.remaining_life.governing_remaining_flights != null ? `${fmt.int(s.remaining_life.governing_remaining_flights)} flights` : '—'}</td>
                          <td><StatusPill status={s.threshold_status} /></td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
                {compare.schedules[0]?.missions[0]?.stress_bins?.length ? <div className="mt-3"><StressSpectrumChart bins={compare.schedules[compare.schedules.length - 1].missions[0].stress_bins} /></div> : null}
              </Card>
            </>
          )}
          <Callout kind="warning">This is an engineering what-if tool. It does not instruct anyone to change an actual flight plan and makes no airworthiness, dispatch or flight-safety decisions.</Callout>
        </div>
      )}
    </div>
  )
}
