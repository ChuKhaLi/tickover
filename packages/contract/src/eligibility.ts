import { RULES } from './constants.js'

export type AssignmentState = 'served' | 'answered' | 'skipped' | 'expired' | 'late'

export interface EligibilityInput {
  now: Date
  sessionStartedAt: Date
  turnStartedAt: Date
  lastServedAt: Date | null
  recentStates: AssignmentState[]
  lastSkipAt: Date | null
  paidAnswersToday: number
  profileAnswersToday: number
}

export type Eligibility =
  | { ok: true; allowPaid: boolean; allowProfile: boolean }
  | { ok: false; reason: 'warmup' | 'turn_too_short' | 'gap' | 'skip_pause' | 'daily_cap'; retryAfterMs: number }

const MIN = 60_000

export function msUntilNextUtcDay(now: Date): number {
  const next = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1)
  return next - now.getTime()
}

export function evaluateEligibility(i: EligibilityInput): Eligibility {
  const t = i.now.getTime()
  const warmupEnds = i.sessionStartedAt.getTime() + RULES.SESSION_WARMUP_MINUTES * MIN
  if (t < warmupEnds) return { ok: false, reason: 'warmup', retryAfterMs: warmupEnds - t }
  const turnReady = i.turnStartedAt.getTime() + RULES.MIN_TURN_SECONDS * 1000
  if (t < turnReady) return { ok: false, reason: 'turn_too_short', retryAfterMs: turnReady - t }
  if (i.lastServedAt) {
    const gapEnds = i.lastServedAt.getTime() + RULES.MIN_GAP_MINUTES * MIN
    if (t < gapEnds) return { ok: false, reason: 'gap', retryAfterMs: gapEnds - t }
  }
  const recent = i.recentStates.slice(0, RULES.SKIP_STREAK)
  const streak = recent.length >= RULES.SKIP_STREAK && recent.every((s) => s === 'skipped')
  if (streak && i.lastSkipAt) {
    const pauseEnds = i.lastSkipAt.getTime() + RULES.SKIP_PAUSE_MINUTES * MIN
    if (t < pauseEnds) return { ok: false, reason: 'skip_pause', retryAfterMs: pauseEnds - t }
  }
  const allowPaid = i.paidAnswersToday < RULES.MAX_PAID_PER_DAY
  const allowProfile = i.profileAnswersToday < RULES.PROFILE_MAX_PER_DAY
  if (!allowPaid && !allowProfile) return { ok: false, reason: 'daily_cap', retryAfterMs: msUntilNextUtcDay(i.now) }
  return { ok: true, allowPaid, allowProfile }
}
