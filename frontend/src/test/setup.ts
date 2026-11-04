import '@testing-library/jest-dom/vitest'
import { afterEach, vi } from 'vitest'
import { cleanup } from '@testing-library/react'

// jsdom lacks ResizeObserver (used by Recharts' ResponsiveContainer)
class RO { observe() {} unobserve() {} disconnect() {} }
;(globalThis as unknown as { ResizeObserver: typeof RO }).ResizeObserver = RO

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})
