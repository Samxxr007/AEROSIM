import { lazy, Suspense } from 'react'
import type { ModelType } from '../../api/types'
import type { DamageSignals, LiveSignals } from './signals'

export { default as Scene } from './Scene'
export * from './signals'

const EngineMount = lazy(() => import('./EngineMount'))
const LandingGear = lazy(() => import('./LandingGear'))
const TurbineBlade = lazy(() => import('./TurbineBlade'))
const HydraulicActuator = lazy(() => import('./HydraulicActuator'))

export const CAMERA_FOR: Record<ModelType, { camera: [number, number, number]; target: [number, number, number]; shadowY: number }> = {
  engine_mount: { camera: [2.6, 2.6, 6.4], target: [0.1, 0.4, 0], shadowY: -0.25 },
  landing_gear: { camera: [3.8, 2.6, 4.2], target: [0, 1.25, 0], shadowY: 0.02 },
  turbine_blade: { camera: [2.5, 1.8, 3.3], target: [0, 0.55, 0], shadowY: -0.36 },
  hydraulic_actuator: { camera: [1.8, 2.1, 4.8], target: [0, 0.45, 0], shadowY: -0.02 },
}

/** Picks the procedural 3D model for a component type and feeds it the live & damage signals. */
export function ComponentModel({ modelType, signals, damage, labels = true }: { modelType: ModelType | null | undefined; signals: LiveSignals; damage: DamageSignals; labels?: boolean }) {
  if (!modelType) return null
  const M = modelType === 'engine_mount' ? EngineMount : modelType === 'landing_gear' ? LandingGear : modelType === 'turbine_blade' ? TurbineBlade : HydraulicActuator
  return (
    <Suspense fallback={null}>
      <M signals={signals} damage={damage} labels={labels} />
    </Suspense>
  )
}
