import type { ModelType } from '../../api/types'

const ink = '#1f2933'
const line = '#52606d'
const accent = '#1f6f8b'
const red = '#b3261e'
const fill = '#eef0f2'
const fill2 = '#d9dee3'

function Caption({ children }: { children: React.ReactNode }) {
  return <div className="text-[10.5px] text-ink-3 mt-1 italic">{children} — Illustrative component representation, not manufacturing geometry.</div>
}

export function EngineMountSchematic({ crackFraction = 0.1, crackMm }: { crackFraction?: number; crackMm?: number }) {
  const cf = Math.min(1, Math.max(0.02, crackFraction))
  const crackLen = 26 * cf + 6
  return (
    <div>
      <svg viewBox="0 0 460 220" className="w-full h-auto" role="img" aria-label="Engine mount lug schematic">
        <defs>
          <pattern id="hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <line x1="0" y1="0" x2="0" y2="6" stroke={line} strokeWidth="1" />
          </pattern>
        </defs>
        {/* pylon box */}
        <rect x="20" y="20" width="110" height="180" fill="url(#hatch)" stroke={ink} strokeWidth="1.2" />
        <text x="75" y="14" textAnchor="middle" fontSize="10" fill={ink}>Pylon box (fixed)</text>
        {/* lug */}
        <path d="M130 70 L250 70 Q290 70 290 110 Q290 150 250 150 L130 150 Z" fill={fill} stroke={ink} strokeWidth="1.4" />
        <circle cx="250" cy="110" r="20" fill="#fff" stroke={ink} strokeWidth="1.4" />
        <circle cx="250" cy="110" r="8" fill={fill2} stroke={line} strokeWidth="1" />
        {/* crack from bore edge */}
        <path d={`M268 104 l${crackLen * 0.75} ${-crackLen * 0.45} l${crackLen * 0.2} ${-crackLen * 0.15}`} stroke={red} strokeWidth="1.8" fill="none" />
        <text x="300" y="150" fontSize="9.5" fill={red}>crack a{crackMm !== undefined ? ` = ${crackMm.toFixed(2)} mm` : ''}</text>
        {/* engine link */}
        <line x1="250" y1="110" x2="380" y2="60" stroke={accent} strokeWidth="5" strokeLinecap="round" />
        <circle cx="380" cy="60" r="9" fill="#fff" stroke={accent} strokeWidth="2" />
        <text x="392" y="56" fontSize="10" fill={ink}>to engine</text>
        {/* load arrows */}
        <line x1="385" y1="75" x2="340" y2="93" stroke={accent} strokeWidth="1.5" markerEnd="url(#arr)" />
        <defs>
          <marker id="arr" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">
            <path d="M0,0 L8,4 L0,8 z" fill={accent} />
          </marker>
        </defs>
        <text x="330" y="112" fontSize="10" fill={accent}>F (thrust + vertical)</text>
        {/* net section marker */}
        <line x1="235" y1="60" x2="235" y2="160" stroke={line} strokeDasharray="3 3" />
        <text x="140" y="175" fontSize="10" fill={line}>net section A_eff · σ = F/A_eff · ΔK = Y·Δσ·√(πa)</text>
        <text x="140" y="192" fontSize="10" fill={line}>edge crack at bore, geometry factor Y = const.</text>
      </svg>
      <Caption>Forward engine-mount lug with edge crack at the bore</Caption>
    </div>
  )
}

export function LandingGearSchematic({ pitFraction = 0.2 }: { pitFraction?: number }) {
  const n = Math.max(1, Math.round(6 * Math.min(1, pitFraction)))
  return (
    <div>
      <svg viewBox="0 0 420 220" className="w-full h-auto" role="img" aria-label="Landing gear schematic">
        <rect x="150" y="10" width="40" height="18" fill={fill2} stroke={ink} />
        <text x="196" y="23" fontSize="10" fill={ink}>trunnion</text>
        <rect x="160" y="28" width="22" height="100" fill={fill} stroke={ink} strokeWidth="1.4" />
        <text x="190" y="80" fontSize="10" fill={ink}>outer cylinder</text>
        <rect x="165" y="128" width="12" height="55" fill="#fff" stroke={ink} />
        <text x="183" y="160" fontSize="10" fill={ink}>piston</text>
        {/* fillet critical zone */}
        <path d="M160 118 q0 12 -12 12 h-8" fill="none" stroke={red} strokeWidth="1.5" />
        <text x="92" y="146" fontSize="9.5" fill={red}>critical fillet</text>
        {Array.from({ length: n }).map((_, i) => (
          <circle key={i} cx={158 - i * 3} cy={120 + i * 2} r="1.4" fill={red} />
        ))}
        <text x="60" y="160" fontSize="9.5" fill={red}>corrosion pits</text>
        {/* axle and wheels */}
        <rect x="120" y="183" width="100" height="8" fill={fill2} stroke={ink} />
        <ellipse cx="125" cy="187" rx="18" ry="22" fill="#fff" stroke={ink} strokeWidth="1.4" />
        <ellipse cx="215" cy="187" rx="18" ry="22" fill="#fff" stroke={ink} strokeWidth="1.4" />
        <line x1="90" y1="212" x2="260" y2="212" stroke={line} />
        <line x1="170" y1="212" x2="170" y2="195" stroke={accent} strokeWidth="2" markerEnd="url(#arr2)" />
        <defs>
          <marker id="arr2" markerWidth="8" markerHeight="8" refX="4" refY="1" orient="auto">
            <path d="M0,8 L4,0 L8,8 z" fill={accent} />
          </marker>
        </defs>
        <text x="240" y="208" fontSize="10" fill={accent}>touchdown load F_td</text>
        <text x="250" y="40" fontSize="10" fill={line}>σ = k_L·f_phase·F_ref/A_eff</text>
        <text x="250" y="54" fontSize="10" fill={line}>cycles: touchdown, taxi bumps,</text>
        <text x="250" y="68" fontSize="10" fill={line}>take-off unloading, retraction</text>
        <text x="250" y="90" fontSize="10" fill={line}>pit growth: dp/dt = r₀·f_env</text>
      </svg>
      <Caption>Main landing-gear outer cylinder with critical lower fillet</Caption>
    </div>
  )
}

