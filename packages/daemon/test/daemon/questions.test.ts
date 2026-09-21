import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { answerNotice } from '@tickover/contract'
import { startTestDaemon, FakeClock, type TestDaemon } from '../helpers/daemon.js'
import { servedQuestion, startFakeServer } from '../helpers/fake-server.js'
import { startDaemon } from '../../src/daemon.js'
import { ensureHome } from '../../src/paths.js'
import { readConfig, writeConfig } from '../../src/config.js'
import { backoffMs } from '../../src/answer-queue.js'

async function hook(t: TestDaemon, event: string, session_id: string) {
  await fetch(`${t.base}/v1/hook`, { method: 'POST', headers: t.headers, body: JSON.stringify({ event, session_id, tool: 'claude-code', cwd: 'C:/proj' }) })
}
async function startTurn(t: TestDaemon, session = 's1') {
  await hook(t, 'SessionStart', session)
  t.clock.advanceMinutes(3)
  await hook(t, 'UserPromptSubmit', session)
  t.clock.advanceMs(9_000)
}
const q = (t: TestDaemon) => fetch(`${t.base}/v1/question`, { headers: t.headers }).then((r) => r.json())
// cols=120 mirrors what the real status line script now sends (COLUMNS, measured 2026-09-06).
// Without it the daemon falls back to the 80-column guess minus its safety margin, and these
// assertions would pin a budget-squeezed line rather than the composed format they exist to pin.
const status = (t: TestDaemon, s = 's1', cols = 120) => fetch(`${t.base}/v1/status?session_id=${s}&cols=${cols}`, { headers: t.headers }).then((r) => r.json()).then((j) => j.line as string)
const answerReq = (t: TestDaemon, body: unknown) => fetch(`${t.base}/v1/answer`, { method: 'POST', headers: t.headers, body: JSON.stringify(body) })

// Reads exactly `count` SSE frames off an already-open /v1/events response, parsing each
// "event: X\ndata: Y\n\n" block. Used to pin broadcast payloads, not just that a broadcast fired.
async function readSseEvents(res: Response, count: number): Promise<Array<{ event: string; data: unknown }>> {
  const reader = res.body!.getReader()
  const decoder = new TextDecoder()
  let buf = ''
  const events: Array<{ event: string; data: unknown }> = []
  while (events.length < count) {
    const { value, done } = await reader.read()
    if (done) break
    buf += decoder.decode(value, { stream: true })
    let idx: number
    while ((idx = buf.indexOf('\n\n')) !== -1) {
      const frame = buf.slice(0, idx)
      buf = buf.slice(idx + 2)
      const eventMatch = /^event: (.+)$/m.exec(frame)
      const dataMatch = /^data: (.+)$/m.exec(frame)
      if (eventMatch && dataMatch) events.push({ event: eventMatch[1]!, data: JSON.parse(dataMatch[1]!) })
    }
  }
  return events
}

