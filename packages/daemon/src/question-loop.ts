import { z } from 'zod'
import { RULES, evaluateEligibility, isEarning, DeveloperSelf, type AssignmentState, type ServedQuestion, type AnswerSource } from '@tickover/contract'
import type { ServerClient } from './server-client.js'
import type { SessionTracker } from './sessions.js'
import type { State } from './state.js'
import { type AnswerQueue, type FlushResult, backoffMs } from './answer-queue.js'
import type { Log } from './log.js'
import type { SseHub } from './events.js'
import type { AnswerOutcome, QuestionView } from './http.js'

export const ANSWERED_TTL_MS = 10_000

// How many recent assignment outcomes evaluateEligibility ever looks at (the skip-pause streak
// check). Kept well above that so the array never grows without bound over a long-running daemon.
const RECENT_HISTORY_LIMIT = 10

// AnswerQueue.backoffMs's own 15-minute ceiling is tuned for a money-carrying retry that must not
// give up -- for polling next(), which carries no money, that's a real cost: a brief 5xx blip
// would otherwise cost the developer up to 15 minutes of question availability (and a buyer's
// study, that much less fill), and 15 minutes is three times RULES.MIN_GAP_MINUTES, so the
// backoff could outlast the very gap rule it's pacing against (round2 finding5). Capped at
// whichever is lower, so it also can never exceed the gap rule if that rule is ever tuned below
// a minute.
const NEXT_POLL_MAX_BACKOFF_MS = Math.min(60_000, RULES.MIN_GAP_MINUTES * 60_000)

export interface QuestionLoopDeps {
  server: ServerClient
  sessions: SessionTracker
  state: State
  queue: AnswerQueue
  clock: () => Date
  log: Log
  hub: SseHub
  loggedIn: () => boolean
}

function utcDay(d: Date): string { return d.toISOString().slice(0, 10) }

function safeJsonParse(raw: string): unknown {
  try { return JSON.parse(raw) } catch { return undefined }
}

// The local mirror of a developer's balances, kept separate from `DeveloperSelf` (identity +
// balances together) so an answer response -- which only ever carries balances, never an
// identity -- can update this without ever having to invent one (I3). Persisted under its own kv
// key and preferred over `self`'s (possibly stale, last-heartbeat) balances in `view()`.
const Balances = z.object({
  balance_pending_cents: z.number().int(),
  balance_available_cents: z.number().int(),
  today_paid_answers: z.number().int(),
})
type Balances = z.infer<typeof Balances>

// This list must stay in sync with @tickover/contract's AssignmentState union -- the contract
// package exports it only as a type, not a runtime value, so there's nothing to import here.
const ASSIGNMENT_STATES = ['served', 'answered', 'skipped', 'expired', 'late'] as const
const History = z.object({
  lastServedAt: z.string().nullable(),
  recent: z.array(z.enum(ASSIGNMENT_STATES)),
  lastSkipAt: z.string().nullable(),
  profileDay: z.string(),
  profileToday: z.number().int().nonnegative(),
})
type History = z.infer<typeof History>

/**
 * Owns the one-question-at-a-time policy: when to ask the server for a question, when a shown
 * question expires or has been answered long enough to stop showing the checkmark, and how
 * answers/skips are recorded. Talks to ServerClient, AnswerQueue, SessionTracker and State only
 * through their interfaces -- no HTTP routing or SQL lives here.
 */
