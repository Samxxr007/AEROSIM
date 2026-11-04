import { useFrame } from '@react-three/fiber'
import { useMemo, useRef } from 'react'
import * as THREE from 'three'
import { jitter, Label, Leader, useHeatMaterial, useSmoothSignals } from './common'
import type { DamageSignals, LiveSignals } from './signals'
import { healthColor } from './signals'

const ACTUATION_HZ: Record<string, number> = { taxi: 0.35, takeoff: 1.2, climb: 0.5, cruise: 0.18, manoeuvring: 2.0, descent: 0.65, landing: 1.5, idle: 0.1 }

/**
 * Linear hydraulic actuator: rod-end → piston rod → cylinder barrel with gland seal → ports → clevis.
 * Live: rod strokes at the phase actuation rate, barrel pressure glow, fluid temperature emissive.
 * Damage: gland seal fades/thins with wear_indicator and leakage droplets appear past the seal.
 */
export default function HydraulicActuator({ signals, damage, labels = true }: { signals: LiveSignals; damage: DamageSignals; labels?: boolean }) {
  const smooth = useSmoothSignals(signals)
  const group = useRef<THREE.Group>(null)
  const rod = useRef<THREE.Group>(null)
  const drops = useRef<THREE.Group>(null)
  const { mat: barrelMat, setHeat } = useHeatMaterial('#4b5563', 0.8, 0.4)
  const pressMat = useMemo(() => new THREE.MeshStandardMaterial({ color: '#38bdf8', emissive: new THREE.Color('#38bdf8'), emissiveIntensity: 0.2, transparent: true, opacity: 0.35 }), [])
  const sealMat = useMemo(() => new THREE.MeshStandardMaterial({ color: '#f5b041', roughness: 0.8 }), [])
  const wear = damage.state.wear_indicator ?? 0
  const wearFrac = damage.fractions.wear_indicator ?? 0
  const phaseRef = useRef(0)

  useFrame((_, dt) => {
    const s = smooth.current
    const hz = ACTUATION_HZ[signals.phase] ?? 0.2
    if (signals.playing || signals.phase === 'idle') phaseRef.current += dt * hz * Math.PI * 2
    if (rod.current) rod.current.position.x = 0.35 + 0.28 * Math.sin(phaseRef.current)
    pressMat.emissiveIntensity = 0.15 + 1.2 * s.pressure
    pressMat.opacity = 0.2 + 0.4 * s.pressure
    setHeat(s.temperature, 0.6)
    sealMat.color.lerpColors(new THREE.Color('#f5b041'), new THREE.Color('#3a2a10'), wearFrac)
    if (drops.current) {
      drops.current.visible = wearFrac > 0.3
      drops.current.children.forEach((d, i) => {
        d.position.y -= dt * (0.35 + 0.1 * i)
        if (d.position.y < -0.6) d.position.y = -0.2 - 0.1 * i
        ;(d as THREE.Mesh).scale.setScalar(0.5 + wearFrac)
      })
    }
    if (group.current) {
      const j = jitter(0.002 + 0.006 * s.vibration, s.t, 33)
      group.current.position.set(j[0], j[1], j[2])
    }
  })

  return (
    <group ref={group} position={[0, 0.5, 0]}>
      {/* clevis / mounting lug */}
      <mesh position={[-1.25, 0, 0]} rotation={[Math.PI / 2, 0, 0]} castShadow>
        <cylinderGeometry args={[0.12, 0.12, 0.3, 24]} />
        <meshStandardMaterial color="#9aa3ad" metalness={0.9} roughness={0.3} />
      </mesh>
      <mesh position={[-1.1, 0, 0]} castShadow>
        <boxGeometry args={[0.3, 0.2, 0.32]} />
        <meshStandardMaterial color="#6b7684" metalness={0.8} roughness={0.45} />
      </mesh>
      {/* barrel */}
      <mesh position={[-0.35, 0, 0]} rotation={[0, 0, Math.PI / 2]} castShadow receiveShadow material={barrelMat}>
        <cylinderGeometry args={[0.22, 0.22, 1.3, 40]} />
      </mesh>
      {/* pressure chamber glow (visible through cut-out) */}
      <mesh position={[-0.35, 0, 0]} rotation={[0, 0, Math.PI / 2]} material={pressMat}>
        <cylinderGeometry args={[0.17, 0.17, 1.2, 32]} />
      </mesh>
      <mesh position={[-0.35, 0.2, 0]}>
        <boxGeometry args={[0.9, 0.06, 0.16]} />
        <meshStandardMaterial color="#0a0f16" />
      </mesh>
      {/* end caps & ports */}
      {[-1.0, 0.3].map((x) => (
        <mesh key={x} position={[x, 0, 0]} rotation={[0, 0, Math.PI / 2]} castShadow>
          <cylinderGeometry args={[0.26, 0.26, 0.1, 40]} />
          <meshStandardMaterial color="#2a3442" metalness={0.6} roughness={0.6} />
        </mesh>
      ))}
      {[-0.85, 0.15].map((x) => (
        <mesh key={x} position={[x, 0.27, 0]} castShadow>
          <cylinderGeometry args={[0.05, 0.05, 0.16, 16]} />
          <meshStandardMaterial color="#c3ccd6" metalness={0.9} roughness={0.3} />
        </mesh>
      ))}
      {/* gland seal (wear site) */}
      <mesh position={[0.36, 0, 0]} rotation={[0, 0, Math.PI / 2]} material={sealMat} scale={[1, 1 - 0.6 * wearFrac, 1]}>
        <torusGeometry args={[0.12, 0.035, 12, 32]} />
      </mesh>
      {/* leakage droplets */}
      <group ref={drops} position={[0.42, -0.2, 0]}>
        {[0, 1, 2].map((i) => (
          <mesh key={i} position={[0.02 * i, -0.1 * i, 0.08 * (i - 1)]}>
            <sphereGeometry args={[0.018, 8, 8]} />
            <meshStandardMaterial color="#c0392b" emissive="#f0605d" emissiveIntensity={0.6} />
          </mesh>
        ))}
      </group>
      {/* piston rod + rod end */}
      <group ref={rod}>
        <mesh position={[0.4, 0, 0]} rotation={[0, 0, Math.PI / 2]} castShadow>
          <cylinderGeometry args={[0.09, 0.09, 1.1, 32]} />
          <meshStandardMaterial color="#e3e9f0" metalness={1} roughness={0.1} />
        </mesh>
        <mesh position={[1.0, 0, 0]} rotation={[Math.PI / 2, 0, 0]} castShadow>
          <cylinderGeometry args={[0.12, 0.12, 0.26, 24]} />
          <meshStandardMaterial color="#9aa3ad" metalness={0.9} roughness={0.3} />
        </mesh>
      </group>
      {labels && (
        <>
          <Leader from={[0.36, 0.3, 0.2]} to={[0.36, 0.08, 0.1]} color={healthColor(wearFrac)} />
          <Label position={[0.36, 0.5, 0.2]} tone={wearFrac > 0.75 ? 'bad' : wearFrac > 0.45 ? 'warn' : 'good'}>
            seal wear W {wear.toFixed(3)} · {(wearFrac * 100).toFixed(0)} % of leak limit
          </Label>
          {signals.raw && (
            <Label position={[-0.35, -0.5, 0]} small>
              {signals.raw.pressure_bar != null ? `${signals.raw.pressure_bar.toFixed(0)} bar` : ''} {signals.raw.temperature_c != null ? ` · ${signals.raw.temperature_c.toFixed(0)} °C fluid` : ''} · {signals.phase}
            </Label>
          )}
        </>
      )}
    </group>
  )
}
