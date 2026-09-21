import { describe, it, expect } from 'vitest'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { startFakeServer, servedQuestion } from '../helpers/fake-server.js'
import { ServerClient } from '../../src/server-client.js'
import { AnswerQueue, MAX_ATTEMPTS, MAX_BACKOFF_MS, RETRYABLE_CLIENT_STATUSES, backoffMs, type FlushResult } from '../../src/answer-queue.js'
import { State } from '../../src/state.js'
import { Log } from '../../src/log.js'

// The fake server (per its brief-specified surface) can only ever return 503 or 200 for
// /api/dev/answers, so it cannot exercise a 4xx response or an unbounded run of failures. These
// two tests drive ServerClient directly against a stub fetchFn instead, so the queue's "drop on
// 4xx" and "give up after MAX_ATTEMPTS" branches are actually exercised rather than assumed.
function stubFetch(handler: () => Response): typeof fetch {
  return (async () => handler()) as unknown as typeof fetch
}

describe('AnswerQueue', () => {
  it('pins the backoff schedule and attempt cap to the spec\'s literal values', () => {
    // The give-up test below imports MAX_ATTEMPTS and backoffMs and uses them to pace itself, so
    // it would still pass even if the formula or the cap were mutated -- it can't see its own
    // yardstick change. These assertions pin the literal numbers from the spec directly.
    expect(MAX_ATTEMPTS).toBe(50)
    expect(backoffMs(0)).toBe(60_000) // 60s * 2^0
    expect(backoffMs(1)).toBe(120_000) // 60s * 2^1
    expect(backoffMs(2)).toBe(240_000) // 60s * 2^2
    expect(backoffMs(3)).toBe(480_000) // 60s * 2^3
    expect(backoffMs(4)).toBe(900_000) // 60s * 2^4 = 960_000, capped to 15min
    expect(backoffMs(5)).toBe(900_000) // stays capped, doesn't keep doubling
    expect(backoffMs(49)).toBe(900_000) // stays capped all the way to the last attempt
  })

  it('sends immediately, retries with backoff on 503, and drops on 4xx', async () => {
    const f = await startFakeServer()
    const dir = mkdtempSync(join(tmpdir(), 'mw-'))
    let now = new Date('2026-09-10T10:00:00Z')
    const q = new AnswerQueue(new State(join(dir, 's.sqlite')), new ServerClient(f.url, () => 'api-token-1'), () => now, new Log(join(dir, 'log')))

    const id1 = q.enqueue({ assignmentId: servedQuestion().assignment_id, optionIndex: 1, latencyMs: 1500, source: 'pane' })
    const sent = await q.flush()
    expect(sent).toHaveLength(1)
    expect(sent[0]).toMatchObject({ id: id1, response: { reason: 'ok' } })
    // Field-by-field, not just idempotency_key -- a transposed option_index/latency_ms would
    // silently corrupt the money path while still passing a narrower check.
    expect(f.answers[0]!.body).toEqual({
      assignment_id: servedQuestion().assignment_id,
      option_index: 1,
      latency_ms: 1500,
      source: 'pane',
      idempotency_key: servedQuestion().assignment_id,
    })
    expect(q.pending()).toBe(0)

    f.failAnswersTimes = 2
    const id2 = q.enqueue({ assignmentId: '11111111-1111-4111-8111-111111111111', optionIndex: 0, latencyMs: 2000, source: 'page' })
    expect(await q.flush()).toHaveLength(0)
    expect(q.pending()).toBe(1)
    expect(await q.flush()).toHaveLength(0)
    now = new Date(now.getTime() + 61_000)
    expect(await q.flush()).toHaveLength(0)
    now = new Date(now.getTime() + 121_000)
    const later = await q.flush()
    expect(later.map((s) => s.id)).toEqual([id2])
    expect(q.pending()).toBe(0)

    f.answerResponder = () => { throw new Error('unused') }
    await f.close()
  })

  it('drops the answer on a 4xx response, logs it, and does not retry', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'mw-'))
    const now = new Date('2026-09-10T10:00:00Z')
    let calls = 0
    const fetchFn = stubFetch(() => { calls += 1; return new Response(JSON.stringify({ error: 'invalid_option' }), { status: 422 }) })
    const logPath = join(dir, 'log')
    const q = new AnswerQueue(new State(join(dir, 's.sqlite')), new ServerClient('http://example.invalid', () => 'api-token-1', fetchFn), () => now, new Log(logPath))

    const id = q.enqueue({ assignmentId: '22222222-2222-4222-8222-222222222222', optionIndex: 0, latencyMs: 500, source: 'pane' })
    const sent = await q.flush()
    // A dropped row must still be reported, not silently omitted -- an omission is
    // indistinguishable from "still queued" to a caller, which is exactly the C1 bug.
    expect(sent).toHaveLength(1)
    expect(sent[0]).toMatchObject({ id, ok: false, reason: 'rejected', status: 422 })
    expect(calls).toBe(1)
    expect(q.pending()).toBe(0)
    expect(readFileSync(logPath, 'utf8')).toContain('answer rejected')
  })

  // Whole-branch review I1: every 4xx used to be permanent, so a 429 -- which the real server
  // emits from @fastify/rate-limit at 120/min, keyed on the bare source ip whenever the bearer
  // token does not resolve to a developer, and therefore shared behind one NAT -- destroyed a
  // developer's already-given answer for money a single retry would have collected.
  it('pins exactly which 4xx statuses survive a retry', () => {
    expect([...RETRYABLE_CLIENT_STATUSES].sort((a, b) => a - b)).toEqual([401, 408, 425, 429])
  })

  it('retries a 429 on the backoff schedule and eventually delivers it', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'mw-'))
    let now = new Date('2026-09-10T10:00:00Z')
    let calls = 0
    const fetchFn = stubFetch(() => {
      calls += 1
      return calls === 1
        ? new Response(JSON.stringify({ error: 'rate_limited' }), { status: 429 })
        : new Response(JSON.stringify({ accepted: true, reason: 'ok', earned_cents: 50, balance_pending_cents: 50, balance_available_cents: 0, today_paid_answers: 1 }), { status: 200 })
    })
    const q = new AnswerQueue(new State(join(dir, 's.sqlite')), new ServerClient('http://example.invalid', () => 'api-token-1', fetchFn), () => now, new Log(join(dir, 'log')))

    const id = q.enqueue({ assignmentId: '99999999-9999-4999-8999-999999999901', optionIndex: 0, latencyMs: 500, source: 'pane' })
    expect(await q.flush()).toHaveLength(0) // rate limited -- still queued, not resolved
    expect(q.pending()).toBe(1)
    now = new Date(now.getTime() + backoffMs(0) + 1)
    expect(await q.flush()).toEqual([{ id, ok: true, response: expect.objectContaining({ reason: 'ok' }) }])
    expect(q.pending()).toBe(0)
  })

  it('retries a 401 so a revoked token costs a re-login, not the answer', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'mw-'))
    let now = new Date('2026-09-10T10:00:00Z')
    let token: string | null = 'revoked'
    const fetchFn = stubFetch(() => token === 'revoked'
      ? new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401 })
      : new Response(JSON.stringify({ accepted: true, reason: 'ok', earned_cents: 50, balance_pending_cents: 50, balance_available_cents: 0, today_paid_answers: 1 }), { status: 200 }))
    const q = new AnswerQueue(new State(join(dir, 's.sqlite')), new ServerClient('http://example.invalid', () => token, fetchFn), () => now, new Log(join(dir, 'log')))

    const id = q.enqueue({ assignmentId: '99999999-9999-4999-8999-999999999902', optionIndex: 0, latencyMs: 500, source: 'pane' })
    expect(await q.flush()).toHaveLength(0)
    expect(q.pending()).toBe(1)
    token = 'fresh-after-login'
    now = new Date(now.getTime() + backoffMs(0) + 1)
    expect(await q.flush()).toEqual([{ id, ok: true, response: expect.objectContaining({ reason: 'ok' }) }])
  })

  it('still drops a genuinely permanent 4xx without retrying it', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'mw-'))
    let now = new Date('2026-09-10T10:00:00Z')
    let calls = 0
    const fetchFn = stubFetch(() => { calls += 1; return new Response(JSON.stringify({ error: 'validation' }), { status: 400 }) })
    const q = new AnswerQueue(new State(join(dir, 's.sqlite')), new ServerClient('http://example.invalid', () => 'api-token-1', fetchFn), () => now, new Log(join(dir, 'log')))

    const id = q.enqueue({ assignmentId: '99999999-9999-4999-8999-999999999903', optionIndex: 0, latencyMs: 500, source: 'pane' })
    expect(await q.flush()).toEqual([{ id, ok: false, reason: 'rejected', status: 400 }])
    expect(q.pending()).toBe(0)
    // No later flush can resurrect it, and no second request is ever made.
    now = new Date(now.getTime() + MAX_BACKOFF_MS * 2)
    expect(await q.flush()).toHaveLength(0)
    expect(calls).toBe(1)
  })

  it('lets a Retry-After header lengthen the wait, but never shorten it below the schedule', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'mw-'))
    let now = new Date('2026-09-10T10:00:00Z')
    let retryAfter = '300' // five minutes, well past the 60-second first backoff
    let calls = 0
    const fetchFn = stubFetch(() => {
      calls += 1
      return new Response(JSON.stringify({ error: 'rate_limited' }), { status: 429, headers: { 'retry-after': retryAfter } })
    })
    const q = new AnswerQueue(new State(join(dir, 's.sqlite')), new ServerClient('http://example.invalid', () => 'api-token-1', fetchFn), () => now, new Log(join(dir, 'log')))

    q.enqueue({ assignmentId: '99999999-9999-4999-8999-999999999904', optionIndex: 0, latencyMs: 500, source: 'pane' })
    await q.flush()
    expect(calls).toBe(1)
    // The hint wins over the 60-second default: a flush well past that backoff still must not go.
    now = new Date(now.getTime() + 120_000)
    await q.flush()
    expect(calls).toBe(1)
    now = new Date(now.getTime() + 190_000) // now past the hinted 300s
    await q.flush()
    expect(calls).toBe(2)

    // A hint SHORTER than our own schedule is floored at the schedule. Retrying sooner buys the
    // developer nothing (answer() already reported `queued`) and spends the attempt budget that
    // is the only thing standing between a bad hint and an abandoned answer.
    retryAfter = '0'
    now = new Date(now.getTime() + 30 * 60_000)
    await q.flush()
    expect(calls).toBe(3)
    now = new Date(now.getTime() + 2_000) // one daemon tick later: nowhere near due
    await q.flush()
    expect(calls).toBe(3)

    // And an absurd hint can't park the money past the queue's own ceiling either.
    retryAfter = String(60 * 60 * 24 * 30)
    now = new Date(now.getTime() + MAX_BACKOFF_MS)
    await q.flush()
    expect(calls).toBe(4)
    now = new Date(now.getTime() + MAX_BACKOFF_MS + 1)
    await q.flush()
    expect(calls).toBe(5)
  })

  // Re-review finding 1. MAX_ATTEMPTS is a COUNT, and the only thing driving flush() in production
  // is the daemon's 2-second tick, so a `Retry-After` the queue honours verbatim decides how long
  // that count actually lasts. Measured before the fix: `Retry-After: 0` spent all 50 attempts in
  // 100 seconds and abandoned a real answer. This asserts the invariant that matters -- no value a
  // server can put in that header shortens the budget to anything a transient outage could outlast
  // -- rather than asserting one particular floor, which is what let a 1-second floor look like a
  // fix while changing the burn rate by exactly nothing.
  it('cannot have its abandonment budget collapsed by a Retry-After of zero', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'mw-'))
    const start = new Date('2026-09-10T10:00:00Z')
    let now = new Date(start)
    let resolved: FlushResult | null = null
    const fetchFn = stubFetch(() => new Response(JSON.stringify({ error: 'rate_limited' }), { status: 429, headers: { 'retry-after': '0' } }))
    const q = new AnswerQueue(
      new State(join(dir, 's.sqlite')),
      new ServerClient('http://example.invalid', () => 'api-token-1', fetchFn),
      () => now,
      new Log(join(dir, 'log')),
      (r) => { resolved ??= r },
    )
    q.enqueue({ assignmentId: '99999999-9999-4999-8999-999999999905', optionIndex: 0, latencyMs: 500, source: 'pane' })

    // DAEMON_TICK_MS: daemon.ts's `tickIntervalMs` default. Stepping the clock by anything larger
    // would hide the defect, since the row's due time is what the flush cadence races against.
    const DAEMON_TICK_MS = 2_000
    const budgetTicks = (12 * 3600 * 1000) / DAEMON_TICK_MS
    let ticks = 0
    while (!resolved && ticks < budgetTicks) {
      await q.flush()
      ticks += 1
      now = new Date(now.getTime() + DAEMON_TICK_MS)
    }

    expect(resolved).toMatchObject({ ok: false, reason: 'abandoned' })
    const elapsedHours = (now.getTime() - start.getTime()) / 3_600_000
    expect(elapsedHours).toBeGreaterThan(10)
  }, 60_000)

  it('backs off min(60s x 2^attempts, 15min) on repeated failure and reports abandonment after 50 attempts', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'mw-'))
    let now = new Date('2026-09-10T10:00:00Z')
    let calls = 0
    const fetchFn = stubFetch(() => { calls += 1; return new Response(JSON.stringify({ error: 'unavailable' }), { status: 503 }) })
    const logPath = join(dir, 'log')
    const q = new AnswerQueue(new State(join(dir, 's.sqlite')), new ServerClient('http://example.invalid', () => 'api-token-1', fetchFn), () => now, new Log(logPath))

    const id = q.enqueue({ assignmentId: '33333333-3333-4333-8333-333333333333', optionIndex: 0, latencyMs: 500, source: 'pane' })
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      const result = await q.flush()
      if (attempt < MAX_ATTEMPTS - 1) {
        // Not yet given up: still queued, and not due again until the schedule's backoff elapses.
        expect(result).toHaveLength(0)
        expect(q.pending()).toBe(1)
        expect(await q.flush()).toHaveLength(0)
        expect(calls).toBe(attempt + 1) // clock hasn't moved past nextAt, so no extra call was made
        now = new Date(now.getTime() + backoffMs(attempt) + 1)
      } else {
        // The 50th attempt exhausts MAX_ATTEMPTS. This must still come back in the result --
        // silently vanishing here is indistinguishable from "still queued" to a caller (the same
        // shape of bug as C1's 4xx case), and it's the one remaining exit where a developer's
        // already-given answer can be lost with literally no signal anywhere but a log line.
        expect(result).toHaveLength(1)
        expect(result[0]).toMatchObject({ id, ok: false, reason: 'abandoned' })
      }
    }
    expect(calls).toBe(MAX_ATTEMPTS)
    expect(q.pending()).toBe(0)
    expect(readFileSync(logPath, 'utf8')).toContain('answer abandoned')
  })

  // Round 3: sharing one in-flight promise between overlapping callers (round 2's fix) turned
  // out to reintroduce a worse bug -- two callers holding the SAME `sent` array could each
  // independently decide to notify about a row in it, double-firing. flush() now instead CHAINS:
  // an overlapping call awaits whatever pass is already running and then runs its OWN pass over
  // whatever is still due. A real (if short) delay on the stub fetch makes the overlap genuine:
  // the first flush()'s pass suspends on the delayed network call for id1, and enqueuing id2 and
  // calling flush() again *while that's still outstanding* proves id2 was not present when the
  // first pass took its dueAnswers() snapshot -- it can only be resolved by a second, later pass.
  it('chains overlapping flush() calls so each gets a real pass over what is still due (M1, round3 finding3)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'mw-'))
    const now = new Date('2026-09-10T10:00:00Z')
    let calls = 0
    const fetchFn: typeof fetch = (async () => {
      calls += 1
      await new Promise((r) => setTimeout(r, 20))
      return new Response(JSON.stringify({ accepted: true, reason: 'ok', earned_cents: 50, balance_pending_cents: 50, balance_available_cents: 0, today_paid_answers: 1 }), { status: 200 })
    }) as unknown as typeof fetch
    const q = new AnswerQueue(new State(join(dir, 's.sqlite')), new ServerClient('http://example.invalid', () => 'api-token-1', fetchFn), () => now, new Log(join(dir, 'log')))

    const id1 = q.enqueue({ assignmentId: '44444444-4444-4444-8444-444444444444', optionIndex: 0, latencyMs: 500, source: 'pane' })
    const first = q.flush() // starts a pass over [id1], suspends on the delayed fetch
    const id2 = q.enqueue({ assignmentId: '55555555-5555-4555-8555-555555555555', optionIndex: 1, latencyMs: 600, source: 'page' }) // not yet due when `first`'s pass snapshotted
    const second = q.flush() // must chain after `first`, then run its OWN pass -- over id2
    const [sentFirst, sentSecond] = await Promise.all([first, second])
    expect(calls).toBe(2) // one send per row -- id1 is never sent twice, id2 is genuinely attempted
    expect(sentFirst).toEqual([{ id: id1, ok: true, response: expect.objectContaining({ reason: 'ok' }) }])
    expect(sentSecond).toEqual([{ id: id2, ok: true, response: expect.objectContaining({ reason: 'ok' }) }])
  })

  // A concurrent caller must not double-fire a notification for a row it merely happens to
  // observe in a shared or overlapping result. Since chaining (above) means every pass's result
  // is genuinely its own -- never shared with another caller -- onResolved's callback contract
  // (invoked exactly once, from inside the pass that actually resolves a row) holds regardless of
  // how many callers overlap. This drives the exact round-3 scenario the re-reviewer reproduced:
  // a slow-to-resolve row rejected by the fake, discovered while a second, unrelated row is also
  // in flight, and checks the callback fires exactly once.
  it('invokes onResolved exactly once per row even under a genuine flush() overlap (round3 finding1/2 regression)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'mw-'))
    const now = new Date('2026-09-10T10:00:00Z')
    let calls = 0
    const fetchFn: typeof fetch = (async () => {
      calls += 1
      await new Promise((r) => setTimeout(r, 20))
      return new Response(JSON.stringify({ error: 'invalid_option' }), { status: 422 })
    }) as unknown as typeof fetch
    const resolved: unknown[] = []
    const q = new AnswerQueue(
      new State(join(dir, 's.sqlite')),
      new ServerClient('http://example.invalid', () => 'api-token-1', fetchFn),
      () => now,
      new Log(join(dir, 'log')),
      (result) => resolved.push(result),
    )

    const id1 = q.enqueue({ assignmentId: '66666666-6666-4666-8666-666666666666', optionIndex: 0, latencyMs: 500, source: 'pane' })
    const first = q.flush()
    const id2 = q.enqueue({ assignmentId: '77777777-7777-4777-8777-777777777777', optionIndex: 0, latencyMs: 500, source: 'pane' })
    const second = q.flush()
    await Promise.all([first, second])

    expect(calls).toBe(2)
    expect(resolved).toHaveLength(2) // exactly one callback firing per row, never two for either
    expect(resolved).toContainEqual({ id: id1, ok: false, reason: 'rejected', status: 422 })
    expect(resolved).toContainEqual({ id: id2, ok: false, reason: 'rejected', status: 422 })
  })

  // Round 4: onResolved is caller-supplied and reaches sqlite (QuestionLoop's applyResponse ->
  // setBalances -> state.set is a raw prepare().run()), so it can throw. Unguarded, that throw did
  // different damage in each of the three resolution branches, and all three are driven here
  // against a callback that always throws:
  //   success   -- swallowed by doFlush()'s OUTER catch and misattributed as a send failure: a
  //                retry logged and scheduled for a row that had already been sent and removed.
  //   rejected  -- escaped doFlush() entirely, rejecting flush(): an HTTP 500 out of answer().
  //   abandoned -- same escape, from tick()'s bare await: an unhandled rejection.
  it('does not let a throwing onResolved corrupt the send outcome or escape the flush (round4)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'mw-'))
    const now = new Date('2026-09-10T10:00:00Z')
    const logPath = join(dir, 'log')
    const state = new State(join(dir, 's.sqlite'))
    let status = 200
    const fetchFn = stubFetch(() => status === 200
      ? new Response(JSON.stringify({ accepted: true, reason: 'ok', earned_cents: 50, balance_pending_cents: 50, balance_available_cents: 0, today_paid_answers: 1 }), { status: 200 })
      : new Response(JSON.stringify({ error: 'unavailable' }), { status }))
    const q = new AnswerQueue(
      state,
      new ServerClient('http://example.invalid', () => 'api-token-1', fetchFn),
      () => now,
      new Log(logPath),
      () => { throw new Error('callback boom') },
    )

    // Success. The returned array can't discriminate here -- out.push() happens before the
    // callback fires, so it looks right either way -- but the LOG can: unguarded, this row was
    // logged as a scheduled retry despite having already been sent and deleted.
    const id1 = q.enqueue({ assignmentId: '88888888-8888-4888-8888-888888888881', optionIndex: 0, latencyMs: 500, source: 'pane' })
    await expect(q.flush()).resolves.toEqual([{ id: id1, ok: true, response: expect.objectContaining({ reason: 'ok' }) }])
    expect(q.pending()).toBe(0)
    expect(readFileSync(logPath, 'utf8')).not.toContain('answer retry scheduled')

    // Rejected: flush() must still RESOLVE with the real outcome, not reject. 403 rather than 401
    // -- a 401 is retried now (whole-branch review I1), so it no longer reaches this branch.
    status = 403
    const id2 = q.enqueue({ assignmentId: '88888888-8888-4888-8888-888888888882', optionIndex: 0, latencyMs: 500, source: 'pane' })
    await expect(q.flush()).resolves.toEqual([{ id: id2, ok: false, reason: 'rejected', status: 403 }])
    expect(q.pending()).toBe(0)

    // Abandoned. Seeded straight into State at its final attempt rather than driving 50 real
    // flushes -- the branch under test is the callback guard, not the attempt counting, which the
    // MAX_ATTEMPTS test above already pins.
    status = 503
    state.enqueueAnswer({ id: 'seeded', assignmentId: '88888888-8888-4888-8888-888888888883', optionIndex: 0, latencyMs: 500, source: 'pane', idempotencyKey: '88888888-8888-4888-8888-888888888883', attempts: MAX_ATTEMPTS - 1, nextAt: now.toISOString() })
    await expect(q.flush()).resolves.toEqual([{ id: 'seeded', ok: false, reason: 'abandoned' }])
    expect(q.pending()).toBe(0)

    const log = readFileSync(logPath, 'utf8')
    // One per branch, logged as its own event...
    expect(log.match(/answer notification failed/g)).toHaveLength(3)
    // ...and never conflated with a send outcome: nothing here was ever eligible for a retry.
    expect(log).not.toContain('answer retry scheduled')
  })
})
