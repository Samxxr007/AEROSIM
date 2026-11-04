import { useFrame } from '@react-three/fiber'
import { isValidElement, useEffect, useMemo, useRef } from 'react'
import type { ReactNode } from 'react'
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

function flattenLabelText(node: ReactNode): string {
  if (node == null || typeof node === 'boolean') return ''
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(flattenLabelText).join('')
  if (isValidElement<{ children?: ReactNode }>(node)) return flattenLabelText(node.props.children)
  return ''
}

/** Camera-facing engineering annotation rendered as a Three.js sprite.
 *  Unlike drei Html portals this never inserts an extra DOM node beside the WebGL canvas,
 *  so route changes/unmounts remain owned by the Three.js renderer.
 */
export function Label({ position, children, tone = 'default', small = false }: { position: [number, number, number]; children: ReactNode; tone?: 'default' | 'warn' | 'bad' | 'good' | 'accent'; small?: boolean }) {
  const label = flattenLabelText(children).replace(/\s+/g, ' ').trim().slice(0, 120)
  const color = tone === 'bad' ? '#f0605d' : tone === 'warn' ? '#f5b041' : tone === 'good' ? '#3ddc97' : tone === 'accent' ? '#7dd3fc' : '#c2ceda'
  const texture = useMemo(() => {
    if (typeof document === 'undefined' || !label) return null
    const fontSize = small ? 19 : 23
    const paddingX = small ? 10 : 12
    const height = small ? 34 : 42
    const canvas = document.createElement('canvas')
    const measure = canvas.getContext('2d')
    if (!measure) return null
    measure.font = \`600 \${fontSize}px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace\`
    const width = Math.ceil(measure.measureText(label).width + paddingX * 2)
    canvas.width = Math.max(64, width)
    canvas.height = height
    const ctx = canvas.getContext('2d')
    if (!ctx) return null
    ctx.font = \`600 \${fontSize}px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace\`
    ctx.textBaseline = 'middle'
    ctx.fillStyle = 'rgba(10, 15, 22, 0.90)'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.strokeStyle = tone === 'default' ? 'rgba(110, 130, 150, 0.8)' : color
    ctx.lineWidth = 2
    ctx.strokeRect(1, 1, canvas.width - 2, canvas.height - 2)
    ctx.fillStyle = color
    ctx.fillText(label, paddingX, height / 2, canvas.width - paddingX * 2)
    const map = new THREE.CanvasTexture(canvas)
    map.colorSpace = THREE.SRGBColorSpace
    map.minFilter = THREE.LinearFilter
    map.magFilter = THREE.LinearFilter
    map.needsUpdate = true
    return map
  }, [label, color, small, tone])
  useEffect(() => () => texture?.dispose(), [texture])
  if (!texture) return null
  const image = texture.image as HTMLCanvasElement
  return (
    <sprite position={position} scale={[Math.min(3.8, image.width / 200), image.height / 200, 1]} renderOrder={1000}>
      <spriteMaterial map={texture} transparent depthWrite={false} />
    </sprite>
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
