import { describe, expect, it } from 'vitest'
import { fmt, fmtState } from '../utils/format'

describe('formatting helpers', () => {
  it('formats state variables with units', () => {
    expect(fmtState('crack_length_m', 0.006)).toBe('6.000 mm')
    expect(fmtState('pit_depth_m', 1.2e-4)).toBe('120.0 µm')
    expect(fmtState('creep_strain', 0.0042)).toBe('0.4200 %')
    expect(fmtState('miner_damage', 0.38)).toBe('0.38000')
    expect(fmtState('flights', 1860)).toBe('1,860')
  })
  it('handles missing values', () => {
    expect(fmt.num(null)).toBe('—')
    expect(fmt.pct(undefined)).toBe('—')
    expect(fmt.num(1.2345e-7)).toBe('1.23e-7')
  })
})
