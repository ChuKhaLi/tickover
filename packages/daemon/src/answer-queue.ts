import { randomBytes } from 'node:crypto'
import type { AnswerResponse, AnswerSource } from '@tickover/contract'
import type { State } from './state.js'
import type { Log } from './log.js'
import { ServerClient, ServerError, parseRetryAfterMs } from './server-client.js'

export const MAX_ATTEMPTS = 50
export const BASE_BACKOFF_MS = 60_000
export const MAX_BACKOFF_MS = 15 * 60_000

/**
 * The 4xx statuses a later attempt can still succeed on. Everything else in 4xx means the server
 * will never accept this exact request, so retrying only delays telling the developer the truth.
 *
 * Treating the whole of 4xx as permanent (the original shape) destroyed already-given answers for
 * money a single retry would have collected:
 *  - 401 -- the api token was revoked or expired. `tickover login` fixes it and the answer is
 *    still owed; dropping it turns a routine re-login into lost earnings.
 *  - 408, 425 -- request timeout and "too early". Transient by definition.
 *  - 429 -- the server's own limiter (@fastify/rate-limit, 120/minute). Its key generator falls
 *    back to the bare source ip whenever the bearer token does not resolve to a developer, which
 *    is exactly the 401 case above and is shared by everyone behind one NAT. A developer can hit
 *    this through no action of their own.
 */
export const RETRYABLE_CLIENT_STATUSES = new Set([401, 408, 425, 429])

// `dueAnswers` compares `next_at` as an ISO string in SQLite, so "count everything" needs a
// sentinel that still sorts after every real timestamp as plain text. A date past year 9999
// would serialize with the ISO extended-year form ("+275760-...", leading '+' = 0x2B), which
// sorts BEFORE any normal 4-digit year ("2026-..." starts with '2' = 0x32) and would silently
// undercount. Year 9999 stays inside the standard format, so it's a safe upper bound.
const FAR_FUTURE = new Date('9999-12-31T23:59:59.999Z')

// `maxMs` defaults to this queue's own 15-minute ceiling (money-carrying retries must not give
// up quickly) but is overridable -- QuestionLoop's next()-poll backoff (round2 finding5) shares
// this same doubling schedule with a much lower ceiling, since a brief server blip costing 15
// minutes of question availability is a real cost to both the developer and the buyer, not a
// safety margin worth preserving the way an unpaid answer's retry is.
export function backoffMs(attempts: number, maxMs: number = MAX_BACKOFF_MS): number {
  return Math.min(maxMs, BASE_BACKOFF_MS * 2 ** attempts)
}

// A processed row either went out and got a real response, or was permanently dropped -- a 4xx
// the server will never accept ('rejected', see RETRYABLE_CLIENT_STATUSES for the ones it will)
// or MAX_ATTEMPTS exhausted ('abandoned'), neither ever retried. Distinct from
// "still queued", which simply doesn't appear in flush()'s result at all. Callers must not treat
// "missing from the result" and "dropped" as the same thing: the former means "try again later",
// the latter means "never coming".
export type FlushResult =
  | { id: string; ok: true; response: AnswerResponse }
  | { id: string; ok: false; reason: 'rejected'; status: number }
  | { id: string; ok: false; reason: 'abandoned' }

export class AnswerQueue {
  // Chains flush() passes rather than sharing one in-flight result between callers (round3):
  // a caller finding nothing in flight starts a pass immediately (synchronously calling
  // doFlush(), so its dueAnswers() snapshot happens right then -- not deferred behind a .then(),
  // which would let a row enqueued a moment later sneak into a snapshot that should have already
  // excluded it); a caller finding a pass already running instead waits for it, then calls
  // flush() again, which by then finds nothing in flight and takes its own synchronous snapshot
  // in turn. Every pass is therefore always genuinely its own -- never shared with, or containing
  // rows resolved on behalf of, another caller. That's what makes exactly-once notification
  // possible (a row is resolved by exactly one pass, ever) and what lets a caller whose own row
  // wasn't in an overlapping pass get a real attempt and a real outcome, not a stand-in "queued".
  //
  // A pass that resolves nothing does not, by this design, trigger another: each flush() call
  // makes exactly one attempt (immediate, or chained after exactly one wait) -- there is no
  // self-perpetuating loop for an idle queue to get stuck in.
  private inFlight: Promise<FlushResult[]> | null = null

  constructor(
    private state: State,
    private server: ServerClient,
    private clock: () => Date,
    private log: Log,
    // Invoked exactly once, synchronously, at the moment a row is actually resolved (sent,
    // rejected, or abandoned) -- from inside doFlush()'s own processing loop, never derived from
    // flush()'s return value. Multiple callers can end up looking at the same or an overlapping
    // `sent` array (this is inherent to any reentrancy design, chained passes included, since a
    // caller only sees the outcome for the pass it's chained to); a caller iterating that array
    // to decide what to notify is exactly how round 3's double-broadcast bug happened. A callback
    // fired from here, once per row, at the single place that row is ever resolved, cannot
    // double-fire regardless of how many callers are awaiting which promise. Never called
    // directly from doFlush() -- always through notifyResolved(), which guards it.
    private onResolved: (result: FlushResult) => void = () => {},
  ) {}

