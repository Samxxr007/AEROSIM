import { useFrame } from '@react-three/fiber'
import { useMemo, useRef } from 'react'
import * as THREE from 'three'
import { jitter, Label, Leader, strainColor, useHeatMaterial, useSmoothSignals } from './common'
import type { DamageSignals, LiveSignals } from './signals'
import { healthColor } from './signals'

/**
 * Main landing gear: trunnion → outer cylinder → sliding piston → axle → twin wheels, torque links.
 * Live: oleo compresses with load, wheels spin on the ground phases, strain tint on the piston.
 * Damage: corrosion pits on the chrome piston sized from pit_depth_m / limit; crack halo at the axle fillet.
 */
export default function LandingGear({ signals, damage, labels = true }: { signals: LiveSignals; damage: DamageSignals; labels?: boolean }) {
  const smooth = useSmoothSignals(signals)
  const group = useRef<THREE.Group>(null)
  const slider = useRef<THREE.Group>(null)
  const wheels = useRef<THREE.Group>(null)
  const pistonMat = useMemo(() => new THREE.MeshStandardMaterial({ color: '#d9e1ea', metalness: 1, roughness: 0.12 }), [])
  const { mat: strutMat, setHeat } = useHeatMaterial('#3f4a58', 0.7, 0.5)
  const onGround = ['taxi', 'takeoff', 'landing', 'idle'].includes(signals.phase)
  const pitFrac = damage.fractions.pit_depth_m ?? 0
  const pitUm = (damage.state.pit_depth_m ?? 0) * 1e6
  const crackFrac = damage.fractions.crack_length_m ?? 0
  const pits = useMemo(() => Array.from({ length: 14 }, (_, i) => ({ a: (i * 2.399) % (Math.PI * 2), y: 0.15 + ((i * 0.618) % 1) * 0.75, s: 0.6 + ((i * 0.37) % 1) * 0.8 })), [])

  useFrame((_, dt) => {
    const s = smooth.current
    const compress = onGround ? 0.08 + 0.3 * s.load : 0.02
    if (slider.current) slider.current.position.y = -compress
    if (group.current) {
      const j = jitter(0.003 + 0.01 * s.vibration, s.t, 29)
      group.current.position.set(j[0], 0, j[2])
    }
    if (wheels.current) {
      const spin = onGround && signals.playing ? (signals.phase === 'landing' ? 18 : signals.phase === 'takeoff' ? 14 : 5) : 0
      wheels.current.children.forEach((w) => (w.rotation.x += spin * dt))
    }
    pistonMat.color.copy(strainColor(onGround ? s.load : 0.08)).lerp(new THREE.Color('#d9e1ea'), 0.55)
    setHeat(s.temperature, 0.5)
  })

  return (
    <group ref={group} position={[0, 0, 0]}>
      {/* trunnion / attachment */}
      <mesh position={[0, 2.35, 0]} rotation={[0, 0, Math.PI / 2]} castShadow>
        <cylinderGeometry args={[0.1, 0.1, 1.1, 24]} />
        <meshStandardMaterial color="#c3ccd6" metalness={0.9} roughness={0.3} />
      </mesh>
      <mesh position={[0, 2.35, 0]} castShadow>
        <boxGeometry args={[0.5, 0.3, 0.42]} />
        <meshStandardMaterial color="#2a3442" metalness={0.5} roughness={0.7} />
      </mesh>
      {/* outer cylinder */}
      <mesh position={[0, 1.65, 0]} castShadow receiveShadow material={strutMat}>
        <cylinderGeometry args={[0.2, 0.22, 1.3, 32]} />
      </mesh>
      {/* side brace */}
      <mesh position={[0.45, 1.9, 0]} rotation={[0, 0, -0.75]} castShadow>
        <cylinderGeometry args={[0.05, 0.05, 1.2, 16]} />
        <meshStandardMaterial color="#3f4a58" metalness={0.7} roughness={0.5} />
      </mesh>
      {/* sliding piston + axle + wheels (moves with compression) */}
      <group ref={slider}>
        <mesh position={[0, 0.85, 0]} castShadow material={pistonMat}>
          <cylinderGeometry args={[0.14, 0.14, 1.1, 32]} />
        </mesh>
        {/* corrosion pits on the chrome */}
        {pitFrac > 0.02 &&
          pits.map((p, i) => (
            <mesh key={i} position={[Math.cos(p.a) * 0.14, 0.33 + p.y, Math.sin(p.a) * 0.14]} scale={0.02 + 0.08 * pitFrac * p.s}>
              <sphereGeometry args={[1, 10, 10]} />
              <meshStandardMaterial color="#3a1c0c" roughness={1} metalness={0.1} emissive={healthColor(pitFrac)} emissiveIntensity={0.25 * pitFrac} />
            </mesh>
          ))}
        {/* torque links */}
        <mesh position={[0.22, 1.2, 0]} rotation={[0, 0, 0.9]} castShadow>
          <boxGeometry args={[0.07, 0.5, 0.12]} />
          <meshStandardMaterial color="#6b7684" metalness={0.7} roughness={0.5} />
        </mesh>
        <mesh position={[0.22, 0.75, 0]} rotation={[0, 0, -0.9]} castShadow>
          <boxGeometry args={[0.07, 0.5, 0.12]} />
          <meshStandardMaterial color="#6b7684" metalness={0.7} roughness={0.5} />
        </mesh>
        {/* axle */}
        <mesh position={[0, 0.3, 0]} rotation={[Math.PI / 2, 0, 0]} castShadow>
          <cylinderGeometry args={[0.07, 0.07, 1.25, 20]} />
          <meshStandardMaterial color="#c3ccd6" metalness={0.9} roughness={0.3} />
        </mesh>
        {crackFrac > 0.02 && (
          <mesh position={[0, 0.34, 0]}>
            <sphereGeometry args={[0.14 + 0.2 * crackFrac, 16, 16]} />
            <meshBasicMaterial color={healthColor(crackFrac)} transparent opacity={0.1 + 0.15 * crackFrac} depthWrite={false} />
          </mesh>
        )}
        <group ref={wheels}>
          {[-0.5, 0.5].map((z) => (
            <group key={z} position={[0, 0.3, z]}>
              <mesh rotation={[0, 0, 0]} castShadow receiveShadow>
                <torusGeometry args={[0.24, 0.1, 16, 40]} />
                <meshStandardMaterial color="#141a22" roughness={0.95} />
              </mesh>
              <mesh rotation={[Math.PI / 2, 0, 0]}>
                <cylinderGeometry args={[0.16, 0.16, 0.16, 24]} />
                <meshStandardMaterial color="#aab4c0" metalness={0.8} roughness={0.35} />
              </mesh>
              {[0, 1, 2, 3, 4].map((k) => (
                <mesh key={k} position={[Math.cos((k / 5) * Math.PI * 2) * 0.1, Math.sin((k / 5) * Math.PI * 2) * 0.1, 0.085 * Math.sign(z)]}>
                  <sphereGeometry args={[0.016, 8, 8]} />
                  <meshStandardMaterial color="#2a3442" />
                </mesh>
              ))}
            </group>
          ))}
        </group>
      </group>
      {labels && (
        <>
          <Leader from={[0.5, 0.9, 0.2]} to={[0.16, 0.9, 0.05]} color={healthColor(pitFrac)} />
          <Label position={[0.95, 0.9, 0.2]} tone={pitFrac > 0.75 ? 'bad' : pitFrac > 0.45 ? 'warn' : 'good'}>
            pit depth {pitUm.toFixed(0)} µm · {(pitFrac * 100).toFixed(0)} % of limit
          </Label>
          <Label position={[-0.9, 1.65, 0]} tone="accent" small>
            Miner D {(damage.state.miner_damage ?? 0).toFixed(3)} · landings {Math.round(damage.state.landings ?? 0)}
          </Label>
          {signals.raw && (
            <Label position={[0, 2.85, 0]} small>
              {signals.raw.load_kN != null ? `${signals.raw.load_kN.toFixed(0)} kN` : ''} {signals.raw.vibration_g != null ? ` · ${signals.raw.vibration_g.toFixed(2)} g` : ''} · {signals.phase}
            </Label>
          )}
        </>
      )}
    </group>
  )
}