export class QuestionLoop {
  current: { question: ServedQuestion; shownAt: Date } | null = null
  answered: { earnedCents: number; at: Date } | null = null
  self: DeveloperSelf | null = null
  private balances: Balances | null = null
  // Local frequency history that evaluateEligibility is driven by. Persisted (I4): without this,
  // a restart resets every one of these to the exact inputs that make evaluateEligibility approve
  // everything -- the 5-minute gap, the two-skip pause and the daily profile cap all evaporate.
  private lastServedAt: Date | null = null
  private recent: AssignmentState[] = []
  private lastSkipAt: Date | null = null
  private profileDay = ''
  private profileToday = 0
  // Guards against a second tick() starting a second /api/dev/next call while one is already
  // outstanding (the long poll can take up to RULES.LONG_POLL_SECONDS).
  private inFlight = false
  // Backoff state for a failing (or empty) next() call, independent of AnswerQueue's own backoff.
  // Not persisted: worst case a restart makes one extra next() call sooner than it otherwise
  // would, which is harmless.
  private nextNotBefore: Date | null = null
  private nextFailAttempts = 0

  constructor(private d: QuestionLoopDeps) {
    const savedSelf = d.state.get('self')
    if (savedSelf) {
      const parsed = DeveloperSelf.safeParse(safeJsonParse(savedSelf))
      if (parsed.success) this.self = parsed.data
    }
    const savedBalances = d.state.get('balances')
    if (savedBalances) {
      const parsed = Balances.safeParse(safeJsonParse(savedBalances))
      if (parsed.success) this.balances = parsed.data
    }
    const savedHistory = d.state.get('history')
    if (savedHistory) {
      const parsed = History.safeParse(safeJsonParse(savedHistory))
      if (parsed.success) {
        this.lastServedAt = parsed.data.lastServedAt ? new Date(parsed.data.lastServedAt) : null
        this.recent = [...parsed.data.recent]
        this.lastSkipAt = parsed.data.lastSkipAt ? new Date(parsed.data.lastSkipAt) : null
        this.profileDay = parsed.data.profileDay
        this.profileToday = parsed.data.profileToday
      }
    }
  }

  setSelf(self: DeveloperSelf): void {
    this.self = self
    this.d.state.set('self', JSON.stringify(self))
    // A real setSelf (a heartbeat or login response, Task 8/9) is server-authoritative and must
    // win over whatever this loop has locally cached in `balances` -- otherwise currentBalances()
    // permanently shadows the one mechanism (a fresh heartbeat) that would ever correct a stale
    // local `today_paid_answers`, e.g. across a UTC day rollover: a restart the day after 10 paid
    // answers would load a stale balances.today_paid_answers of 10 and evaluateEligibility would
    // report daily_cap forever, with no path back to the server's already-correct (reset) count.
    this.setBalances({ balance_pending_cents: self.balance_pending_cents, balance_available_cents: self.balance_available_cents, today_paid_answers: self.today_paid_answers })
  }

  private setBalances(b: Balances): void {
    this.balances = b
    this.d.state.set('balances', JSON.stringify(b))
  }

  private currentBalances(): Balances {
    if (this.balances) return this.balances
    if (this.self) return { balance_pending_cents: this.self.balance_pending_cents, balance_available_cents: this.self.balance_available_cents, today_paid_answers: this.self.today_paid_answers }
    return { balance_pending_cents: 0, balance_available_cents: 0, today_paid_answers: 0 }
  }

  view(): QuestionView {
    const b = this.currentBalances()
    return {
      question: this.current?.question ?? null,
      shown_at: this.current?.shownAt.toISOString() ?? null,
      balance_pending_cents: b.balance_pending_cents,
      balance_available_cents: b.balance_available_cents,
      today_paid_answers: b.today_paid_answers,
      logged_in: this.d.loggedIn(),
    }
  }

  private broadcast(): void { this.d.hub.broadcast('question', this.view()) }

  private pushRecent(state: AssignmentState): void {
    this.recent.unshift(state)
    if (this.recent.length > RECENT_HISTORY_LIMIT) this.recent.length = RECENT_HISTORY_LIMIT
  }

