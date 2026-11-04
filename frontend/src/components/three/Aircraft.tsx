import { Html } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import { useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import type { ModelType } from '../../api/types'
import { healthColor } from './signals'

export interface Hotspot {
  id: string
  name: string
  model_type: ModelType | null
  position: string | null
  health: number // 0…1 fraction of review limit (governing mechanism)
  status: string
  label?: string
}

const SLOT: Record<string, [number, number, number]> = {
  'engine_mount:LH': [0.35, -0.08, 1.55],
  'engine_mount:RH': [0.35, -0.08, -1.55],
  'landing_gear:LH': [-0.1, -0.62, 0.75],
  'landing_gear:RH': [-0.1, -0.62, -0.75],
  'turbine_blade:engine 1': [0.1, -0.35, 1.55],
  'turbine_blade:engine 2': [0.1, -0.35, -1.55],
  'hydraulic_actuator:LH outboard aileron': [-0.55, 0.0, 3.1],
  'hydraulic_actuator:RH outboard aileron': [-0.55, 0.0, -3.1],
}

function slotFor(h: Hotspot, i: number): [number, number, number] {
  const pos = (h.position ?? '').toLowerCase()
  const side = pos.includes('rh') || pos.includes('right') || pos.includes('2') ? 'RH' : 'LH'
  const key = `${h.model_type}:${h.model_type === 'turbine_blade' ? (side === 'LH' ? 'engine 1' : 'engine 2') : h.model_type === 'hydraulic_actuator' ? `${side} outboard aileron` : side}`
  return SLOT[key] ?? [-2.2 + i * 0.4, 0.9, 0]
}

function wingGeometry(span: number, rootChord: number, tipChord: number, sweep: number, thickness: number) {
  const s = new THREE.Shape()
  s.moveTo(0, 0)
  s.lineTo(rootChord, 0)
  s.lineTo(rootChord - sweep - (rootChord - tipChord) * 0.3, span)
  s.lineTo(-sweep, span)
  s.closePath()
  const g = new THREE.ExtrudeGeometry(s, { depth: thickness, bevelEnabled: true, bevelThickness: 0.02, bevelSize: 0.03, bevelSegments: 2 })
  g.rotateX(-Math.PI / 2)
  g.rotateY(Math.PI)
  return g
}

/**
 * Twin-engine narrow-body demonstration aircraft (procedural). Nose points +x, left wing +z.
 * Hotspots mark the component instances and are coloured by the governing health fraction.
 */
export default function Aircraft({ hotspots, phase = 'idle', selected, onSelect, flying = false }: { hotspots: Hotspot[]; phase?: string; selected?: string | null; onSelect?: (id: string) => void; flying?: boolean }) {
  const root = useRef<THREE.Group>(null)
  const gear = useRef<THREE.Group>(null)
  const fans = useRef<THREE.Group[]>([])
  const [hover, setHover] = useState<string | null>(null)
  const wing = useMemo(() => wingGeometry(3.3, 1.25, 0.45, 0.9, 0.09), [])
  const htail = useMemo(() => wingGeometry(1.15, 0.6, 0.3, 0.4, 0.05), [])
  const skin = useMemo(() => new THREE.MeshStandardMaterial({ color: '#d7dee7', metalness: 0.35, roughness: 0.45 }), [])
  const dark = useMemo(() => new THREE.MeshStandardMaterial({ color: '#2a3442', metalness: 0.6, roughness: 0.6 }), [])

  useFrame((_, dt) => {
    const t = performance.now() / 1000
    const pitchTarget = phase === 'climb' ? 0.14 : phase === 'takeoff' ? 0.09 : phase === 'descent' ? -0.07 : phase === 'landing' ? 0.05 : 0
    const bob = flying ? Math.sin(t * 0.8) * 0.02 : 0
    if (root.current) {
      root.current.rotation.z += (pitchTarget - root.current.rotation.z) * Math.min(1, dt * 2)
      root.current.position.y += (bob + (flying ? 0.25 : 0) - root.current.position.y) * Math.min(1, dt * 2)
      root.current.rotation.x = flying && phase === 'manoeuvring' ? Math.sin(t * 0.6) * 0.18 : root.current.rotation.x * (1 - Math.min(1, dt * 2))
    }
    const gearTarget = ['climb', 'cruise', 'manoeuvring', 'descent'].includes(phase) ? 0 : 1
    if (gear.current) gear.current.scale.y += (gearTarget - gear.current.scale.y) * Math.min(1, dt * 3)
    const spin = flying ? 18 : 2.5
    fans.current.forEach((f) => f && (f.rotation.x += spin * dt))
  })

  return (
    <group ref={root}>
      {/* fuselage */}
      <mesh rotation={[0, 0, Math.PI / 2]} castShadow receiveShadow material={skin}>
        <capsuleGeometry args={[0.42, 5.2, 8, 24]} />
      </mesh>
      {/* cockpit glazing */}
      <mesh position={[2.55, 0.22, 0]} rotation={[0, 0, -0.35]}>
        <boxGeometry args={[0.5, 0.16, 0.5]} />
        <meshStandardMaterial color="#0e2a3b" metalness={0.2} roughness={0.2} emissive="#38bdf8" emissiveIntensity={0.25} />
      </mesh>
      {/* cabin window strip */}
      <mesh position={[0.3, 0.12, 0]} rotation={[0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[0.425, 0.425, 3.6, 24, 1, true, 0, Math.PI * 2]} />
        <meshStandardMaterial color="#38bdf8" transparent opacity={0.08} side={THREE.DoubleSide} />
      </mesh>
      {/* wings */}
      <mesh geometry={wing} position={[0.6, -0.12, 0]} material={skin} castShadow receiveShadow />
      <mesh geometry={wing} position={[0.6, -0.12, 0]} scale={[1, 1, -1]} material={skin} castShadow receiveShadow />
      {/* tail */}
      <mesh geometry={htail} position={[-2.65, 0.15, 0]} material={skin} castShadow />
      <mesh geometry={htail} position={[-2.65, 0.15, 0]} scale={[1, 1, -1]} material={skin} castShadow />
      <mesh position={[-2.65, 0.55, 0]} rotation={[0, 0, 0.55]} castShadow>
        <boxGeometry args={[0.95, 1.1, 0.06]} />
        <meshStandardMaterial color="#38bdf8" metalness={0.4} roughness={0.4} emissive="#1f6f8b" emissiveIntensity={0.3} />
      </mesh>
      {/* engines + pylons */}
      {[1.55, -1.55].map((z, i) => (
        <group key={z} position={[0.45, -0.42, z]}>
          <mesh position={[-0.1, 0.25, 0]} material={dark} castShadow>
            <boxGeometry args={[0.7, 0.3, 0.12]} />
          </mesh>
          <mesh rotation={[0, 0, Math.PI / 2]} material={dark} castShadow receiveShadow>
            <cylinderGeometry args={[0.3, 0.34, 1.1, 32, 1, true]} />
          </mesh>
          <mesh rotation={[0, 0, Math.PI / 2]} position={[0.02, 0, 0]}>
            <cylinderGeometry args={[0.29, 0.29, 1.0, 32]} />
            <meshStandardMaterial color="#9aa3ad" metalness={0.8} roughness={0.35} />
          </mesh>
          <group ref={(el) => el && (fans.current[i] = el)} position={[0.56, 0, 0]} rotation={[0, 0, Math.PI / 2]}>
            {Array.from({ length: 10 }, (_, k) => (
              <mesh key={k} rotation={[0, (k / 10) * Math.PI * 2, 0]} position={[0, 0, 0]}>
                <boxGeometry args={[0.02, 0.01, 0.52]} />
                <meshStandardMaterial color="#c3ccd6" metalness={0.9} roughness={0.3} />
              </mesh>
            ))}
          </group>
          <pointLight position={[-0.7, 0, 0]} intensity={flying ? 1.2 : 0.2} distance={1.5} color="#ff9a3c" />
        </group>
      ))}
      {/* landing gear */}
      <group ref={gear}>
        {[[1.9, 0], [-0.1, 0.75], [-0.1, -0.75]].map(([x, z], i) => (
          <group key={i} position={[x, -0.45, z]}>
            <mesh position={[0, -0.12, 0]}>
              <cylinderGeometry args={[0.03, 0.03, 0.3, 10]} />
              <meshStandardMaterial color="#9aa3ad" metalness={0.9} roughness={0.3} />
            </mesh>
            <mesh position={[0, -0.3, 0]} rotation={[Math.PI / 2, 0, 0]}>
              <cylinderGeometry args={[0.08, 0.08, 0.08, 16]} />
              <meshStandardMaterial color="#141a22" roughness={0.95} />
            </mesh>
          </group>
        ))}
      </group>
      {/* hotspots */}
      {hotspots.map((h, i) => {
        const p = slotFor(h, i)
        const col = healthColor(h.health)
        const active = selected === h.id || hover === h.id
        return (
          <group key={h.id} position={p}>
            <mesh onClick={(e) => { e.stopPropagation(); onSelect?.(h.id) }} onPointerOver={(e) => { e.stopPropagation(); setHover(h.id); document.body.style.cursor = 'pointer' }} onPointerOut={() => { setHover(null); document.body.style.cursor = 'auto' }}>
              <sphereGeometry args={[active ? 0.12 : 0.085, 16, 16]} />
              <meshBasicMaterial color={col} />
            </mesh>
            <mesh>
              <sphereGeometry args={[active ? 0.3 : 0.2, 16, 16]} />
              <meshBasicMaterial color={col} transparent opacity={active ? 0.22 : 0.1} depthWrite={false} />
            </mesh>
            <Html position={[0, 0.26, 0]} center distanceFactor={7} zIndexRange={[20, 0]} style={{ pointerEvents: 'none' }}>
              <div className={`whitespace-nowrap rounded border px-1.5 py-0.5 font-mono text-[11px] leading-tight backdrop-blur ${active ? 'bg-[#0a0f16]/95 border-accent text-white' : 'bg-[#0a0f16]/75 border-line-strong text-ink-2'}`}>
                {h.id} <span style={{ color: col }}>●</span> {(h.health * 100).toFixed(0)} %
              </div>
            </Html>
          </group>
        )
      })}
    </group>
  )
}
