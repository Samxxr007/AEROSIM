import { Html } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import { useMemo, useRef } from 'react'
import * as THREE from 'three'
import type { LiveSignals } from './signals'
import { heatColor } from './signals'

/** Per-frame low-pass filtered copy of the live signals, so the 3D part moves smoothly between samples. */
export function useSmoothSignals(sig: LiveSignals, rate = 6) {
  const ref = useRef({ load: sig.load, temperature: sig.temperature, vibration: sig.vibration, pressure: sig.pressure, t: 0 })
  useFrame((_, dt) => {
    const k = 1 - Math.exp(-rate * dt)
    const s = ref.current
    s.load += (sig.load - s.load) * k
    s.temperature += (sig.temperature - s.temperature) * k
    s.vibration += (sig.vibration - s.vibration) * k
    s.pressure += (sig.pressure - s.pressure) * k
    s.t += dt
  })
  return ref
}

/** Metallic material whose emissive channel follows the thermal signal. */
export function useHeatMaterial(base = '#8d98a6', metalness = 0.85, roughness = 0.35) {
  const mat = useMemo(() => new THREE.MeshStandardMaterial({ color: new THREE.Color(base), metalness, roughness, emissive: new THREE.Color('#000000'), emissiveIntensity: 1 }), [base, metalness, roughness])
  const setHeat = (t: number, gain = 1) => {
    const [r, g, b] = heatColor(t)
    const inten = Math.max(0, t - 0.15) * gain
    mat.emissive.setRGB(r * inten, g * inten, b * inten)
  }
  return { mat, setHeat }
}

/** Strain-tinted material: blue (compression / low) → cyan → amber → red with load fraction. */
export function strainColor(f: number): THREE.Color {
  const c = new THREE.Color()
  const x = Math.max(0, Math.min(1, f))
  if (x < 0.5) c.lerpColors(new THREE.Color('#5f7d99'), new THREE.Color('#38bdf8'), x / 0.5)
  else if (x < 0.8) c.lerpColors(new THREE.Color('#38bdf8'), new THREE.Color('#f5b041'), (x - 0.5) / 0.3)
  else c.lerpColors(new THREE.Color('#f5b041'), new THREE.Color('#f0605d'), (x - 0.8) / 0.2)
  return c
}

export function Label({ position, children, tone = 'default', small = false }: { position: [number, number, number]; children: React.ReactNode; tone?: 'default' | 'warn' | 'bad' | 'good' | 'accent'; small?: boolean }) {
  const color = tone === 'bad' ? 'border-red/60 text-red' : tone === 'warn' ? 'border-amber/60 text-amber' : tone === 'good' ? 'border-green/60 text-green' : tone === 'accent' ? 'border-accent/60 text-accent-2' : 'border-line-strong text-ink-2'
  return (
    <Html position={position} center distanceFactor={small ? 4.2 : 4.8} zIndexRange={[10, 0]} style={{ pointerEvents: 'none' }}>
      <div className={`whitespace-nowrap rounded border bg-[#0a0f16]/85 backdrop-blur px-1.5 py-0.5 font-mono text-[11px] leading-tight ${color}`}>{children}</div>
    </Html>
  )
}

/** Thin glowing line used to point from a label to a feature. */
export function Leader({ from, to, color = '#38bdf8' }: { from: [number, number, number]; to: [number, number, number]; color?: string }) {
  const geom = useMemo(() => new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(...from), new THREE.Vector3(...to)]), [from, to])
  return (
    <line>
      <primitive object={geom} attach="geometry" />
      <lineBasicMaterial color={color} transparent opacity={0.6} />
    </line>
  )
}

/** Vibration jitter helper. */
export function jitter(amount: number, t: number, f = 37): [number, number, number] {
  return [Math.sin(t * f) * amount, Math.sin(t * f * 1.37 + 1) * amount * 0.7, Math.cos(t * f * 0.91) * amount * 0.5]
}