  /**
   * One entry per assignment, as the server keeps it (serve.ts reads each assignment's state): the
   * current question's 'served' becomes its outcome rather than gaining a second entry. Pushing
   * both left two skips as [skipped, served, skipped, served], so the skip-pause streak in
   * evaluateEligibility never saw two skips in a row and never fired here (audit, R921).
   *
   * Called only while a question is current, and the head is then always that question's 'served':
   * tick() pushes it on serve and nothing else pushes while `current` is set, and `current` is not
   * persisted, so no restart can leave a current question without it. A history written by an older
   * daemon interleaves 'served' entries; they read as non-skips, so it can only delay a pause.
   */
  private settleRecent(state: AssignmentState): void {
    this.recent[0] = state
  }

  private saveHistory(): void {
    this.d.state.set('history', JSON.stringify({
      lastServedAt: this.lastServedAt ? this.lastServedAt.toISOString() : null,
      recent: this.recent,
      lastSkipAt: this.lastSkipAt ? this.lastSkipAt.toISOString() : null,
      profileDay: this.profileDay,
      profileToday: this.profileToday,
    }))
  }

  private profileAnswersToday(now: Date): number {
    if (this.profileDay !== utcDay(now)) { this.profileDay = utcDay(now); this.profileToday = 0 }
    return this.profileToday
  }

  private applyResponse(r: { balance_pending_cents: number; balance_available_cents: number; today_paid_answers: number }): void {
    this.setBalances({ balance_pending_cents: r.balance_pending_cents, balance_available_cents: r.balance_available_cents, today_paid_answers: r.today_paid_answers })
  }

  // Registered with AnswerQueue at construction (round3) as its `onResolved` callback, invoked
  // exactly once per row, from inside the very pass that resolves it -- never derived here from a
  // flush() result array, which a concurrent caller can end up sharing or overlapping with. That
  // was exactly how round 3's double-broadcast bug happened: two callers each iterating a `sent`
  // array that contained the same already-resolved row. Nothing in QuestionLoop iterates a
  // FlushResult[] to decide what to notify any more; this is the only place that decision is made.
  //
  // Both branches broadcast 'answered' here, unconditionally -- answer() relies on this being the
  // ONE place a resolved row's outcome is ever announced (see answer()'s `mine` handling below),
  // for exactly the same reason the failure case needs it: whichever pass actually resolves a row
  // is the only place that can announce it without risking a second, independent announcement
  // from whoever else happens to be holding (or awaiting into) the same or an overlapping pass.
  handleFlushResult(result: FlushResult): void {
    if (result.ok) this.applyResponse(result.response)
    else this.d.log.error('answer permanently lost', { id: result.id, reason: result.reason })
    // Unconditional, and deliberately hoisted out of both branches so the invariant -- every
    // resolved row broadcasts the resulting state exactly once -- lives in one checkable place.
    // Success is round3 finding4: a balance correction discovered by a background flush must be
    // pushed over SSE immediately, not wait for something unrelated to broadcast next. Failure is
    // round4: round 3 broadcast only on success, so a permanently rejected answer (C1's revoked
    // token) cleared `current` with no `question` event at all -- the live GET was right, but an
    // SSE-only surface (the VS Code extension, the localhost page) went on showing a question the
    // developer had already answered until some unrelated broadcast happened.
    this.broadcast()
    // The reason divergence here is intentional: this event carries the specific reason
    // ('rejected'/'abandoned') to every surface, while answer()'s HTTP response below collapses
    // both to 'failed' for the one client that submitted. Different audiences -- not a bug.
    this.d.hub.broadcast('answered', result.ok
      ? { accepted: result.response.accepted, reason: result.response.reason, earned_cents: result.response.earned_cents }
      : { accepted: false, reason: result.reason, earned_cents: 0 })
  }

