import { useFrame } from '@react-three/fiber'
import { useMemo, useRef } from 'react'
import * as THREE from 'three'
import { jitter, Label, Leader, useSmoothSignals } from './common'
import type { DamageSignals, LiveSignals } from './signals'
import { healthColor, heatColor } from './signals'

function airfoilShape(chord: number, thick: number): THREE.Shape {
  const s = new THREE.Shape()
  const n = 28
  const pts: [number, number][] = []
  for (let i = 0; i <= n; i++) {
    const x = i / n
    const yt = (thick / 0.2) * 5 * (0.2969 * Math.sqrt(x) - 0.126 * x - 0.3516 * x * x + 0.2843 * x ** 3 - 0.1036 * x ** 4) * chord
    const camber = 0.12 * chord * Math.sin(Math.PI * x)
    pts.push([x * chord - chord / 2, camber + yt])
  }
  for (let i = n; i >= 0; i--) {
    const x = i / n
    const yt = (thick / 0.2) * 5 * (0.2969 * Math.sqrt(x) - 0.126 * x - 0.3516 * x * x + 0.2843 * x ** 3 - 0.1036 * x ** 4) * chord
    const camber = 0.12 * chord * Math.sin(Math.PI * x)
    pts.push([x * chord - chord / 2, camber - yt])
  }
  s.moveTo(pts[0][0], pts[0][1])
  pts.slice(1).forEach(([x, y]) => s.lineTo(x, y))
  s.closePath()
  return s
}

/**
 * HPT blade: fir-tree root → platform → twisted airfoil (stacked extruded sections) → tip shroud.
 * Live: emissive follows metal temperature (dull red → orange → yellow), spin on the rotor hub, vibration jitter.
 * Damage: blade elongation from creep strain (exaggerated), darkening oxide skin, thermal-fatigue crazing at the leading edge.
 */
