import type { ReactNode } from 'react'
import { AlertTriangle, CheckCircle2, Info, Loader2, XCircle } from 'lucide-react'
import type { Decision, Provenance, ThresholdStatus } from '../../api/types'

export function Card({ title, subtitle, actions, children, className = '', dense }: { title?: ReactNode; subtitle?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string; dense?: boolean }) {
  return (
    <section className={`card ${className}`}>
      {(title || actions) && (
        <header className={`flex items-start justify-between gap-3 border-b border-line ${dense ? 'px-3 py-2' : 'px-4 py-2.5'}`}>
          <div>
            {title && <h3 className="text-[13px] font-semibold text-ink">{title}</h3>}
            {subtitle && <p className="text-[12px] text-ink-3 mt-0.5">{subtitle}</p>}
          </div>
          {actions && <div className="flex items-center gap-2 shrink-0">{actions}</div>}
        </header>
      )}
      <div className={dense ? 'p-3' : 'p-4'}>{children}</div>
    </section>
  )
}

export function PageHeader({ title, lede, actions }: { title: string; lede?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3 mb-4">
      <div>
        <h1 className="text-[20px] font-semibold text-ink">{title}</h1>
        {lede && <p className="text-[13px] text-ink-2 mt-1 max-w-3xl">{lede}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  )
}

export function Stat({ label, value, unit, hint, tone }: { label: string; value: ReactNode; unit?: string; hint?: ReactNode; tone?: 'default' | 'warn' | 'bad' | 'good' }) {
  const color = tone === 'bad' ? 'text-red' : tone === 'warn' ? 'text-amber' : tone === 'good' ? 'text-green' : 'text-ink'
  return (
    <div className="card px-3 py-2.5">
      <div className="label">{label}</div>
      <div className={`num text-[20px] font-medium leading-tight mt-1 ${color}`}>
        {value}
        {unit && <span className="text-[12px] text-ink-3 font-sans ml-1">{unit}</span>}
      </div>
      {hint && <div className="text-[11px] text-ink-3 mt-0.5">{hint}</div>}
    </div>
  )
}

const PROV_STYLE: Record<string, string> = {
  input: 'bg-accent-soft text-accent',
  assumption: 'bg-amber-soft text-amber',
  measured: 'bg-green-soft text-green',
  catalogue: 'bg-paper text-ink-2 border border-line',
  simulation: 'bg-violet/15 text-violet',
  calibrated: 'bg-accent-soft text-accent-2',
  synthetic_demo: 'bg-amber-soft text-amber',
  synthetic_ground_truth: 'bg-amber-soft text-amber',
  uploaded: 'bg-accent-soft text-accent',
  manual: 'bg-green-soft text-green',
}

export function Tag({ kind, children }: { kind: Provenance | string; children?: ReactNode }) {
  return <span className={`inline-block rounded px-1.5 py-[1px] text-[10.5px] font-medium uppercase tracking-wide ${PROV_STYLE[kind] ?? 'bg-paper text-ink-2 border border-line'}`}>{children ?? kind.replace(/_/g, ' ')}</span>
}

export function StatusPill({ status }: { status: ThresholdStatus | 'review' | 'not_modelled' | 'invalid_parameters' | string }) {
  const map: Record<string, { cls: string; label: string }> = {
    within_threshold: { cls: 'bg-green-soft text-green', label: 'Within threshold' },
    review: { cls: 'bg-amber-soft text-amber', label: 'Engineering review' },
    threshold_crossed: { cls: 'bg-red-soft text-red', label: 'Threshold crossed' },
    insufficient_evidence: { cls: 'bg-paper text-ink-2 border border-line', label: 'Insufficient evidence' },
    not_modelled: { cls: 'bg-paper text-ink-3 border border-line', label: 'Catalogue only' },
    invalid_parameters: { cls: 'bg-red-soft text-red', label: 'Invalid parameters' },
  }
  const m = map[status] ?? { cls: 'bg-paper text-ink-2 border border-line', label: status }
  return <span className={`inline-block rounded px-2 py-[2px] text-[11px] font-medium ${m.cls}`}>{m.label}</span>
}

export function DecisionPill({ decision }: { decision: Decision | string }) {
  const map: Record<string, string> = {
    accept: 'bg-green-soft text-green',
    accept_reduced_confidence: 'bg-accent-soft text-accent',
    request_more_evidence: 'bg-amber-soft text-amber',
    reject: 'bg-red-soft text-red',
  }
  const label: Record<string, string> = { accept: 'Accept', accept_reduced_confidence: 'Accept (reduced confidence)', request_more_evidence: 'Request more evidence', reject: 'Reject' }
  return <span className={`inline-block rounded px-2 py-[2px] text-[11px] font-medium ${map[decision] ?? 'bg-paper text-ink-2'}`}>{label[decision] ?? decision}</span>
}

export function Callout({ kind = 'info', title, children }: { kind?: 'info' | 'warning' | 'error' | 'success'; title?: string; children: ReactNode }) {
  const style = { info: 'border-accent/30 bg-accent-soft text-ink', warning: 'border-amber/40 bg-amber-soft text-ink', error: 'border-red/40 bg-red-soft text-ink', success: 'border-green/40 bg-green-soft text-ink' }[kind]
  const Icon = { info: Info, warning: AlertTriangle, error: XCircle, success: CheckCircle2 }[kind]
  return (
    <div className={`flex gap-2 border rounded px-3 py-2 text-[12.5px] ${style}`}>
      <Icon size={15} className="mt-0.5 shrink-0" />
      <div>
        {title && <div className="font-semibold">{title}</div>}
        <div>{children}</div>
      </div>
    </div>
  )
}

export function Spinner({ label }: { label?: string }) {
  return (
    <div className="flex items-center gap-2 text-ink-3 text-[12.5px] py-6 justify-center">
      <Loader2 size={16} className="animate-spin" /> {label ?? 'Loading…'}
    </div>
  )
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="border border-dashed border-line-strong rounded px-4 py-6 text-center">
      <div className="text-[13px] font-medium text-ink-2">{title}</div>
      {children && <div className="text-[12px] text-ink-3 mt-1">{children}</div>}
    </div>
  )
}

export function Field({ label, hint, children, className = '' }: { label: ReactNode; hint?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <label className={`block ${className}`}>
      <span className="label block mb-1">{label}</span>
      {children}
      {hint && <span className="block text-[11px] text-ink-3 mt-0.5">{hint}</span>}
    </label>
  )
}

export function KV({ rows, mono = true }: { rows: { k: ReactNode; v: ReactNode; tag?: ReactNode }[]; mono?: boolean }) {
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-[12.5px]">
      {rows.map((r, i) => (
        <div key={i} className="contents">
          <dt className="text-ink-3">{r.k}</dt>
          <dd className={`${mono ? 'num' : ''} text-ink flex items-center gap-2 min-w-0`}>
            <span className="truncate">{r.v}</span>
            {r.tag}
          </dd>
        </div>
      ))}
    </dl>
  )
}

export function ErrorBox({ error }: { error: unknown }) {
  if (!error) return null
  const msg = error instanceof Error ? error.message : String(error)
  return (
    <Callout kind="error" title="Request failed">
      {msg}
    </Callout>
  )
}
