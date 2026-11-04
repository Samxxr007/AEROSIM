import { Canvas } from '@react-three/fiber'
import { ContactShadows, Grid, OrbitControls } from '@react-three/drei'
import type { ReactNode } from 'react'
import { Suspense } from 'react'

/**
 * Shared 3D stage: dark instrument-panel backdrop, three-point lighting, soft contact shadow,
 * engineering grid and orbit controls. All geometry inside is procedural (no external assets).
 */
export default function Scene({ children, camera = [3.2, 2.2, 3.6], target = [0, 0.4, 0], grid = true, autoRotate = false, className = '', fov = 38, minDistance = 1.5, maxDistance = 14, shadowY = -0.02 }: {
  children: ReactNode
  camera?: [number, number, number]
  target?: [number, number, number]
  grid?: boolean
  autoRotate?: boolean
  className?: string
  fov?: number
  minDistance?: number
  maxDistance?: number
  shadowY?: number
}) {
  return (
    <div className={`relative w-full h-full ${className}`}>
      <Canvas dpr={[1, 1.75]} camera={{ position: camera, fov, near: 0.05, far: 100 }} gl={{ antialias: true, alpha: true, powerPreference: 'high-performance' }} shadows>
        <color attach="background" args={['#0a0f16']} />
        <fog attach="fog" args={['#0a0f16', 9, 22]} />
        <hemisphereLight args={['#bfe3ff', '#101a26', 0.9]} />
        <directionalLight position={[4, 6, 3]} intensity={2.8} color="#ffffff" castShadow shadow-mapSize={[1024, 1024]} />
        <directionalLight position={[-5, 3, -4]} intensity={1.3} color="#7dd3fc" />
        <spotLight position={[0, 7, -5]} intensity={1.2} angle={0.6} penumbra={1} color="#a78bfa" />
        <Suspense fallback={null}>{children}</Suspense>
        <ContactShadows position={[0, shadowY, 0]} opacity={0.55} scale={12} blur={2.2} far={6} color="#000814" />
        {grid && <Grid position={[0, shadowY - 0.005, 0]} args={[20, 20]} cellSize={0.25} cellThickness={0.5} cellColor="#1a2634" sectionSize={1} sectionThickness={0.9} sectionColor="#24364a" fadeDistance={14} fadeStrength={1.6} infiniteGrid />}
        <OrbitControls target={target} enablePan={false} minDistance={minDistance} maxDistance={maxDistance} autoRotate={autoRotate} autoRotateSpeed={0.6} makeDefault />
      </Canvas>
    </div>
  )
}