export function TurbineBladeSchematic({ oxideFraction = 0.2 }: { oxideFraction?: number }) {
  const ox = Math.min(1, Math.max(0, oxideFraction))
  return (
    <div>
      <svg viewBox="0 0 420 220" className="w-full h-auto" role="img" aria-label="Turbine blade cross-section schematic">
        {/* fir-tree root */}
        <path d="M150 210 l-14 -12 l10 -8 l-10 -8 l10 -8 l-10 -8 l14 -10 h50 l14 10 l-10 8 l10 8 l-10 8 l10 8 l-14 12 z" fill={fill2} stroke={ink} strokeWidth="1.3" />
        <text x="222" y="200" fontSize="10" fill={ink}>fir-tree root (centrifugal σ_c)</text>
        {/* airfoil section */}
        <path d="M175 156 C 150 110, 160 60, 200 25 C 230 55, 225 110, 205 156 Z" fill={fill} stroke={ink} strokeWidth="1.4" />
        {/* cooling passages */}
        <ellipse cx="190" cy="120" rx="7" ry="12" fill="#fff" stroke={line} />
        <ellipse cx="195" cy="80" rx="6" ry="10" fill="#fff" stroke={line} />
        <ellipse cx="200" cy="48" rx="4" ry="7" fill="#fff" stroke={line} />
        {/* oxide layer at leading edge */}
        <path d="M175 156 C 150 110, 160 60, 200 25" fill="none" stroke={red} strokeWidth={1 + 4 * ox} strokeOpacity="0.7" />
        <text x="110" y="60" fontSize="9.5" fill={red}>oxide x(t) ∝ √(k_p t)</text>
        <text x="232" y="40" fontSize="10" fill={line}>leading edge ΔT → Δε = k_c·α·ΔT</text>
        <text x="232" y="100" fontSize="10" fill={line}>ε̇ = A σⁿ exp(−Q/RT)</text>
        <line x1="190" y1="175" x2="190" y2="160" stroke={accent} strokeWidth="2" />
        <text x="196" y="172" fontSize="10" fill={accent}>σ_c (rpm²)</text>
        <text x="20" y="200" fontSize="10" fill={line}>T_metal = T_amb + k_T·f_phase·ΔT_ref</text>
      </svg>
      <Caption>HP turbine blade section with cooling passages and leading-edge oxide</Caption>
    </div>
  )
}

export function ActuatorSchematic({ wear = 0.3 }: { wear?: number }) {
  const w = Math.min(1, Math.max(0, wear))
  return (
    <div>
      <svg viewBox="0 0 420 220" className="w-full h-auto" role="img" aria-label="Hydraulic actuator schematic">
        <rect x="60" y="70" width="240" height="80" fill={fill} stroke={ink} strokeWidth="1.4" />
        <text x="62" y="62" fontSize="10" fill={ink}>cylinder body</text>
        {/* piston */}
        <rect x="170" y="78" width="18" height="64" fill={fill2} stroke={ink} strokeWidth="1.2" />
        <rect x="188" y="105" width="150" height="10" fill={fill2} stroke={ink} />
        <text x="300" y="100" fontSize="10" fill={ink}>rod → aileron</text>
        {/* seals */}
        <rect x="168" y="78" width="4" height="8" fill={red} />
        <rect x="168" y="134" width="4" height="8" fill={red} />
        <rect x="186" y="78" width="4" height="8" fill={red} />
        <rect x="186" y="134" width="4" height="8" fill={red} />
        <text x="140" y="165" fontSize="9.5" fill={red}>piston seals — wear W = {w.toFixed(2)}</text>
        {/* leakage arrows */}
        <path d="M172 90 q-6 20 0 40" fill="none" stroke={red} strokeWidth={0.5 + 2.5 * w} strokeDasharray="2 2" />
        <text x="100" y="118" fontSize="9.5" fill={red}>Q_leak = Q₀ + k_q·W</text>
        {/* ports */}
        <rect x="90" y="54" width="12" height="16" fill="#fff" stroke={ink} />
        <rect x="258" y="54" width="12" height="16" fill="#fff" stroke={ink} />
        <text x="76" y="48" fontSize="10" fill={accent}>p₁ (bar)</text>
        <text x="246" y="48" fontSize="10" fill={accent}>p₂ (bar)</text>
        <text x="60" y="190" fontSize="10" fill={line}>ΔW = k_w·n_p·(p/p_ref)^α·exp(β(T−T_ref))·(1+γW)</text>
        <text x="60" y="206" fontSize="10" fill={line}>n_p = actuation (pressure) cycles per flight phase</text>
      </svg>
      <Caption>Linear hydraulic servo-actuator with piston seals</Caption>
    </div>
  )
}