export default function TurbineBlade({ signals, damage, labels = true }: { signals: LiveSignals; damage: DamageSignals; labels?: boolean }) {
  const smooth = useSmoothSignals(signals)
  const group = useRef<THREE.Group>(null)
  const blade = useRef<THREE.Group>(null)
  const hub = useRef<THREE.Mesh>(null)
  const bladeMat = useMemo(() => new THREE.MeshStandardMaterial({ color: '#9aa3ad', metalness: 0.75, roughness: 0.42, emissive: new THREE.Color('#000'), emissiveIntensity: 1 }), [])
  const oxideMat = useMemo(() => new THREE.MeshStandardMaterial({ color: '#2b1c12', roughness: 1, metalness: 0.05, transparent: true, opacity: 0 }), [])
  const sections = useMemo(() => {
    const out: { geom: THREE.ExtrudeGeometry; y: number; twist: number }[] = []
    const n = 6
    for (let i = 0; i < n; i++) {
      const f = i / (n - 1)
      const chord = 0.46 - 0.1 * f
      const geom = new THREE.ExtrudeGeometry(airfoilShape(chord, 0.14 - 0.05 * f), { depth: 1.0 / n + 0.01, bevelEnabled: false, steps: 1 })
      geom.rotateX(-Math.PI / 2)
      out.push({ geom, y: i / n, twist: -0.25 + 0.75 * f })
    }
    return out
  }, [])
  const creepFrac = damage.fractions.creep_strain ?? 0
  const oxideFrac = damage.fractions.oxide_thickness_m ?? 0
  const tfFrac = damage.fractions.thermal_fatigue_damage ?? 0
  const creepPct = (damage.state.creep_strain ?? 0) * 100
  const oxideUm = (damage.state.oxide_thickness_m ?? 0) * 1e6

  useFrame((_, dt) => {
    const s = smooth.current
    const [r, g, b] = heatColor(s.temperature)
    const inten = Math.max(0, s.temperature - 0.1) * 1.4
    bladeMat.emissive.setRGB(r * inten, g * inten, b * inten)
    bladeMat.color.setRGB(0.6 - 0.25 * oxideFrac, 0.64 - 0.3 * oxideFrac, 0.68 - 0.35 * oxideFrac)
    oxideMat.opacity = 0.15 + 0.7 * oxideFrac
    if (blade.current) blade.current.scale.y = 1 + 0.12 * creepFrac
    if (hub.current) hub.current.rotation.y += (0.3 + 4.5 * s.load) * dt
    if (group.current) {
      const j = jitter(0.002 + 0.008 * s.vibration, s.t, 53)
      group.current.position.set(j[0], j[1], j[2])
    }
  })

  return (
    <group ref={group}>
      {/* rotor disc segment */}
      <mesh ref={hub} position={[0, -0.25, 0]} receiveShadow>
        <cylinderGeometry args={[0.9, 0.9, 0.18, 64, 1, false, 0, Math.PI * 2]} />
        <meshStandardMaterial color="#2a3442" metalness={0.6} roughness={0.6} />
      </mesh>
      {/* fir-tree root */}
      {[0, 1, 2].map((i) => (
        <mesh key={i} position={[0, -0.1 + i * 0.08, 0]} castShadow>
          <boxGeometry args={[0.32 - i * 0.05, 0.06, 0.16 + i * 0.02]} />
          <meshStandardMaterial color="#7d8793" metalness={0.8} roughness={0.4} />
        </mesh>
      ))}
      {/* platform */}
      <mesh position={[0, 0.16, 0]} castShadow receiveShadow>
        <boxGeometry args={[0.5, 0.06, 0.34]} />
        <meshStandardMaterial color="#6b7684" metalness={0.8} roughness={0.45} />
      </mesh>
      {/* airfoil */}
      <group ref={blade} position={[0, 0.19, 0]}>
        {sections.map((sec, i) => (
          <group key={i} position={[0, sec.y, 0]} rotation={[0, sec.twist, 0]}>
            <mesh geometry={sec.geom} material={bladeMat} castShadow receiveShadow />
            <mesh geometry={sec.geom} material={oxideMat} scale={[1.03, 1.0, 1.08]} />
          </group>
        ))}
        {/* leading-edge thermal-fatigue crazing */}
        {tfFrac > 0.03 &&
          Array.from({ length: 7 }, (_, i) => (
            <mesh key={i} position={[-0.21 + 0.03 * ((i * 0.7) % 1), 0.2 + i * 0.1, 0.02 * Math.sin(i)]} rotation={[0, 0.3, 0.2 * Math.sin(i * 2)]}>
              <boxGeometry args={[0.004, 0.03 + 0.08 * tfFrac, 0.004]} />
              <meshBasicMaterial color={healthColor(tfFrac)} />
            </mesh>
          ))}
        {/* tip shroud */}
        <mesh position={[0, 1.04, 0]} castShadow>
          <boxGeometry args={[0.4, 0.04, 0.3]} />
          <meshStandardMaterial color="#7d8793" metalness={0.8} roughness={0.45} />
        </mesh>
      </group>
      {/* cooling-air glow at root when hot */}
      <pointLight position={[0, 0.6, 0]} intensity={signals.temperature * 2.5} distance={3} color="#ff9a3c" />
      {labels && (
        <>
          <Leader from={[0.5, 0.95, 0.25]} to={[0.12, 1.1, 0.05]} color={healthColor(creepFrac)} />
          <Label position={[0.9, 0.95, 0.3]} tone={creepFrac > 0.75 ? 'bad' : creepFrac > 0.45 ? 'warn' : 'good'}>
            creep ε {creepPct.toFixed(3)} % · {(creepFrac * 100).toFixed(0)} % of limit
          </Label>
          <Label position={[-0.85, 0.5, 0]} tone={oxideFrac > 0.75 ? 'bad' : oxideFrac > 0.45 ? 'warn' : 'default'} small>
            oxide {oxideUm.toFixed(1)} µm · TF {(damage.state.thermal_fatigue_damage ?? 0).toFixed(3)}
          </Label>
          {signals.raw && (
            <Label position={[0, 1.55, 0]} small>
              {signals.raw.temperature_c != null ? `${signals.raw.temperature_c.toFixed(0)} °C metal` : ''} {signals.raw.pressure_bar != null ? ` · ${signals.raw.pressure_bar.toFixed(1)} bar` : ''} · {signals.phase}
            </Label>
          )}
        </>
      )}
    </group>
  )
}