  async tick(): Promise<void> {
    const now = this.d.clock()
    // Flushing while logged out is worse than doing nothing: ServerClient throws a plain
    // "not logged in" Error (not a ServerError), which AnswerQueue's catch can't tell apart from
    // a transient failure, so it counts as a real attempt against MAX_ATTEMPTS every 2 seconds.
    // Left running, a developer logged out for ~12 hours would have a real, already-given answer
    // abandoned for money it will never pay out (M4). The return value is never read here --
    // handleFlushResult() above already did everything it could do for every row that resolved.
    if (this.d.loggedIn()) {
      await this.d.queue.flush()
    }

    if (this.current && now.getTime() > new Date(this.current.question.expires_at).getTime()) {
      this.d.log.info('question expired locally', { assignment: this.current.question.assignment_id })
      this.current = null
      this.settleRecent('expired')
      this.saveHistory()
      this.broadcast()
    }
    if (this.answered && now.getTime() - this.answered.at.getTime() > ANSWERED_TTL_MS) {
      this.answered = null
      this.broadcast()
    }

    if (!this.d.loggedIn() || this.current || this.inFlight) return
    if (this.nextNotBefore && now.getTime() < this.nextNotBefore.getTime()) return
    const turn = this.d.sessions.activeTurn()
    if (!turn) return

    const elig = evaluateEligibility({
      now,
      sessionStartedAt: turn.sessionStartedAt,
      turnStartedAt: turn.turnStartedAt,
      lastServedAt: this.lastServedAt,
      recentStates: this.recent,
      lastSkipAt: this.lastSkipAt,
      paidAnswersToday: this.currentBalances().today_paid_answers,
      profileAnswersToday: this.profileAnswersToday(now),
    })
    // elig.retryAfterMs is intentionally discarded: re-evaluating eligibility locally on the next
    // tick is cheap, unlike an actual network round trip to the real server (which IS backed off
    // via nextNotBefore below).
    if (!elig.ok) return

    this.inFlight = true
    try {
      const res = await this.d.server.next({
        session_id: turn.sessionId,
        session_started_at: turn.sessionStartedAt.toISOString(),
        turn_started_at: turn.turnStartedAt.toISOString(),
      })
      this.nextFailAttempts = 0
      if (res.question) {
        this.current = { question: res.question, shownAt: this.d.clock() }
        this.lastServedAt = this.current.shownAt
        this.pushRecent('served')
        this.saveHistory()
        this.nextNotBefore = null
        this.broadcast()
      } else {
        // Nothing available right now -- honour the server's own retry hint instead of asking
        // again next tick (I2). No question was served, so history/eligibility are untouched.
        this.nextNotBefore = res.retry_after_ms !== undefined ? new Date(now.getTime() + res.retry_after_ms) : null
      }
    } catch (err) {
      this.d.log.error('next failed', { message: (err as Error).message })
      // A down or rate-limiting server must not be hammered every tickIntervalMs forever (I2).
      // Reuses AnswerQueue's own doubling schedule, but with its own, much lower ceiling
      // (round2 finding5) -- see NEXT_POLL_MAX_BACKOFF_MS above.
      this.nextNotBefore = new Date(this.d.clock().getTime() + backoffMs(this.nextFailAttempts, NEXT_POLL_MAX_BACKOFF_MS))
      this.nextFailAttempts += 1
    } finally {
      this.inFlight = false
    }
  }

