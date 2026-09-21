import { describe, it, expect } from 'vitest'
import { formatCents } from '../../src/app/lib/money'

describe('formatCents', () => {
  it('formats dollars with two decimals and a sign', () => {
    expect(formatCents(2750)).toBe('$27.50')
    expect(formatCents(5)).toBe('$0.05')
    expect(formatCents(-100)).toBe('-$1.00')
    expect(formatCents(0)).toBe('$0.00')
  })
})
