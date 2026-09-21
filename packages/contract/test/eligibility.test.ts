import { describe, it, expect } from 'vitest'
import { evaluateEligibility, msUntilNextUtcDay, type EligibilityInput } from '../src/index.js'

const T0 = new Date('2026-09-10T10:00:00Z')
const min = (n: number) => n * 60_000
const at = (ms: number) => new Date(T0.getTime() + ms)

function base(over: Partial<EligibilityInput> = {}): EligibilityInput {
  return {
    now: at(min(10)),
    sessionStartedAt: T0,
    turnStartedAt: at(min(10) - 9_000),
    lastServedAt: null,
    recentStates: [],
    lastSkipAt: null,
    paidAnswersToday: 0,
    profileAnswersToday: 0,
    ...over,
  }
}

describe('evaluateEligibility', () => {
  it('allows paid and profile when nothing blocks', () => {
    expect(evaluateEligibility(base())).toEqual({ ok: true, allowPaid: true, allowProfile: true })
  })
  it('blocks during the first 2 minutes of a session', () => {
    const r = evaluateEligibility(base({ now: at(min(1)), turnStartedAt: at(min(1) - 9_000) }))
    expect(r).toEqual({ ok: false, reason: 'warmup', retryAfterMs: min(1) })
  })
  it('blocks when the turn is younger than 8 seconds', () => {
    const r = evaluateEligibility(base({ turnStartedAt: at(min(10) - 3_000) }))
    expect(r).toEqual({ ok: false, reason: 'turn_too_short', retryAfterMs: 5_000 })
  })
  it('blocks within 5 minutes of the last served question', () => {
    const r = evaluateEligibility(base({ lastServedAt: at(min(8)) }))
    expect(r).toEqual({ ok: false, reason: 'gap', retryAfterMs: min(3) })
  })
  it('pauses for 60 minutes after two consecutive skips', () => {
    const r = evaluateEligibility(base({ recentStates: ['skipped', 'skipped'], lastSkipAt: at(min(4)) }))
    expect(r).toEqual({ ok: false, reason: 'skip_pause', retryAfterMs: min(54) })
  })
  it('does not pause after one skip', () => {
    const r = evaluateEligibility(base({ recentStates: ['skipped', 'answered'], lastSkipAt: at(min(4)) }))
    expect(r.ok).toBe(true)
  })
  it('disallows paid at the daily cap but still allows profile', () => {
    expect(evaluateEligibility(base({ paidAnswersToday: 10 }))).toEqual({ ok: true, allowPaid: false, allowProfile: true })
  })
  it('blocks entirely when both caps are reached, until the next UTC day', () => {
    const r = evaluateEligibility(base({ paidAnswersToday: 10, profileAnswersToday: 1 }))
    expect(r).toEqual({ ok: false, reason: 'daily_cap', retryAfterMs: msUntilNextUtcDay(at(min(10))) })
  })
})

describe('msUntilNextUtcDay', () => {
  it('measures to the next UTC midnight', () => {
    expect(msUntilNextUtcDay(new Date('2026-09-10T23:59:00Z'))).toBe(60_000)
  })
})