  async answer(input: { assignmentId: string; optionIndex: number; source: AnswerSource }): Promise<AnswerOutcome> {
    const now = this.d.clock()
    const cur = this.current
    if (!cur || cur.question.assignment_id !== input.assignmentId) return { accepted: false, reason: 'not_current', earned_cents: 0 }
    if (input.optionIndex < 0 || input.optionIndex >= cur.question.options.length) return { accepted: false, reason: 'invalid_option', earned_cents: 0 }
    // There is deliberately no local RULES.LATE_GRACE_MINUTES check here (whole-branch review I6).
    // tick() clears `current` at exactly expires_at and runs every 2 seconds, so a grace window
    // measured from expires_at was unreachable in production -- the only tests that reached it did
    // so by skipping the tick, pinning behaviour the product never exhibits. The grace belongs to
    // the server, which already distinguishes a `late` answer and pays nothing for it, and to the
    // queue's retry path, where an answer given in time can still be delivered late. An answer
    // arriving in the seconds between expires_at and the next tick therefore goes out normally and
    // the server's own verdict comes back through answerNotice(), rather than this loop guessing.

    const id = this.d.queue.enqueue({
      assignmentId: input.assignmentId,
      optionIndex: input.optionIndex,
      // A backwards wall-clock adjustment must never produce a negative latency: the contract
      // requires non-negative, and a negative value would reach the wire, 400, and fall into the
      // permanent-drop path below (I1).
      latencyMs: Math.max(0, now.getTime() - cur.shownAt.getTime()),
      source: input.source,
    })
    if (cur.question.kind === 'profile') {
      this.profileAnswersToday(now)
      this.profileToday += 1
    }
    this.current = null
    this.settleRecent('answered')
    this.saveHistory()

    // Same reasoning as tick()'s M4 guard: flushing while logged out can't succeed (ServerClient
    // throws before any request goes out) but still burns one retry attempt against MAX_ATTEMPTS
    // via AnswerQueue's generic backoff path (round2 finding6). Bounded to one per answer() call
    // rather than the continuous drain M4 closed, but it's the same defect and the same fix.
    const sent = this.d.loggedIn() ? await this.d.queue.flush() : []
    const mine = sent.find((s) => s.id === id)
    let outcome: AnswerOutcome
    if (mine) {
      // Already fully handled by handleFlushResult() above -- applied (on success) and broadcast,
      // including its own 'answered' event -- from inside the very pass that resolved it. Never
      // decide that from `sent` here: a concurrent caller can be awaiting the same or an
      // overlapping pass (round3), and re-deriving a notification from a shared result array is
      // exactly how the double-broadcast bug happened. This block only reads `mine` to build
      // answer()'s own HTTP return value.
      // 'failed' deliberately collapses 'rejected' and 'abandoned': this is the reply to the one
      // client that submitted, which only needs "it didn't land". The SSE 'answered' event that
      // handleFlushResult already emitted carries the specific reason for every other surface.
      outcome = mine.ok
        ? { accepted: mine.response.accepted, reason: mine.response.reason, earned_cents: mine.response.earned_cents }
        : { accepted: false, reason: 'failed', earned_cents: 0 }
      // isEarning, not `accepted` (I6): the server returns `duplicate` as accepted:true with zero
      // cents, and showing the checkmark for it printed `✓ +$0.00` on the status line -- a payment
      // of nothing rather than "already counted". answerNotice() carries the explanation instead.
      this.answered = isEarning(outcome) ? { earnedCents: outcome.earned_cents, at: now } : null
    } else {
      // Still queued -- nothing resolved this row in this pass (offline, the server was
      // unreachable, or a transient retry was merely rescheduled). Nothing else will ever
      // announce this outcome unless it resolves later, so this is the one case answer() must
      // broadcast itself.
      outcome = { accepted: true, reason: 'queued', earned_cents: cur.question.price_cents }
      this.answered = { earnedCents: outcome.earned_cents, at: now }
      this.broadcast()
      this.d.hub.broadcast('answered', outcome)
    }
    return outcome
  }

  async skip(assignmentId: string): Promise<boolean> {
    const cur = this.current
    if (!cur || cur.question.assignment_id !== assignmentId) return false
    this.current = null
    this.lastSkipAt = this.d.clock()
    this.settleRecent('skipped')
    this.saveHistory()
    this.broadcast()
    // Best-effort: the developer's local view already cleared regardless of whether the server
    // ever hears about the skip, so a network failure here is logged, not surfaced.
    try {
      await this.d.server.skip(assignmentId)
    } catch (err) {
      this.d.log.error('skip failed', { message: (err as Error).message })
    }
    return true
  }
}
