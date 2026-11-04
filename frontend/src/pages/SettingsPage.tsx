import { Download, History, Save, Upload } from 'lucide-react'
import { useEffect, useState } from 'react'
import { api } from '../api/client'
import type { ImportResult, Settings } from '../api/types'
import { DemoRunner } from '../components/DemoRunner'
import { Callout, Card, ErrorBox, Field, PageHeader, Spinner } from '../components/ui'
import { useAppStore } from '../store/useAppStore'
import { fmt } from '../utils/format'
import { useAction, useApi } from '../utils/useApi'

export default function SettingsPage() {
  const { pushToast, refreshKey, bump } = useAppStore()
  const settings = useApi(() => api.settings(), [refreshKey])
  const templates = useApi(() => api.templates(), [])
  const imports = useApi(() => api.imports(), [refreshKey])
  const [draft, setDraft] = useState<Partial<Settings>>({})
  useEffect(() => {
    if (settings.data) setDraft(settings.data)
  }, [settings.data])
  const save = useAction(async () => {
    const body = { mc_samples: Number(draft.mc_samples), rls_forgetting_factor: Number(draft.rls_forgetting_factor), reduced_confidence_blend: Number(draft.reduced_confidence_blend), max_relative_change_per_update: Number(draft.max_relative_change_per_update), demo_seed: Number(draft.demo_seed) }
    for (const [k, v] of Object.entries(body)) if (!Number.isFinite(v)) throw new Error(`${k} must be numeric.`)
    await api.updateSettings(body)
    bump()
    pushToast('success', 'Simulation settings saved.')
  })
  const initAll = useAction(async () => {
    const r = await api.initialiseAll()
    bump()
    pushToast('success', `${r.length} twins initialised from their own histories.`)
  })
  const [dataset, setDataset] = useState('flight_observations')
  const [file, setFile] = useState<File | null>(null)
  const [dry, setDry] = useState(true)
  const [result, setResult] = useState<ImportResult | null>(null)
  const doImport = useAction(async () => {
    if (!file) throw new Error('Choose a CSV file.')
    const r = await api.importCsv(dataset, file, !dry)
    setResult(r)
    if (r.ok) {
      bump()
      pushToast('success', dry ? `Validation passed: ${r.rows} rows (not committed).` : `Imported ${r.imported?.length ?? 0} record(s).`)
    } else pushToast('error', `Import rejected: ${r.problems.length} problem(s).`)
  })
  return (
    <div className="space-y-4">
      <PageHeader title="Settings & data" lede="Learning and simulation parameters, structured CSV import for historical and upcoming-flight data with strict validation, downloadable templates, twin re-initialisation and the demo reset." />
      <div className="grid xl:grid-cols-2 gap-4">
        <Card title="Simulation and learning settings" subtitle="Stored in the database; applied to subsequent predictions and replays">
          {settings.loading && !settings.data ? <Spinner /> : (
            <div className="grid md:grid-cols-2 gap-3">
              <Field label="Default Monte Carlo samples" hint="10–5000; capped so samples × flights ≤ 60 000"><input className="input" type="number" min={10} max={5000} value={draft.mc_samples ?? ''} onChange={(e) => setDraft({ ...draft, mc_samples: Number(e.target.value) })} /></Field>
              <Field label="RLS forgetting factor λ" hint="0.5 < λ ≤ 1; 1 = no forgetting"><input className="input" type="number" min={0.5} max={1} step={0.005} value={draft.rls_forgetting_factor ?? ''} onChange={(e) => setDraft({ ...draft, rls_forgetting_factor: Number(e.target.value) })} /></Field>
              <Field label="Reduced-confidence blend" hint="fraction of proposed change applied when accepted with reduced confidence"><input className="input" type="number" min={0.05} max={1} step={0.05} value={draft.reduced_confidence_blend ?? ''} onChange={(e) => setDraft({ ...draft, reduced_confidence_blend: Number(e.target.value) })} /></Field>
              <Field label="Max relative change per update" hint="larger proposed corrections request more evidence"><input className="input" type="number" min={0.05} max={1} step={0.05} value={draft.max_relative_change_per_update ?? ''} onChange={(e) => setDraft({ ...draft, max_relative_change_per_update: Number(e.target.value) })} /></Field>
              <Field label="Demonstration seed" hint="deterministic synthetic observations"><input className="input" type="number" min={0} value={draft.demo_seed ?? ''} onChange={(e) => setDraft({ ...draft, demo_seed: Number(e.target.value) })} /></Field>
              <div className="flex items-end gap-2"><button className="btn-primary" onClick={() => save.run()} disabled={save.busy}><Save size={14} /> Save settings</button><button className="btn-secondary" onClick={() => initAll.run()} disabled={initAll.busy}><History size={14} /> {initAll.busy ? 'Replaying…' : 'Re-initialise all twins'}</button></div>
            </div>
          )}
          <ErrorBox error={save.error ?? initAll.error} />
        </Card>
        <Card title="CSV templates" subtitle="Download, fill in, import. Units are fixed per column; files with wrong units, columns, unknown IDs or chronology problems are rejected with the exact problem.">
          {templates.loading && !templates.data ? <Spinner /> : (
            <table className="table"><thead><tr><th>Dataset</th><th>Description</th><th>Required columns</th><th></th></tr></thead>
              <tbody>{Object.entries(templates.data ?? {}).map(([k, t]) => <tr key={k}><td className="num">{k}</td><td className="text-[12px] text-ink-2">{t.description}</td><td className="num text-[11px]">{t.required.join(', ')}</td><td><a className="btn-ghost px-1.5" href={api.templateUrl(k)} download><Download size={13} /> CSV</a></td></tr>)}</tbody></table>
          )}
        </Card>
      </div>
      <Card title="Import CSV" subtitle="Order for a new component: flight_schedule → flight_actuals (completes flights) → flight_observations (keyed by flight ID) → inspection_findings / maintenance_records → re-initialise the twin.">
        <div className="flex flex-wrap items-end gap-3">
          <Field label="Dataset type" className="w-[240px]"><select className="input" value={dataset} onChange={(e) => setDataset(e.target.value)}>{Object.keys(templates.data ?? {}).map((k) => <option key={k} value={k}>{k}</option>)}</select></Field>
          <Field label="File"><input type="file" accept=".csv" className="text-[12px]" onChange={(e) => setFile(e.target.files?.[0] ?? null)} /></Field>
          <label className="flex items-center gap-1.5 text-[12.5px] pb-2"><input type="checkbox" checked={dry} onChange={(e) => setDry(e.target.checked)} /> Validate only (dry run)</label>
          <button className="btn-primary" onClick={() => doImport.run()} disabled={doImport.busy || !file}><Upload size={14} /> {dry ? 'Validate' : 'Validate and import'}</button>
        </div>
        <ErrorBox error={doImport.error} />
        {result && (
          <div className="mt-3">
            {result.ok ? <Callout kind="success" title={`${result.dataset}: ${result.rows} row(s) valid`}>{result.imported ? `Imported: ${result.imported.join(', ')}` : 'Dry run — nothing was written.'}{result.rainflow ? ` Rainflow: ${fmt.num(result.rainflow.n_cycles, 4)} cycles, max range ${fmt.num(result.rainflow.max_range_mpa, 4)} MPa.` : ''}</Callout> : <Callout kind="error" title={`${result.dataset}: rejected (${result.problems.length} problem(s))`}><ul className="list-disc pl-4">{result.problems.map((p, i) => <li key={i}>{p}</li>)}</ul></Callout>}
            {result.rainflow && <table className="table mt-2"><thead><tr><th>Δσ (MPa)</th><th>cycles</th><th>mean (MPa)</th></tr></thead><tbody>{result.rainflow.bins.slice(0, 20).map((b, i) => <tr key={i}><td className="num">{b.stress_range_mpa.toFixed(2)}</td><td className="num">{b.cycles}</td><td className="num">{b.mean_stress_mpa.toFixed(2)}</td></tr>)}</tbody></table>}
          </div>
        )}
        <div className="text-[12px] text-ink-3 mt-2">Previous imports recorded: {Array.isArray(imports.data) ? imports.data.length : 0}. Example synthetic dataset and its generation notes: <code className="num">data/example_dataset/</code> in the repository.</div>
      </Card>
      <Card title="Demonstration control" subtitle="Reset wipes predictions, reconciliations and updates and reloads the seeded fleet with its synthetic history."><DemoRunner compact /></Card>
    </div>
  )
}