describe('question loop over the local api', () => {
  let t: TestDaemon
  beforeEach(async () => { t = await startTestDaemon() })
  afterEach(async () => { await t.stop() })

  it('asks the server only during an eligible turn, shows the question, and answers it', async () => {
    t.fake.nextQueue.push({ question: servedQuestion({ expires_at: new Date(t.clock.now.getTime() + 13 * 60_000).toISOString() }) })
    await t.daemon.loop.tick()
    expect(t.fake.nextCalls).toHaveLength(0)
    await startTurn(t)
    await t.daemon.loop.tick()
    expect(t.fake.nextCalls).toHaveLength(1)
    expect(t.fake.nextCalls[0]!.session_id).toBe('s1')
    const served = await q(t)
    expect(served.question.text).toBe('Which tagline?')
    // M5: shown_at must be the moment the loop actually served it (the fake clock at that tick),
    // not left unasserted -- a QuestionView with a missing or wrong shown_at would pass every
    // other assertion in this file.
    expect(served.shown_at).toBe(t.clock.now.toISOString())
    // 76 display columns (verified with string-width) — inside the budget a 120-column terminal
    // yields, so this pins the actual composed format rather than a budget-squeezed line (R22).
    expect(await status(t)).toBe('tickover · Acme DB · $0.50 · Which tagline? 1 Postgres, faster  2 Cached DB')

    t.clock.advanceMs(2_500)
    const res = await answerReq(t, { assignment_id: servedQuestion().assignment_id, option_index: 1, source: 'pane' })
    expect(await res.json()).toMatchObject({ accepted: true, reason: 'ok', earned_cents: 50 })
    expect(t.fake.answers[0]!.body).toMatchObject({ option_index: 1, latency_ms: 2500, source: 'pane', idempotency_key: servedQuestion().assignment_id })
    expect(await status(t)).toBe('tickover · ✓ +$0.50 · today 1/10 · balance $0.50')
    expect((await q(t)).question).toBeNull()

    t.clock.advanceMs(11_000)
    await t.daemon.loop.tick()
    expect(await status(t)).toBe('tickover · today 1/10 · balance $0.50')
  })

  it('respects the gap, skips, expires locally, and rejects late answers', async () => {
    await startTurn(t)
    t.fake.nextQueue.push({ question: servedQuestion({ assignment_id: '11111111-1111-4111-8111-111111111111', expires_at: new Date(t.clock.now.getTime() + 10 * 60_000).toISOString() }) })
    await t.daemon.loop.tick()
    expect((await q(t)).question).not.toBeNull()
    const skip = await fetch(`${t.base}/v1/skip`, { method: 'POST', headers: t.headers, body: JSON.stringify({ assignment_id: '11111111-1111-4111-8111-111111111111' }) })
    expect(skip.status).toBe(204)
    expect(t.fake.skips).toEqual(['11111111-1111-4111-8111-111111111111'])
    expect((await q(t)).question).toBeNull()

    t.fake.nextQueue.push({ question: servedQuestion({ assignment_id: '22222222-2222-4222-8222-222222222222', expires_at: new Date(t.clock.now.getTime() + 6 * 60_000).toISOString() }) })
    await t.daemon.loop.tick()
    expect(t.fake.nextCalls).toHaveLength(1)
    t.clock.advanceMinutes(6)
    await t.daemon.loop.tick()
    expect(t.fake.nextCalls).toHaveLength(2)
    expect((await q(t)).question.assignment_id).toBe('22222222-2222-4222-8222-222222222222')

    t.clock.advanceMinutes(16)
    await t.daemon.loop.tick()
    expect((await q(t)).question).toBeNull()
    const late = await answerReq(t, { assignment_id: '22222222-2222-4222-8222-222222222222', option_index: 0, source: 'page' })
    expect(await late.json()).toMatchObject({ accepted: false, reason: 'not_current' })
  })

  it('shows one question across sessions and clears it everywhere after one answer', async () => {
    await startTurn(t, 'a')
    await hook(t, 'SessionStart', 'b')
    t.fake.nextQueue.push({ question: servedQuestion({ expires_at: new Date(t.clock.now.getTime() + 10 * 60_000).toISOString() }) })
    await t.daemon.loop.tick()
    expect(await status(t, 'a')).toContain('Which tagline?')
    expect(await status(t, 'b')).toContain('Which tagline?')
    await answerReq(t, { assignment_id: servedQuestion().assignment_id, option_index: 0, source: 'vscode' })
    expect(await status(t, 'a')).toContain('✓')
    expect(await status(t, 'b')).toContain('✓')

    // I6: the money-critical half of "clears it everywhere" -- a second answer for the same,
    // now-cleared assignment must be rejected, not paid twice. Without this, both status
    // assertions above could pass purely because status() ignores session_id (a global read),
    // which would be true whether or not the clear-everywhere behavior was ever implemented.
    const second = await answerReq(t, { assignment_id: servedQuestion().assignment_id, option_index: 1, source: 'pane' })
    expect(await second.json()).toMatchObject({ accepted: false, reason: 'not_current' })
    expect(t.fake.answers).toHaveLength(1)
  })

  it('reports queued when the server is unreachable and delivers later', async () => {
    await startTurn(t)
    t.fake.nextQueue.push({ question: servedQuestion({ expires_at: new Date(t.clock.now.getTime() + 10 * 60_000).toISOString() }) })
    await t.daemon.loop.tick()
    t.fake.failAnswersTimes = 1
    const res = await answerReq(t, { assignment_id: servedQuestion().assignment_id, option_index: 0, source: 'pane' })
    expect(await res.json()).toMatchObject({ accepted: true, reason: 'queued', earned_cents: 50 })

    // Round 4 coverage gap: requirement 4's success-path broadcast was only ever asserted over SSE
    // for answer()'s OWN row. Subscribing here pins the other caller of the same code path -- a
    // background flush discovering the balance correction long after answer() already returned
    // "queued" -- which is the only way an SSE-only surface ever learns the answer landed.
    const sseRes = await fetch(`${t.base}/v1/events`, { headers: t.headers })
    const eventsPromise = readSseEvents(sseRes, 3)

    t.clock.advanceMinutes(2)
    await t.daemon.loop.tick()
    expect(t.fake.answers).toHaveLength(1)
    // M5: the balance must actually update once the delayed send finally lands, not just log the
    // send -- tick()'s own flush() applies the AnswerResponse the same way answer()'s does.
    const delivered = await q(t)
    expect(delivered.balance_pending_cents).toBe(50)
    expect(delivered.today_paid_answers).toBe(1)

    // [0] the subscribe-time status write, then the flush's own two: the corrected balances, then
    // the outcome. A fourth `question` follows when the same tick clears the ✓ past
    // ANSWERED_TTL_MS -- sliced off, since readSseEvents drains every complete frame already in
    // the buffer and so can return more than it was asked for. Drop the success-path broadcast
    // and the first three read ['status', 'answered', 'question'] instead.
    const events = await eventsPromise
    expect(events.slice(0, 3).map((e) => e.event)).toEqual(['status', 'question', 'answered'])
    expect(events[1]!.data).toMatchObject({ question: null, balance_pending_cents: 50, today_paid_answers: 1 })
    expect(events[2]!.data).toEqual({ accepted: true, reason: 'ok', earned_cents: 50 })
  })

  // C1: a permanently rejected send (a 4xx the server will never accept -- here a 422) must never
  // be reported as paid. Before this fix, AnswerQueue.flush() dropped the row without reporting
  // it, which answer() could not tell apart from "still queued" -- so it reported accepted:true
  // and showed a checkmark for money that had already been discarded and would never be retried.
  // (A 401 used to stand in for this and no longer can: whole-branch review I1 made it retryable.)
  it('reports a permanently rejected answer as failed, not paid (C1)', async () => {
    await startTurn(t)
    t.fake.nextQueue.push({ question: servedQuestion({ expires_at: new Date(t.clock.now.getTime() + 10 * 60_000).toISOString() }) })
    await t.daemon.loop.tick()
    t.fake.failAnswersTimes = 1
    t.fake.answerFailStatus = 422
    const res = await answerReq(t, { assignment_id: servedQuestion().assignment_id, option_index: 0, source: 'pane' })
    expect(await res.json()).toMatchObject({ accepted: false, reason: 'failed', earned_cents: 0 })
    expect(await status(t)).not.toContain('✓')
    // The fake never actually recorded it -- the 422 was the response, not a queued success.
    expect(t.fake.answers).toHaveLength(0)
  })

  // Whole-branch review I1. The server rate-limits at 120/minute and its key generator falls back
  // to the bare source ip whenever the bearer token does not resolve to a developer -- so a 429 is
  // reachable through no fault of this developer's (a revoked token, or a colleague behind the
  // same NAT). Treating it as permanent destroyed an answer the developer had already given.
  it('retries a rate-limited answer instead of destroying it, and delivers it on a later tick', async () => {
    await startTurn(t)
    t.fake.nextQueue.push({ question: servedQuestion({ expires_at: new Date(t.clock.now.getTime() + 10 * 60_000).toISOString() }) })
    await t.daemon.loop.tick()
    t.fake.failAnswersTimes = 1
    t.fake.answerFailStatus = 429
    const res = await answerReq(t, { assignment_id: servedQuestion().assignment_id, option_index: 0, source: 'pane' })
    // Queued, not failed: the developer is told the answer is still on its way, because it is.
    expect(await res.json()).toMatchObject({ accepted: true, reason: 'queued', earned_cents: 50 })
    expect(t.fake.answers).toHaveLength(0)

    t.clock.advanceMinutes(2) // past the 60-second first backoff
    await t.daemon.loop.tick()
    expect(t.fake.answers).toHaveLength(1)
    const delivered = await q(t)
    expect(delivered.balance_pending_cents).toBe(50)
    expect(delivered.today_paid_answers).toBe(1)
  })

  // Round 4: round 3 moved answer()'s unconditional broadcast into handleFlushResult, but only its
  // success branch broadcast -- so a permanently rejected answer cleared `current` and emitted no
  // `question` event at all. The C1 test above cannot see this: status() and GET /v1/question both
  // read current state directly and are correct either way. Only a subscriber is affected -- the
  // VS Code extension and the localhost page would keep showing a question the developer had
  // already answered until something unrelated happened to broadcast -- so only SSE can catch it.
  it('broadcasts the cleared question over sse when an answer is permanently rejected (round4)', async () => {
    await startTurn(t)
    t.fake.nextQueue.push({ question: servedQuestion({ expires_at: new Date(t.clock.now.getTime() + 30 * 60_000).toISOString() }) })
    await t.daemon.loop.tick()

    const sseRes = await fetch(`${t.base}/v1/events`, { headers: t.headers })
    const eventsPromise = readSseEvents(sseRes, 3)

    t.fake.failAnswersTimes = 1
    t.fake.answerFailStatus = 422 // a 4xx the server will never accept -- dropped, never retried
    const res = await answerReq(t, { assignment_id: servedQuestion().assignment_id, option_index: 0, source: 'pane' })
    expect(await res.json()).toMatchObject({ accepted: false, reason: 'failed', earned_cents: 0 })

    // Serving a second question afterwards guarantees a third frame exists whether or not the fix
    // is in place, so the unfixed behaviour fails on the ordering assertion below rather than
    // hanging readSseEvents until the suite times out.
    t.clock.advanceMinutes(6)
    t.fake.nextQueue.push({ question: servedQuestion({ assignment_id: '99999999-9999-4999-8999-999999999999', expires_at: new Date(t.clock.now.getTime() + 30 * 60_000).toISOString() }) })
    await t.daemon.loop.tick()

    // Unfixed this reads ['status', 'answered', 'question'] -- the loss is announced, but the state
    // change that cleared the question never is, and the only later `question` frame is the next
    // serve. The 'answered' reason stays specific ('rejected') even though answer()'s HTTP reply
    // collapsed it to 'failed'; that divergence is deliberate.
    const events = await eventsPromise
    expect(events.slice(0, 3).map((e) => e.event)).toEqual(['status', 'question', 'answered'])
    expect(events[1]!.data).toMatchObject({ question: null })
    expect(events[2]!.data).toEqual({ accepted: false, reason: 'rejected', earned_cents: 0 })
  })

  // Whole-branch review, Minor: the uninstall skill deletes ~/.tickover, and state.sqlite there
  // holds the ONLY copy of answers the server has not accepted yet. Nothing surfaced how many
  // there were, so the skill could not tell a developer what deleting would actually cost them --
  // and it claimed, falsely, that pending earnings were safe on the server.
  it('reports how many already-given answers are still waiting to reach the server', async () => {
    const health = () => fetch(`${t.base}/v1/health`, { headers: t.headers }).then((r) => r.json())
    expect((await health()).queuedAnswers).toBe(0)

    await startTurn(t)
    t.fake.nextQueue.push({ question: servedQuestion({ expires_at: new Date(t.clock.now.getTime() + 10 * 60_000).toISOString() }) })
    await t.daemon.loop.tick()
    t.fake.failAnswersTimes = 1
    await answerReq(t, { assignment_id: servedQuestion().assignment_id, option_index: 0, source: 'pane' })
    expect((await health()).queuedAnswers).toBe(1)

    t.clock.advanceMinutes(2)
    await t.daemon.loop.tick()
    expect(t.fake.answers).toHaveLength(1)
    expect((await health()).queuedAnswers).toBe(0)
  })

  it('clamps latency_ms to zero when the wall clock moves backwards between serve and answer (I1)', async () => {
    await startTurn(t)
    t.fake.nextQueue.push({ question: servedQuestion({ expires_at: new Date(t.clock.now.getTime() + 10 * 60_000).toISOString() }) })
    await t.daemon.loop.tick()
    t.clock.advanceMs(-5_000) // a backwards wall-clock adjustment between serve and answer
    const res = await answerReq(t, { assignment_id: servedQuestion().assignment_id, option_index: 0, source: 'pane' })
    expect(await res.json()).toMatchObject({ accepted: true, reason: 'ok' })
    expect(t.fake.answers[0]!.body.latency_ms).toBe(0)
  })

  it('honours retry_after_ms from an empty next() response instead of asking again immediately (I2)', async () => {
    await startTurn(t)
    // t.fake.nextQueue is empty, so the fake's default response is
    // { question: null, reason: 'none_available', retry_after_ms: 3000 }.
    await t.daemon.loop.tick()
    expect(t.fake.nextCalls).toHaveLength(1)
    await t.daemon.loop.tick() // same instant -- nothing served, so no gap/history would block this
    expect(t.fake.nextCalls).toHaveLength(1) // still honouring the 3s hint
    t.clock.advanceMs(3_000)
    await t.daemon.loop.tick()
    expect(t.fake.nextCalls).toHaveLength(2)
  })

  it('backs off after a failing next() call instead of hammering every tick (I2)', async () => {
    await startTurn(t)
    t.fake.nextFailTimes = 1
    await t.daemon.loop.tick()
    expect(t.fake.nextCalls).toHaveLength(1) // attempted, and failed
    await t.daemon.loop.tick()
    expect(t.fake.nextCalls).toHaveLength(1) // backing off -- not retried yet
    t.clock.advanceMs(60_000) // BASE_BACKOFF_MS for the first failed attempt
    t.fake.nextQueue.push({ question: servedQuestion() })
    await t.daemon.loop.tick()
    expect(t.fake.nextCalls).toHaveLength(2) // backoff elapsed, retried, and this time succeeded
    expect((await q(t)).question).not.toBeNull()
  })

  // Round 2 finding 5: reusing AnswerQueue's own backoff schedule for next() reused its 15-minute
  // ceiling too, which is fine for a money-carrying answer retry but far too long for a poll -- a
  // brief 5xx blip would otherwise cost up to 15 minutes of question availability (and it's 3x
  // RULES.MIN_GAP_MINUTES, so the backoff could outlast the very rule it paces against). This
  // drives three consecutive next() failures and shows a flat 60-second wait is always enough to
  // retry -- if the schedule had grown per AnswerQueue's (60s, 120s, 240s...), the second 60s
  // advance below would not be enough and the third attempt would never fire.
  it('caps the next() poll backoff far below AnswerQueue\'s 15-minute ceiling (round2 finding5)', async () => {
    await startTurn(t)
    t.fake.nextFailTimes = 3
    await t.daemon.loop.tick()
    expect(t.fake.nextCalls).toHaveLength(1) // attempt 1, fails
    t.clock.advanceMs(60_000)
    await t.daemon.loop.tick()
    expect(t.fake.nextCalls).toHaveLength(2) // attempt 2, fails -- only 60s needed, not 120s
    t.clock.advanceMs(60_000)
    await t.daemon.loop.tick()
    expect(t.fake.nextCalls).toHaveLength(3) // attempt 3, fails -- still only 60s, not 240s
    t.clock.advanceMs(60_000)
    t.fake.nextQueue.push({ question: servedQuestion() })
    await t.daemon.loop.tick()
    expect(t.fake.nextCalls).toHaveLength(4) // attempt 4, succeeds
    expect((await q(t)).question).not.toBeNull()
  })

  // M4: tick() used to flush the answer queue unconditionally, even while logged out. Because
  // ServerClient throws a plain Error (not a ServerError) when there's no token, AnswerQueue's
  // catch can't tell that apart from a transient failure, so every 2-second tick burned a real
  // attempt against MAX_ATTEMPTS -- a developer logged out for roughly 12 hours would come back
  // to find an answer they had already given abandoned and never paid.
  it('does not burn answer-queue retry attempts toward abandonment while logged out (M4)', async () => {
    await startTurn(t)
    t.fake.nextQueue.push({ question: servedQuestion({ expires_at: new Date(t.clock.now.getTime() + 10 * 60_000).toISOString() }) })
    await t.daemon.loop.tick()
    t.fake.failAnswersTimes = 1
    const res = await answerReq(t, { assignment_id: servedQuestion().assignment_id, option_index: 0, source: 'pane' })
    expect(await res.json()).toMatchObject({ accepted: true, reason: 'queued' })

    writeConfig(t.home, { ...readConfig(t.home), apiToken: null })
    // 55 logged-out ticks, each advanced well past any backoff -- enough to exhaust
    // MAX_ATTEMPTS (50) if tick() kept flushing (and therefore counting attempts) while logged
    // out. It must not: the row should survive untouched.
    for (let i = 0; i < 55; i++) {
      t.clock.advanceMinutes(16)
      await t.daemon.loop.tick()
    }
    expect(t.fake.answers).toHaveLength(0) // never actually sent while logged out

    writeConfig(t.home, { ...readConfig(t.home), apiToken: 'api-token-1' })
    await t.daemon.loop.tick()
    expect(t.fake.answers).toHaveLength(1) // still deliverable -- it was never abandoned
  })

  // Round 2 finding 6: M4 fixed tick()'s continuous drain, but answer()'s own flush() was still
  // ungated -- answering while logged out (e.g. the token was revoked between serve and answer)
  // burns exactly one retry attempt via AnswerQueue's generic backoff path, pushing the row's
  // next_at 60s into the future. Bounded to one per answer rather than a continuous drain, but the
  // same defect. Logging back in with NO time advanced distinguishes it: if the attempt had been
  // burned, the row would not be due yet and this immediate flush would find nothing.
  it('does not burn an answer-queue retry attempt when answering while logged out (round2 finding6)', async () => {
    await startTurn(t)
    t.fake.nextQueue.push({ question: servedQuestion({ expires_at: new Date(t.clock.now.getTime() + 10 * 60_000).toISOString() }) })
    await t.daemon.loop.tick()
    // Simulate the token being revoked between serving the question and the developer answering.
    writeConfig(t.home, { ...readConfig(t.home), apiToken: null })
    const res = await answerReq(t, { assignment_id: servedQuestion().assignment_id, option_index: 0, source: 'pane' })
    expect(await res.json()).toMatchObject({ accepted: true, reason: 'queued' })

    writeConfig(t.home, { ...readConfig(t.home), apiToken: 'api-token-1' })
    await t.daemon.loop.tick() // no clock advance at all
    expect(t.fake.answers).toHaveLength(1)
  })

  // Round 2 finding 2: closing the 4xx path (C1) left the OTHER permanent-deletion exit --
  // MAX_ATTEMPTS exhaustion -- completely silent: the row was removed with only a log line, no
  // FlushResult, no hub event. A developer whose already-given answer is permanently lost got no
  // signal anywhere. This drives a queued answer that always 503s through enough logged-in ticks
  // to exhaust MAX_ATTEMPTS, and checks that the loop broadcasts the loss over SSE.
  it('broadcasts a lost-answer event when a queued answer is abandoned after 50 attempts (round2 finding2)', async () => {
    await startTurn(t)
    t.fake.nextQueue.push({ question: servedQuestion({ expires_at: new Date(t.clock.now.getTime() + 10 * 60_000).toISOString() }) })
    await t.daemon.loop.tick()
    t.fake.failAnswersTimes = Number.MAX_SAFE_INTEGER // never succeeds
    const res = await answerReq(t, { assignment_id: servedQuestion().assignment_id, option_index: 0, source: 'pane' })
    expect(await res.json()).toMatchObject({ accepted: true, reason: 'queued' })

    const sseRes = await fetch(`${t.base}/v1/events`, { headers: t.headers })
    // [0] initial status write, [1] the "queued" outcome's ✓ clearing on the very first 16-minute
    // tick (a `question` broadcast -- ANSWERED_TTL_MS is only 10s), [2] the round-4 state
    // broadcast that now accompanies every resolved row, [3] the loss event itself.
    const eventsPromise = readSseEvents(sseRes, 4)

    // answerReq's own flush already burned attempt #1; 49 more logged-in ticks (each advanced
    // past the capped 15-minute backoff) exhausts MAX_ATTEMPTS (50).
    for (let i = 0; i < 49; i++) {
      t.clock.advanceMinutes(16)
      await t.daemon.loop.tick()
    }

    const events = await eventsPromise
    expect(events[3]).toEqual({ event: 'answered', data: { accepted: false, reason: 'abandoned', earned_cents: 0 } })
  })

  it('reports health.loggedIn live rather than from the startup config snapshot (M3)', async () => {
    await t.stop()
    t = await startTestDaemon({ loggedOut: true })
    const before = await (await fetch(`${t.base}/v1/health`, { headers: t.headers })).json()
    expect(before.loggedIn).toBe(false)
    writeConfig(t.home, { ...readConfig(t.home), apiToken: 'api-token-1' })
    const after = await (await fetch(`${t.base}/v1/health`, { headers: t.headers })).json()
    expect(after.loggedIn).toBe(true)
  })

  // Round 2 finding 1: currentBalances() prefers the locally-cached `balances` kv unconditionally,
  // and setSelf() used to write only the `self` key -- so once any answer had landed, a fresh
  // server-authoritative self (a heartbeat or login response, Task 8's first real caller of
  // setSelf) was silently ignored by view() and by paidAnswersToday. Concretely: a daemon
  // restarted the day after 10 paid answers would load a stale balances.today_paid_answers of 10
  // and stay blocked on daily_cap forever, with no way back -- the one thing that should repair
  // it (a heartbeat's fresh, already-reset count) was shadowed.
  it('lets a fresh setSelf correct a stale locally-cached balance, including across a day rollover (round2 finding1)', async () => {
    await startTurn(t)

    // Fill the profile cap (1/day) first: isolating a paid-only stale count wouldn't otherwise
    // stop next() at all, since evaluateEligibility still lets profile questions through as long
    // as EITHER cap has room.
    t.fake.nextQueue.push({ question: servedQuestion({ kind: 'profile', expires_at: new Date(t.clock.now.getTime() + 10 * 60_000).toISOString() }) })
    await t.daemon.loop.tick()
    await answerReq(t, { assignment_id: servedQuestion().assignment_id, option_index: 0, source: 'pane' })

    // Now land a paid answer whose response simulates having already reached the 10/day cap.
    // This lands in the loop's local `balances` cache, not `self`.
    t.clock.advanceMinutes(6) // clear the 5-minute gap from the profile serve above
    t.fake.answerResponder = () => ({ accepted: true, reason: 'ok', earned_cents: 50, balance_pending_cents: 500, balance_available_cents: 0, today_paid_answers: 10 })
    t.fake.nextQueue.push({ question: servedQuestion({ expires_at: new Date(t.clock.now.getTime() + 10 * 60_000).toISOString() }) })
    await t.daemon.loop.tick()
    await answerReq(t, { assignment_id: servedQuestion().assignment_id, option_index: 0, source: 'pane' })
    expect((await q(t)).today_paid_answers).toBe(10)
    expect(t.fake.nextCalls).toHaveLength(2) // the two serves above

    // Both caps are now (locally) exhausted -- tick() must stop calling next() at all.
    t.clock.advanceMinutes(6)
    await t.daemon.loop.tick()
    expect(t.fake.nextCalls).toHaveLength(2) // unchanged: blocked on daily_cap

    // A fresh setSelf (what a real heartbeat delivers, e.g. after a UTC day rollover resets the
    // paid count server-side) must correct the stale local balances, not be shadowed by them.
    t.daemon.loop.setSelf({
      id: '00000000-0000-4000-8000-000000000001', github_login: 'octo', activity_tier: 'light',
      can_cash_out: true, payout_method: null,
      balance_pending_cents: 500, balance_available_cents: 0, today_paid_answers: 0,
    })
    const view = await q(t)
    expect(view.today_paid_answers).toBe(0)
    expect(view.balance_pending_cents).toBe(500)

    // And it must actually feed evaluateEligibility, not just the display.
    t.clock.advanceMinutes(6)
    t.fake.nextQueue.push({ question: servedQuestion() })
    await t.daemon.loop.tick()
    expect(t.fake.nextCalls).toHaveLength(3) // unblocked -- paidAnswersToday now feeds through as 0
  })

  it('does nothing when logged out', async () => {
    await t.stop()
    t = await startTestDaemon({ loggedOut: true })
    await startTurn(t)
    t.fake.nextQueue.push({ question: servedQuestion() })
    await t.daemon.loop.tick()
    expect(t.fake.nextCalls).toHaveLength(0)
    // I5: nextCalls staying empty is not enough to prove the loop's own `!loggedIn()` guard did
    // anything -- ServerClient.next() independently refuses to call fetch without a token, so
    // nextCalls would stay 0 even with that guard deleted. Only the guard decides whether tick()
    // ever reaches (and logs the failure of) that call in the first place.
    const log = readFileSync(join(t.home, 'daemon.log'), 'utf8')
    expect(log).not.toContain('next failed')
  })

  // Whole-branch review I6. There used to be two tests here pinning a local
  // RULES.LATE_GRACE_MINUTES window inside answer(), both of which had to skip the tick to reach
  // it -- because tick() clears `current` at exactly expires_at, every 2 seconds, so no production
  // path could ever get there. They pinned behaviour the product never exhibited. The grace window
  // is the server's: it distinguishes a `late` answer and pays nothing for it. What the daemon
  // owes the developer is to send the answer and relay that verdict honestly, which is what these
  // two replace them with.
  it('sends an answer that arrives just past expires_at and relays the server\'s late verdict', async () => {
    await startTurn(t)
    t.fake.nextQueue.push({ question: servedQuestion({ expires_at: new Date(t.clock.now.getTime() + 10 * 60_000).toISOString() }) })
    await t.daemon.loop.tick()

    // A second past expiry, before the next 2-second tick has cleared it -- the real window.
    t.clock.advanceMs(10 * 60_000 + 1_000)
    t.fake.answerResponder = () => ({ accepted: false, reason: 'late', earned_cents: 0, balance_pending_cents: 0, balance_available_cents: 0, today_paid_answers: 0 })
    const res = await answerReq(t, { assignment_id: servedQuestion().assignment_id, option_index: 0, source: 'pane' })

    // The answer really went out -- the daemon does not decide lateness for itself any more.
    expect(t.fake.answers).toHaveLength(1)
    expect(await res.json()).toMatchObject({ accepted: false, reason: 'late', earned_cents: 0 })
    // And no checkmark anywhere: a late answer earned nothing.
    expect(await status(t)).not.toContain('✓')
  })

  // The other half of I6: the server returns `duplicate` as accepted:true with zero cents, so
  // every surface rendered `✓ +$0.00` -- a checkmark and a zero, which reads as being paid nothing
  // rather than "this was already counted, and you were already paid".
  it('shows a duplicate as already counted, not as a zero-value payment', async () => {
    await startTurn(t)
    t.fake.nextQueue.push({ question: servedQuestion({ expires_at: new Date(t.clock.now.getTime() + 10 * 60_000).toISOString() }) })
    await t.daemon.loop.tick()

    const sseRes = await fetch(`${t.base}/v1/events`, { headers: t.headers })
    const eventsPromise = readSseEvents(sseRes, 3)

    t.fake.answerResponder = () => ({ accepted: true, reason: 'duplicate', earned_cents: 0, balance_pending_cents: 50, balance_available_cents: 0, today_paid_answers: 1 })
    const res = await answerReq(t, { assignment_id: servedQuestion().assignment_id, option_index: 0, source: 'pane' })
    expect(await res.json()).toMatchObject({ accepted: true, reason: 'duplicate', earned_cents: 0 })

    // The status line must not claim a payment of nothing.
    const line = await status(t)
    expect(line).not.toContain('✓')
    expect(line).not.toContain('$0.00')

    // And the surfaces that read SSE get the reason, so they can say what happened.
    const events = await eventsPromise
    expect(events.slice(0, 3).map((e) => e.event)).toEqual(['status', 'question', 'answered'])
    expect(events[2]!.data).toEqual({ accepted: true, reason: 'duplicate', earned_cents: 0 })
    expect(answerNotice(events[2]!.data as { accepted: boolean; reason: string; earned_cents: number })).toMatch(/already/i)
  })

  it('rejects an option index outside the served question\'s options as invalid_option, leaving the question current', async () => {
    await startTurn(t)
    t.fake.nextQueue.push({ question: servedQuestion({ expires_at: new Date(t.clock.now.getTime() + 10 * 60_000).toISOString() }) })
    await t.daemon.loop.tick()
    const res = await answerReq(t, { assignment_id: servedQuestion().assignment_id, option_index: 2, source: 'pane' })
    expect(await res.json()).toMatchObject({ accepted: false, reason: 'invalid_option', earned_cents: 0 })
    expect(t.fake.answers).toHaveLength(0)
    expect((await q(t)).question).not.toBeNull()
  })

  // A naive "one next() call in flight" test that fires two ticks back to back without ever
  // overlapping their network calls would pass even with no guard at all, since the fake replies
  // instantly. Delaying the fake's response makes the overlap real: tick() #2 must observe
  // in-flight #1 mid-flight and bail, not just happen to run after it finished.
  it('keeps only one next() call in flight even when two ticks genuinely overlap', async () => {
    await startTurn(t)
    t.fake.nextDelayMs = 100
    t.fake.nextQueue.push({ question: servedQuestion() })
    const first = t.daemon.loop.tick()
    const second = t.daemon.loop.tick()
    await Promise.all([first, second])
    expect(t.fake.nextCalls).toHaveLength(1)
    expect((await q(t)).question).not.toBeNull()
  })

  it('broadcasts question and answered events over sse with the exact payloads', async () => {
    await startTurn(t)
    const sseRes = await fetch(`${t.base}/v1/events`, { headers: t.headers })
    const eventsPromise = readSseEvents(sseRes, 4)

    const expiresAt = new Date(t.clock.now.getTime() + 10 * 60_000).toISOString()
    t.fake.nextQueue.push({ question: servedQuestion({ expires_at: expiresAt }) })
    await t.daemon.loop.tick()
    await answerReq(t, { assignment_id: servedQuestion().assignment_id, option_index: 0, source: 'pane' })

    const events = await eventsPromise
    expect(events[0]).toMatchObject({ event: 'status', data: { question: null, logged_in: true } })
    expect(events[1]).toMatchObject({ event: 'question', data: { question: { assignment_id: servedQuestion().assignment_id, text: 'Which tagline?' } } })
    expect(events[2]).toMatchObject({ event: 'question', data: { question: null, balance_pending_cents: 50, balance_available_cents: 0, today_paid_answers: 1 } })
    expect(events[3]).toEqual({ event: 'answered', data: { accepted: true, reason: 'ok', earned_cents: 50 } })
  })

  // I4: lastServedAt (and the rest of the local frequency history) must survive a daemon
  // restart. Before this fix it lived only in memory, so every restart reset it to exactly the
  // inputs that make evaluateEligibility approve everything -- the 5-minute gap included. This
  // test restarts a second QuestionLoop against the SAME sqlite state file (not startTestDaemon,
  // which always mints a fresh temp home) and checks the gap from before the restart still
  // blocks: if lastServedAt hadn't persisted, the fresh loop would see no history at all and
  // serve immediately.
  it('persists local frequency history across a restart so the 5-minute gap survives (I4)', async () => {
    const home = mkdtempSync(join(tmpdir(), 'mw-restart-'))
    try {
      const clock = new FakeClock(new Date('2026-09-10T10:00:00.000Z'))
      const fake = await startFakeServer()
      ensureHome(home)
      writeConfig(home, { ...readConfig(home), apiToken: 'api-token-1' })

      let daemon = await startDaemon({ home, port: 0, clock: () => clock.now, serverUrl: fake.url, idleExitMs: 0, tickIntervalMs: 0 })
      let headers = { 'x-tickover-token': daemon.token, 'content-type': 'application/json' }
      let base = `http://127.0.0.1:${daemon.port}`
      const send = (event: string) => fetch(`${base}/v1/hook`, { method: 'POST', headers, body: JSON.stringify({ event, session_id: 's1', tool: 'claude-code' }) })

      await send('SessionStart')
      clock.advanceMinutes(3)
      await send('UserPromptSubmit')
      clock.advanceMs(9_000)
      fake.nextQueue.push({ question: servedQuestion({ expires_at: new Date(clock.now.getTime() + 10 * 60_000).toISOString() }) })
      await daemon.loop.tick()
      expect(fake.nextCalls).toHaveLength(1) // served -- lastServedAt is now T0

      // Restart: stop (keeps the sqlite file) and start a brand new QuestionLoop over the same
      // home. The clock does not advance across the restart.
      await daemon.stop()
      daemon = await startDaemon({ home, port: 0, clock: () => clock.now, serverUrl: fake.url, idleExitMs: 0, tickIntervalMs: 0 })
      headers = { 'x-tickover-token': daemon.token, 'content-type': 'application/json' }
      base = `http://127.0.0.1:${daemon.port}`

      // SessionTracker itself is NOT persisted, so re-establish an active turn -- but advance
      // just enough for warmup/turn-too-short to clear, while staying inside the persisted gap.
      await fetch(`${base}/v1/hook`, { method: 'POST', headers, body: JSON.stringify({ event: 'SessionStart', session_id: 's1', tool: 'claude-code' }) })
      clock.advanceMinutes(3)
      await fetch(`${base}/v1/hook`, { method: 'POST', headers, body: JSON.stringify({ event: 'UserPromptSubmit', session_id: 's1', tool: 'claude-code' }) })
      clock.advanceMs(9_000) // now = T0 + 3min9s -- still inside the persisted 5-minute gap

      fake.nextQueue.push({ question: servedQuestion() })
      await daemon.loop.tick()
      expect(fake.nextCalls).toHaveLength(1) // still blocked -- proves lastServedAt persisted

      clock.advanceMinutes(2) // now = T0 + 5min9s -- past the gap
      await daemon.loop.tick()
      expect(fake.nextCalls).toHaveLength(2) // gap elapsed, now allowed

      await daemon.stop()
      await fake.close()
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  })

  // Round 3: combining round 2's finding-2 fix (report abandonment/rejection via a callback) and
  // finding-3 fix (chain overlapping flush() passes instead of sharing one) reintroduced the exact
  // double-broadcast bug this task keeps producing on this seam. Mechanism the re-reviewer traced:
  // tick() starts a flush that synchronously snapshots dueAnswers() = [R1] and suspends on a slow
  // send; a concurrent answer() for a DIFFERENT assignment enqueues R2 and calls flush(); under the
  // old shared-promise design both callers ended up holding the same `sent` array and each
  // independently decided to notify about R1, double-firing. This test drives a genuine overlap of
  // exactly that shape through the real HTTP surface and checks both halves of the fix: R1's loss
  // is broadcast exactly once, and R2 (the overlapping caller's own row) gets its real outcome
  // rather than a stand-in "queued".
  it('does not double-broadcast a loss, and gives an overlapping answer() its own real outcome, under a genuine flush() overlap (round3)', async () => {
    await startTurn(t)
    t.fake.nextQueue.push({ question: servedQuestion({ assignment_id: '11111111-1111-4111-8111-111111111111', expires_at: new Date(t.clock.now.getTime() + 60 * 60_000).toISOString() }) })
    await t.daemon.loop.tick()

    t.fake.failAnswersTimes = 10 // exact count isn't load-bearing, just "keeps failing" through the loop below
    await answerReq(t, { assignment_id: '11111111-1111-4111-8111-111111111111', option_index: 0, source: 'pane' }) // R1's 1st attempt -- schedules backoffMs(0) = 60s

    // Drive three more failures so R1's backoff (60s, 120s, 240s, 480s) ends up past the 5-minute
    // serve gap -- otherwise clearing the gap to serve Q2 below would also make R1 due, and it
    // would resolve as an ordinary retry there instead of via the deliberate slow/rejected attempt
    // that this test actually wants to overlap with Q2's answer.
    for (let i = 0; i < 3; i++) {
      t.clock.advanceMs(backoffMs(i) + 1_000)
      await t.daemon.loop.tick()
    }

    // The gap is now open (well past 5 minutes since R1's question was served), but R1 itself
    // isn't due yet (pushed out to an 8-minute backoff) -- this tick() serves Q2 without ever
    // touching R1.
    t.clock.advanceMs(5_000) // clears whatever retry_after_ms an empty-queue next() call set above
    t.fake.nextQueue.push({ question: servedQuestion({ assignment_id: '22222222-2222-4222-8222-222222222222', expires_at: new Date(t.clock.now.getTime() + 60 * 60_000).toISOString() }) })
    await t.daemon.loop.tick()
    expect((await q(t)).question?.assignment_id).toBe('22222222-2222-4222-8222-222222222222')

    const sseRes = await fetch(`${t.base}/v1/events`, { headers: t.headers })
    const eventsPromise = readSseEvents(sseRes, 4)

    // Make R1 due again, and its next attempt slow (so the overlap is genuine, not a same-tick
    // coincidence) and permanently rejected (a 422 -- the loss this test checks isn't double-fired).
    t.clock.advanceMs(backoffMs(3) + 1_000)
    t.fake.answerDelayMs = 150
    t.fake.failAnswersTimes = 1
    t.fake.answerFailStatus = 422

    const tickPromise = t.daemon.loop.tick() // starts a flush over R1 alone, suspends on the slow 422
    const answerPromise = answerReq(t, { assignment_id: '22222222-2222-4222-8222-222222222222', option_index: 0, source: 'pane' }) // Q2 -- enqueues R2 only after R1's pass already took its snapshot
    const [, answerRes] = await Promise.all([tickPromise, answerPromise])

    // The overlapping caller's own row (R2) got a real pass and a real outcome -- not "queued"
    // just because it happened to overlap R1's flush.
    expect(await answerRes.json()).toMatchObject({ accepted: true, reason: 'ok', earned_cents: 50 })

    const events = await eventsPromise
    const lossEvents = events.filter((e) => e.event === 'answered' && (e.data as { reason?: string }).reason === 'rejected')
    expect(lossEvents).toHaveLength(1) // exactly one loss broadcast for R1, not two
    expect(lossEvents[0]!.data).toEqual({ accepted: false, reason: 'rejected', earned_cents: 0 })
  })
})
