import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { Activity, BookOpen, ClipboardCheck, Cog, FlaskConical, GitCompare, History, LayoutDashboard, Layers, Plane, Radio, Target, ShieldCheck, Wrench, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useAppStore } from '../../store/useAppStore'
import { useLiveFeed } from '../../store/useLive'

const NAV: { to: string; label: string; icon: typeof LayoutDashboard; group: string }[] = [
  { to: '/overview', label: 'Fleet overview', icon: LayoutDashboard, group: 'Live' },
  { to: '/live', label: 'Live twin · flight playback', icon: Radio, group: 'Live' },
  { to: '/components', label: 'Component registry', icon: Layers, group: 'Component twins' },
  { to: '/flights', label: 'Flights & schedule', icon: Plane, group: 'Component twins' },
  { to: '/predictions', label: 'Upcoming-flight predictions', icon: Target, group: 'Component twins' },
  { to: '/reconciliation', label: 'Reconciliation & gate', icon: GitCompare, group: 'Component twins' },
  { to: '/inspections', label: 'Inspections & maintenance', icon: ClipboardCheck, group: 'Component twins' },
  { to: '/model-history', label: 'Model evolution', icon: History, group: 'Component twins' },
  { to: '/validation', label: 'Validation', icon: FlaskConical, group: 'Component twins' },
  { to: '/reliability', label: 'Reliability & trust', icon: ShieldCheck, group: 'Component twins' },
  { to: '/maintenance-intelligence', label: 'Maintenance intelligence', icon: Wrench, group: 'Component twins' },
  { to: '/missions', label: 'What-if: mission studio', icon: Activity, group: 'Engineering what-if' },
  { to: '/simulation', label: 'What-if: sequence simulation', icon: Activity, group: 'Engineering what-if' },
  { to: '/methodology', label: 'Methodology', icon: BookOpen, group: 'Reference' },
  { to: '/settings', label: 'Settings & data', icon: Cog, group: 'Reference' },
]

export default function AppShell() {
  const toasts = useAppStore((s) => s.toasts)
  const dismiss = useAppStore((s) => s.dismissToast)
  const { snapshot, online, lastChange } = useLiveFeed()
  const [flash, setFlash] = useState(false)
  const loc = useLocation()
  useEffect(() => {
    if (!lastChange) return
    setFlash(true)
    const t = setTimeout(() => setFlash(false), 1200)
    return () => clearTimeout(t)
  }, [lastChange])
  const wide = loc.pathname.startsWith('/live') || loc.pathname === '/overview'
  return (
    <div className="flex min-h-screen">
      <aside className="w-[236px] shrink-0 bg-graphite/90 backdrop-blur border-r border-line text-ink-2 flex flex-col sticky top-0 h-screen self-start">
        <div className="px-4 py-4 border-b border-line">
          <div className="flex items-center gap-2.5">
            <svg viewBox="0 0 32 32" width="28" height="28" aria-hidden>
              <rect width="32" height="32" rx="7" fill="#0e2a3b" />
              <path d="M6 22 L16 8 L26 22" fill="none" stroke="#38bdf8" strokeWidth="2.5" strokeLinejoin="round" />
              <path d="M10 22 L16 14 L22 22" fill="none" stroke="#e6edf3" strokeWidth="2" />
            </svg>
            <div>
              <div className="text-[15px] font-semibold text-white leading-tight tracking-tight">AeroSim</div>
              <div className="text-[10.5px] text-ink-3 leading-tight">Self-evolving component twins</div>
            </div>
          </div>
        </div>
        <nav className="flex-1 py-2 overflow-y-auto">
          {NAV.map(({ to, label, icon: Icon, group }, i) => (
            <div key={to}>
              {NAV[i - 1]?.group !== group && <div className="px-4 pt-3 pb-1 text-[9.5px] uppercase tracking-[0.14em] text-ink-3">{group}</div>}
              <NavLink to={to} className={({ isActive }) => `flex items-center gap-2.5 px-4 py-[7px] text-[12.5px] transition-colors border-l-2 ${isActive ? 'bg-accent/10 text-white border-accent' : 'text-ink-2 hover:bg-white/5 hover:text-white border-transparent'}`}>
                <Icon size={14} strokeWidth={1.8} />
                {label}
              </NavLink>
            </div>
          ))}
        </nav>
        <div className="px-4 py-3 border-t border-line text-[11px] text-ink-3 space-y-1.5">
          <div className="flex items-center gap-1.5">
            <span className={`relative inline-flex w-2 h-2 rounded-full ${online === null ? 'bg-ink-3' : online ? 'bg-green' : 'bg-red'}`}>{online && <span className="live-dot absolute inset-0 rounded-full bg-green" />}</span>
            {online === null ? 'Connecting…' : online ? 'Live · polling 2.5 s' : 'Backend unreachable'}
            {flash && <span className="ml-auto text-accent-2 text-[10px]">updated</span>}
          </div>
          {snapshot && (
            <div className="grid grid-cols-3 gap-1 num text-[10.5px]">
              <Count n={snapshot.counts.predictions} l="pred." />
              <Count n={snapshot.counts.observations} l="obs." />
              <Count n={snapshot.counts.updates} l="updates" />
            </div>
          )}
          <div className="text-[9.5px] leading-snug text-ink-3/80">Synthetic demonstration data · research prototype — not for airworthiness or maintenance decisions.</div>
        </div>
      </aside>
      <main className="flex-1 min-w-0">
        <div className={`px-5 py-4 ${wide ? 'max-w-[1700px]' : 'max-w-[1500px]'}`}>
          {online === false && (
            <div className="mb-3 border border-red/40 bg-red-soft rounded-md px-3 py-2 text-[12.5px]">
              The backend API is not reachable. Start it with <code>uvicorn app.main:app --reload --port 8000</code> inside <code>backend/</code>.
            </div>
          )}
          <Outlet />
        </div>
      </main>
      <div className="fixed bottom-4 right-4 flex flex-col gap-2 z-50 w-[380px]">
        {toasts.map((t) => (
          <div key={t.id} className={`flex items-start gap-2 rounded-md border px-3 py-2 text-[12.5px] shadow-lg bg-surface-2 backdrop-blur ${t.kind === 'error' ? 'border-red/60' : t.kind === 'success' ? 'border-green/60' : t.kind === 'warning' ? 'border-amber/60' : 'border-accent/50'}`}>
            <div className="flex-1">{t.message}</div>
            <button onClick={() => dismiss(t.id)} className="text-ink-3 hover:text-ink" aria-label="Dismiss"><X size={14} /></button>
          </div>
        ))}
      </div>
    </div>
  )
}

function Count({ n, l }: { n: number; l: string }) {
  return (
    <div className="rounded border border-line bg-surface px-1.5 py-0.5 text-center">
      <div className="text-ink text-[12px] leading-tight">{n}</div>
      <div className="text-[9px] text-ink-3">{l}</div>
    </div>
  )
}
