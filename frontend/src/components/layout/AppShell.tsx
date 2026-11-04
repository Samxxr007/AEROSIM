import { NavLink, Outlet } from 'react-router-dom'
import { Activity, BookOpen, ClipboardCheck, Cog, Database, FlaskConical, GitCompare, History, LayoutDashboard, Layers, Plane, Target, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { api } from '../../api/client'
import { useAppStore } from '../../store/useAppStore'

const NAV: { to: string; label: string; icon: typeof LayoutDashboard; group?: string }[] = [
  { to: '/overview', label: 'Overview', icon: LayoutDashboard },
  { to: '/components', label: 'Component registry', icon: Layers },
  { to: '/flights', label: 'Flights & schedule', icon: Plane },
  { to: '/predictions', label: 'Upcoming flight predictions', icon: Target },
  { to: '/reconciliation', label: 'Prediction reconciliation', icon: GitCompare },
  { to: '/inspections', label: 'Inspections & maintenance', icon: ClipboardCheck },
  { to: '/model-history', label: 'Model evolution', icon: History },
  { to: '/validation', label: 'Validation', icon: FlaskConical },
  { to: '/missions', label: 'What-if: mission studio', icon: Activity, group: 'Engineering what-if' },
  { to: '/simulation', label: 'What-if: sequence simulation', icon: Activity, group: 'Engineering what-if' },
  { to: '/methodology', label: 'Methodology', icon: BookOpen, group: 'Reference' },
  { to: '/settings', label: 'Settings & data', icon: Cog, group: 'Reference' },
]

export default function AppShell() {
  const toasts = useAppStore((s) => s.toasts)
  const dismiss = useAppStore((s) => s.dismissToast)
  const [apiOk, setApiOk] = useState<boolean | null>(null)
  useEffect(() => {
    let alive = true
    const ping = () => api.health().then(() => alive && setApiOk(true)).catch(() => alive && setApiOk(false))
    ping()
    const t = setInterval(ping, 15000)
    return () => {
      alive = false
      clearInterval(t)
    }
  }, [])
  return (
    <div className="flex min-h-screen">
      <aside className="w-[232px] shrink-0 bg-graphite text-[#d8dde3] flex flex-col sticky top-0 h-screen self-start">
        <div className="px-4 py-4 border-b border-white/10">
          <div className="flex items-center gap-2">
            <svg viewBox="0 0 32 32" width="26" height="26" aria-hidden>
              <rect width="32" height="32" rx="6" fill="#273241" />
              <path d="M6 22 L16 8 L26 22" fill="none" stroke="#3fa7c9" strokeWidth="2.5" strokeLinejoin="round" />
              <path d="M10 22 L16 14 L22 22" fill="none" stroke="#e8e6e1" strokeWidth="2" />
            </svg>
            <div>
              <div className="text-[15px] font-semibold text-white leading-tight">AeroSim</div>
              <div className="text-[10.5px] text-[#9aa5b1] leading-tight">Historical-data-driven component twins</div>
            </div>
          </div>
        </div>
        <nav className="flex-1 py-2">
          {NAV.map(({ to, label, icon: Icon, group }, i) => (
            <div key={to}>
              {group && NAV[i - 1]?.group !== group && <div className="px-4 pt-3 pb-1 text-[10px] uppercase tracking-wider text-[#7f8a96]">{group}</div>}
              <NavLink to={to} className={({ isActive }) => `flex items-center gap-2.5 px-4 py-[7px] text-[13px] transition-colors ${isActive ? 'bg-white/10 text-white border-l-2 border-accent-2' : 'text-[#c0c8d1] hover:bg-white/5 hover:text-white border-l-2 border-transparent'}`}>
                <Icon size={15} strokeWidth={1.8} />
                {label}
              </NavLink>
            </div>
          ))}
        </nav>
        <div className="px-4 py-3 border-t border-white/10 text-[11px] text-[#9aa5b1] space-y-1">
          <div className="flex items-center gap-1.5">
            <span className={`inline-block w-2 h-2 rounded-full ${apiOk === null ? 'bg-[#9aa5b1]' : apiOk ? 'bg-[#4caf7d]' : 'bg-[#d95f5f]'}`} />
            {apiOk === null ? 'Checking API…' : apiOk ? 'Backend connected' : 'Backend unreachable'}
          </div>
          <div className="flex items-center gap-1.5"><Database size={11} /> SQLite · demo data</div>
          <div className="pt-1 text-[10px] leading-snug">Research prototype — not for airworthiness or maintenance decisions.</div>
        </div>
      </aside>
      <main className="flex-1 min-w-0">
        <div className="px-6 py-5 max-w-[1500px]">
          {apiOk === false && (
            <div className="mb-4 border border-red/40 bg-red-soft rounded px-3 py-2 text-[12.5px]">
              The backend API is not reachable. Start it with <code className="num">uvicorn app.main:app --reload --port 8000</code> inside <code className="num">backend/</code>.
            </div>
          )}
          <Outlet />
        </div>
      </main>
      <div className="fixed bottom-4 right-4 flex flex-col gap-2 z-50 w-[360px]">
        {toasts.map((t) => (
          <div key={t.id} className={`flex items-start gap-2 rounded border px-3 py-2 text-[12.5px] shadow-sm bg-white ${t.kind === 'error' ? 'border-red/50' : t.kind === 'success' ? 'border-green/50' : t.kind === 'warning' ? 'border-amber/50' : 'border-line-strong'}`}>
            <div className="flex-1">{t.message}</div>
            <button onClick={() => dismiss(t.id)} className="text-ink-3 hover:text-ink" aria-label="Dismiss">
              <X size={14} />
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}
