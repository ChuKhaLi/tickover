import { describe, it, expect } from 'vitest'
import { quoteStudy, PRICING, RULES } from '../src/index.js'

describe('quoteStudy', () => {
  it('prices an untargeted study at base with half to the developer', () => {
    expect(quoteStudy({ targeted: false, atCost: false })).toEqual({ priceCents: 100, developerCents: 50 })
  })
  it('adds the targeting surcharge and splits it', () => {
    expect(quoteStudy({ targeted: true, atCost: false })).toEqual({ priceCents: 150, developerCents: 75 })
  })
  it('prices an at-cost first study at developer share plus fee', () => {
    expect(quoteStudy({ targeted: false, atCost: true })).toEqual({ priceCents: 55, developerCents: 50 })
    expect(quoteStudy({ targeted: true, atCost: true })).toEqual({ priceCents: 80, developerCents: 75 })
  })
  it('exposes the spec constants', () => {
    expect(PRICING.MIN_RESPONDENTS).toBe(50)
    expect(RULES.MAX_PAID_PER_DAY).toBe(10)
    expect(RULES.RESERVATION_MINUTES).toBe(10)
  })
})