  enqueue(a: { assignmentId: string; optionIndex: number; latencyMs: number; source: AnswerSource }): string {
    const id = randomBytes(8).toString('hex')
    this.state.enqueueAnswer({ id, assignmentId: a.assignmentId, optionIndex: a.optionIndex, latencyMs: a.latencyMs, source: a.source, idempotencyKey: a.assignmentId, attempts: 0, nextAt: this.clock().toISOString() })
    return id
  }

  pending(): number { return this.state.dueAnswers(FAR_FUTURE).length }

  flush(): Promise<FlushResult[]> {
    if (this.inFlight) {
      // `.catch(() => undefined)`, not a bare `.then()`: doFlush() itself never rejects (every
      // row's own failure is caught internally), but if a future change ever let one through, one
      // caller's freak error must not permanently wedge every later flush() behind a
      // forever-rejecting wait.
      return this.inFlight.catch(() => undefined).then(() => this.flush())
    }
    const p = this.doFlush()
    this.inFlight = p
    p.finally(() => { if (this.inFlight === p) this.inFlight = null })
    return p
  }

  // onResolved is caller-supplied and reaches sqlite (QuestionLoop's applyResponse -> setBalances
  // -> state.set is a raw prepare().run()), so it can throw. Unguarded, that throw does different
  // damage per branch: from the success branch it falls into doFlush()'s OUTER catch and is
  // misattributed as a send failure -- a retry logged and scheduled for a row that was already
  // sent and removed -- and from the rejected/abandoned branches it escapes doFlush() entirely,
  // rejecting flush() and surfacing as an HTTP 500 (answer()) or an unhandled rejection (tick()).
  // Neither may happen: the row's fate is already decided and recorded by the time we get here.
  // Logged under its own message, never conflated with a send outcome -- they are different
  // events, and conflating them is precisely what makes the misattribution dangerous.
  private notifyResolved(result: FlushResult): void {
    try {
      this.onResolved(result)
    } catch (err) {
      this.log.error('answer notification failed', { id: result.id, message: (err as Error).message })
    }
  }

  private async doFlush(): Promise<FlushResult[]> {
    const out: FlushResult[] = []
    for (const a of this.state.dueAnswers(this.clock())) {
      try {
        const response = await this.server.answer({ assignment_id: a.assignmentId, option_index: a.optionIndex, latency_ms: a.latencyMs, source: a.source, idempotency_key: a.idempotencyKey })
        this.state.removeAnswer(a.id)
        const result: FlushResult = { id: a.id, ok: true, response }
        out.push(result)
        this.notifyResolved(result)
      } catch (err) {
        const status = err instanceof ServerError ? err.status : null
        if (status !== null && status >= 400 && status < 500 && !RETRYABLE_CLIENT_STATUSES.has(status)) {
          this.log.error('answer rejected', { id: a.id, status, body: (err as ServerError).body })
          this.state.removeAnswer(a.id)
          const result: FlushResult = { id: a.id, ok: false, reason: 'rejected', status }
          out.push(result)
          this.notifyResolved(result)
          continue
        }
        if (a.attempts + 1 >= MAX_ATTEMPTS) {
          this.log.error('answer abandoned', { id: a.id })
          this.state.removeAnswer(a.id)
          const result: FlushResult = { id: a.id, ok: false, reason: 'abandoned' }
          out.push(result)
          this.notifyResolved(result)
          continue
        }
        // A server that told us when to come back knows better than our own schedule, but only in
        // ONE direction: the hint may lengthen the wait, never shorten it below the schedule, and
        // never past this queue's own ceiling. Both bounds protect the same thing -- the wall-clock
        // budget MAX_ATTEMPTS is supposed to buy an already-given answer before it is abandoned.
        //
        // The lower bound is the one that is easy to get wrong. MAX_ATTEMPTS is a COUNT, and the
        // only thing that drives flush() in production is the daemon's 2-second tick, so a hint of
        // `Retry-After: 0` spends all 50 attempts in 100 seconds and abandons real money. Measured,
        // both before and after: 100s with the hint honoured verbatim, 100s again with a 1-second
        // floor (any floor under the 2-second tick is invisible), 11.5 hours once the floor is the
        // schedule itself. Nothing this server emits can trigger it -- @fastify/rate-limit sends
        // whole seconds >= 1 -- but the value comes off the wire, and the cost of being wrong is
        // a developer's answer.
        //
        // Refusing to retry SOONER than our own schedule costs nothing worth having: answer() has
        // already returned `queued` and shown the developer their money, so whether an accepted
        // answer lands in 5 seconds or 60 is invisible to them. The valuable half of the hint --
        // "stop hammering me, come back in five minutes" -- still works, which is the case
        // @fastify/rate-limit actually produces.
        const hinted = err instanceof ServerError ? parseRetryAfterMs(err.retryAfter, this.clock()) : null
        const delayMs = Math.min(Math.max(hinted ?? 0, backoffMs(a.attempts)), MAX_BACKOFF_MS)
        this.state.markAnswerAttempt(a.id, new Date(this.clock().getTime() + delayMs))
        this.log.info('answer retry scheduled', { id: a.id, attempts: a.attempts + 1, status, delayMs })
      }
    }
    return out
  }
}