export function ComponentSchematic({ modelType, state, params }: { modelType: ModelType | null; state: Record<string, number>; params: Record<string, { value: number }> }) {
  if (modelType === 'engine_mount') {
    const a = state.crack_length_m ?? 0
    const ac = 0.02
    return <EngineMountSchematic crackFraction={a / ac} crackMm={a * 1e3} />
  }
  if (modelType === 'landing_gear') return <LandingGearSchematic pitFraction={(state.pit_depth_m ?? 0) / (params.pit_depth_limit_m?.value ?? 5e-4)} />
  if (modelType === 'turbine_blade') return <TurbineBladeSchematic oxideFraction={(state.oxide_thickness_m ?? 0) / (params.oxide_limit_m?.value ?? 3e-5)} />
  if (modelType === 'hydraulic_actuator') return <ActuatorSchematic wear={state.wear_indicator ?? 0} />
  return (
    <div className="border border-dashed border-line-strong rounded p-6 text-center text-[12px] text-ink-3">
      No schematic — catalogue-only component without an implemented prediction model.
    </div>
  )
}

/** Component–system dependency diagram: which evidence feeds which model block. */
export function SystemDependencyDiagram() {
  const box = (x: number, y: number, w: number, h: number, title: string, sub: string, color = accent) => (
    <g>
      <rect x={x} y={y} width={w} height={h} rx="4" fill="#fff" stroke={color} strokeWidth="1.3" />
      <text x={x + w / 2} y={y + 17} textAnchor="middle" fontSize="11" fontWeight="600" fill={ink}>{title}</text>
      <text x={x + w / 2} y={y + 32} textAnchor="middle" fontSize="9.5" fill={line}>{sub}</text>
    </g>
  )
  const arrow = (x1: number, y1: number, x2: number, y2: number, label?: string, color = line) => (
    <g>
      <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={color} strokeWidth="1.3" markerEnd="url(#dep-arr)" />
      {label && <text x={(x1 + x2) / 2} y={(y1 + y2) / 2 - 4} textAnchor="middle" fontSize="9" fill={color}>{label}</text>}
    </g>
  )
  return (
    <svg viewBox="0 0 760 300" className="w-full h-auto" role="img" aria-label="Digital twin dependency diagram">
      <defs>
        <marker id="dep-arr" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">
          <path d="M0,0 L8,4 L0,8 z" fill={line} />
        </marker>
      </defs>
      {box(20, 20, 150, 44, 'Flight conditions', 'scheduled · comparable · estimate')}
      {box(20, 130, 150, 44, 'Post-flight observations', 'by flight ID (actual)')}
      {box(20, 236, 150, 44, 'Inspection / maintenance', 'UT · EC · FPI · wear · repair', '#2f7d4f')}
      {box(230, 20, 160, 44, 'Response model', 'k_L · k_T · k_V · k_P → σ, T, p')}
      {box(230, 130, 160, 44, 'Reconciliation + gate', 'residuals · RLS · reliability')}
      {box(230, 236, 160, 44, 'Damage-state fusion', 'inverse-variance · coefficient ID', '#2f7d4f')}
      {box(450, 75, 160, 44, 'Degradation models', 'S-N/Miner · Paris · Norton · wear')}
      {box(450, 185, 160, 44, 'Twin state + version', 'D · a · ε_creep · W · v_n')}
      {box(640, 75, 100, 44, 'Pre-flight prediction', 'immutable · RUL')}
      {box(640, 185, 100, 44, 'Uncertainty', 'Monte Carlo')}
      {arrow(170, 42, 230, 42)}
      {arrow(390, 42, 450, 90, 'stress bins')}
      {arrow(170, 152, 230, 152)}
      {arrow(310, 130, 310, 64, 'Stage A: k_* only', accent)}
      {arrow(170, 258, 230, 258)}
      {arrow(390, 252, 450, 215, 'Stage B: state only', '#2f7d4f')}
      {arrow(530, 185, 530, 119)}
      {arrow(610, 97, 640, 97)}
      {arrow(610, 207, 640, 207)}
      {arrow(640, 112, 400, 148, 'predicted channels')}
      <text x="20" y="295" fontSize="9.5" fill={line}>Sensor residuals never reach the damage state directly; only reliable inspection evidence does.</text>
    </svg>
  )
}
