import { useFrame } from '@react-three/fiber'
import { useMemo, useRef } from 'react'
import * as THREE from 'three'
import { jitter, Label, Leader, strainColor, useHeatMaterial, useSmoothSignals } from './common'
import type { DamageSignals, LiveSignals } from './signals'
import { healthColor } from './signals'

/**
 * Engine-mount link: pylon fitting (fixed) → forged mount beam → two attachment lugs → engine attach ring.
 * Live: beam bends and tints with load, group jitters with vibration, emissive follows temperature.
 * Damage: a crack wedge in the lower lug sized from crack_length_m / a_critical, a Miner-damage halo.
 */
export default function EngineMount({ signals, damage, labels = true }: { signals: LiveSignals; damage: DamageSignals; labels?: boolean }) {
  const smooth = useSmoothSignals(signals)
  const group = useRef<THREE.Group>(null)
  const beam = useRef<THREE.Group>(null)
  const ring = useRef<THREE.Mesh>(null)
  const beamMat = useMemo(() => new THREE.MeshStandardMaterial({ color: '#8d98a6', metalness: 0.8, roughness: 0.38 }), [])
  const { mat: heat, setHeat } = useHeatMaterial('#6b7684', 0.9, 0.3)
  const crackMat = useMemo(() => new THREE.MeshStandardMaterial({ color: '#05080c', emissive: new THREE.Color('#f0605d'), emissiveIntensity: 0.0, roughness: 1 }), [])
  const crackRef = useRef<THREE.Mesh>(null)

  const crackMm = (damage.state.crack_length_m ?? 0) * 1e3
  const crackFrac = damage.fractions.crack_length_m ?? 0
  const minerFrac = damage.fractions.miner_damage ?? 0

  useFrame(() => {
    const s = smooth.current
    if (group.current) {
      const j = jitter(0.004 + 0.012 * s.vibration, s.t, 41)
      group.current.position.set(j[0], j[1], j[2])
    }
    if (beam.current) {
      beam.current.rotation.z = -0.03 * s.load
      beam.current.scale.y = 1 - 0.015 * s.load
    }
    beamMat.color.copy(strainColor(s.load))
    beamMat.emissive.copy(strainColor(s.load)).multiplyScalar(0.25 * s.load)
    setHeat(s.temperature, 0.9)
    if (ring.current) ring.current.rotation.x += 0.002 + 0.01 * s.vibration
    if (crackRef.current) {
      const len = 0.03 + 0.42 * crackFrac
      crackRef.current.scale.set(len, 1, 1)
      crackMat.emissiveIntensity = crackFrac > 0.02 ? 0.5 + 0.5 * Math.sin(s.t * 3) * crackFrac : 0
    }
  })

  return (
    <group ref={group}>
      {/* pylon fitting (structure side) */}
      <mesh position={[-1.35, 0.55, 0]} castShadow receiveShadow>
        <boxGeometry args={[0.5, 1.1, 0.9]} />
        <meshStandardMaterial color="#2a3442" metalness={0.5} roughness={0.7} />
      </mesh>
      {[-0.3, 0.3].map((z) => (
        <mesh key={z} position={[-1.1, 0.55, z]} rotation={[0, 0, Math.PI / 2]} castShadow>
          <cylinderGeometry args={[0.06, 0.06, 0.12, 20]} />
          <meshStandardMaterial color="#c9d1dc" metalness={0.9} roughness={0.25} />
        </mesh>
      ))}
      {/* forged mount beam */}
      <group ref={beam} position={[-1.05, 0.55, 0]}>
        <mesh position={[0.9, 0, 0]} castShadow receiveShadow material={beamMat}>
          <boxGeometry args={[1.8, 0.34, 0.5]} />
        </mesh>
        {/* lightening pockets */}
        {[0.35, 0.95, 1.45].map((x) => (
          <mesh key={x} position={[x, 0, 0.26]}>
            <boxGeometry args={[0.36, 0.2, 0.02]} />
            <meshStandardMaterial color="#1b2430" metalness={0.6} roughness={0.8} />
          </mesh>
        ))}
        {/* upper lug */}
        <group position={[1.85, 0.3, 0]}>
          <mesh rotation={[Math.PI / 2, 0, 0]} castShadow material={heat}>
            <torusGeometry args={[0.17, 0.08, 14, 36]} />
          </mesh>
          <mesh rotation={[Math.PI / 2, 0, 0]}>
            <cylinderGeometry args={[0.09, 0.09, 0.6, 20]} />
            <meshStandardMaterial color="#d6dde6" metalness={0.95} roughness={0.2} />
          </mesh>
        </group>
        {/* lower lug — crack site */}
        <group position={[1.85, -0.3, 0]}>
          <mesh rotation={[Math.PI / 2, 0, 0]} castShadow material={heat}>
            <torusGeometry args={[0.17, 0.08, 14, 36]} />
          </mesh>
          <mesh rotation={[Math.PI / 2, 0, 0]}>
            <cylinderGeometry args={[0.09, 0.09, 0.6, 20]} />
            <meshStandardMaterial color="#d6dde6" metalness={0.95} roughness={0.2} />
          </mesh>
          {/* crack wedge, grows radially outward from the bore */}
          <mesh ref={crackRef} position={[0.0, -0.18, 0.0]} rotation={[0, 0, -0.5]} material={crackMat}>
            <boxGeometry args={[1, 0.012, 0.52]} />
          </mesh>
          {crackFrac > 0.02 && (
            <mesh position={[0.0, -0.22, 0]}>
              <sphereGeometry args={[0.16 + 0.3 * crackFrac, 20, 20]} />
              <meshBasicMaterial color={healthColor(crackFrac)} transparent opacity={0.08 + 0.12 * crackFrac} depthWrite={false} />
            </mesh>
          )}
        </group>
      </group>
      {/* engine attach ring */}
      <mesh ref={ring} position={[1.35, 0.55, 0]} rotation={[0, 0, Math.PI / 2]} castShadow>
        <torusGeometry args={[0.62, 0.12, 16, 48]} />
        <meshStandardMaterial color="#3b4654" metalness={0.75} roughness={0.5} />
      </mesh>
      <mesh position={[1.35, 0.55, 0]} rotation={[0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[0.5, 0.5, 0.16, 48, 1, true]} />
        <meshStandardMaterial color="#1b2430" metalness={0.6} roughness={0.6} side={THREE.DoubleSide} />
      </mesh>
      {labels && (
        <>
          <Leader from={[0.8, 0.25, 0]} to={[0.8, -0.35, 0.3]} color={healthColor(crackFrac)} />
          <Label position={[0.8, -0.5, 0.3]} tone={crackFrac > 0.75 ? 'bad' : crackFrac > 0.45 ? 'warn' : 'good'}>
            crack {crackMm.toFixed(2)} mm · {(crackFrac * 100).toFixed(0)} % of a_c
          </Label>
          <Label position={[-0.2, 1.1, 0]} tone="accent" small>
            Miner D {(damage.state.miner_damage ?? 0).toFixed(3)} · {(minerFrac * 100).toFixed(0)} %
          </Label>
          {signals.raw && (
            <Label position={[1.35, 1.45, 0]} small>
              {signals.raw.load_kN != null ? `${signals.raw.load_kN.toFixed(1)} kN` : ''} {signals.raw.temperature_c != null ? ` · ${signals.raw.temperature_c.toFixed(0)} °C` : ''} {signals.raw.vibration_g != null ? ` · ${signals.raw.vibration_g.toFixed(2)} g` : ''}
            </Label>
          )}
        </>
      )}
    </group>
  )
}
