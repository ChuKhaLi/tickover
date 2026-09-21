import { describe, it, expect } from 'vitest'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { HeartbeatRequest } from '@tickover/contract'
import { startTestDaemon } from '../helpers/daemon.js'
import { servedQuestion } from '../helpers/fake-server.js'

describe('heartbeat and idle exit', () => {
  it('sends os, version, extension counts, and unsent turns at most every interval', async () => {
    const t = await startTestDaemon()
    const proj = join(t.home, 'proj')
    mkdirSync(join(proj, 'src'), { recursive: true })
    writeFileSync(join(proj, 'src', 'a.ts'), '')
    const hook = (event: string) => fetch(`${t.base}/v1/hook`, { method: 'POST', headers: t.headers, body: JSON.stringify({ event, session_id: 's1', tool: 'claude-code', tool_version: '2.1.90', cwd: proj }) })
    await hook('SessionStart')
    await hook('UserPromptSubmit')
    t.clock.advanceMs(15_000)
    await hook('Stop')
    await t.daemon.heartbeat.tick()
    expect(t.fake.heartbeats).toHaveLength(1)
    expect(t.fake.heartbeats[0]).toMatchObject({ os: process.platform, tool: 'claude-code', tool_version: '2.1.90', extension_counts: { ts: 1 } })
    expect(t.fake.heartbeats[0]!.turns).toHaveLength(1)
    await t.daemon.heartbeat.tick()
    expect(t.fake.heartbeats).toHaveLength(1)
    t.clock.advanceMinutes(6)
    await t.daemon.heartbeat.tick()
    expect(t.fake.heartbeats).toHaveLength(2)
    expect(t.fake.heartbeats[1]!.turns).toHaveLength(0)
    await t.stop()
  })

  // Privacy (Global Constraint): the heartbeat body must never carry the cwd itself, only the
  // aggregate extension counts derived from it. The test above already pins the counts; this one
  // pins the negative -- if the payload ever grew a `cwd`/`path`/`repo` field, this fails.
  it('never puts the working directory or any path on the wire', async () => {
    const t = await startTestDaemon()
    const proj = join(t.home, 'super-secret-project-name')
    mkdirSync(proj, { recursive: true })
    writeFileSync(join(proj, 'a.ts'), '')
    await fetch(`${t.base}/v1/hook`, { method: 'POST', headers: t.headers, body: JSON.stringify({ event: 'SessionStart', session_id: 's1', tool: 'claude-code', cwd: proj }) })
    await fetch(`${t.base}/v1/hook`, { method: 'POST', headers: t.headers, body: JSON.stringify({ event: 'UserPromptSubmit', session_id: 's1', tool: 'claude-code' }) })
    await t.daemon.heartbeat.tick()
    expect(t.fake.heartbeats).toHaveLength(1)
    const wire = JSON.stringify(t.fake.heartbeats[0])
    expect(wire).not.toContain('super-secret-project-name')
    expect(wire).not.toContain(t.home)
    await t.stop()
  })

  // Whole-branch review C1, asserted on the channel the leak actually travels on: the request
  // body the server receives. The unit test above pins countExtensions in isolation; this one
  // pins that nothing between the walk and the wire re-widens the key space, and that the body
  // the daemon builds satisfies its own published schema.
  it('puts no filename tail on the wire, and sends a body its own wire schema accepts', async () => {
    const t = await startTestDaemon()
    const proj = join(t.home, 'proj')
    mkdirSync(proj, { recursive: true })
    writeFileSync(join(proj, 'Dockerfile.acme-internal-prod'), '')
    writeFileSync(join(proj, 'deploy.customer-northwind-2026'), '')
    writeFileSync(join(proj, 'notes.ProjectPhoenix'), '')
    writeFileSync(join(proj, '.env.production'), '')
    writeFileSync(join(proj, `x.${'a'.repeat(120)}`), '')
    writeFileSync(join(proj, 'a.ts'), '')
    writeFileSync(join(proj, 'b.py'), '')
    writeFileSync(join(proj, 'c.md'), '')
    await fetch(`${t.base}/v1/hook`, { method: 'POST', headers: t.headers, body: JSON.stringify({ event: 'SessionStart', session_id: 's1', tool: 'claude-code', cwd: proj }) })
    await t.daemon.heartbeat.tick()

    expect(t.fake.heartbeats).toHaveLength(1)
    const body = t.fake.heartbeats[0]!
    expect(body.extension_counts).toEqual({ ts: 1, py: 1, md: 1 })
    const wire = JSON.stringify(body)
    for (const leaked of ['acme-internal-prod', 'customer-northwind-2026', 'ProjectPhoenix', 'projectphoenix', 'production', 'a'.repeat(120)]) {
      expect(wire).not.toContain(leaked)
    }
    // The daemon never validates its own outbound bodies at runtime; this is where that gap is
    // covered, against the same schema the real server parses with.
    expect(HeartbeatRequest.safeParse(body).success).toBe(true)
    await t.stop()
  })

  // Round1 review, finding1: on any failure, `lastSentAt` kept its last *successful* value, so
  // the very next tick's interval check (`now - lastSentAt < intervalMs`) saw an ever-growing gap
  // against a fixed old timestamp and let the retry straight through immediately -- in production
  // that's a request every tickIntervalMs (2s), not every intervalMs (5min), for as long as a
  // session stays open. This pins the fix: a failed attempt must wait out a backoff before the
  // next one is even tried, and a success must reset that backoff, not leave the next failure
  // starting from wherever the previous streak left off.
  it('backs off after a failed heartbeat and resets the backoff on success', async () => {
    const t = await startTestDaemon()
    await fetch(`${t.base}/v1/hook`, { method: 'POST', headers: t.headers, body: JSON.stringify({ event: 'SessionStart', session_id: 's1', tool: 'claude-code' }) })
    t.fake.heartbeatFailTimes = 1
    await t.daemon.heartbeat.tick() // fails; consumes heartbeatFailTimes
    expect(t.fake.heartbeats).toHaveLength(0)
    // Retrying on literally the next tick (no time elapsed) must not go through -- if it did, it
    // would actually succeed right now (heartbeatFailTimes is already exhausted), which is
    // exactly how the missing-backoff defect would slip this test.
    await t.daemon.heartbeat.tick()
    expect(t.fake.heartbeats).toHaveLength(0)
    t.clock.advanceMs(30_000) // well under the 60s base backoff for the first failed attempt
    await t.daemon.heartbeat.tick()
    expect(t.fake.heartbeats).toHaveLength(0)
    t.clock.advanceMs(31_000) // now past the 60s backoff -- the retry goes through and succeeds
    await t.daemon.heartbeat.tick()
    expect(t.fake.heartbeats).toHaveLength(1)

    // A second failure right after that success must back off from attempt 0 again (~60s), not
    // from wherever the first failure streak left off (which would need ~120s here instead).
    t.fake.heartbeatFailTimes = 1
    t.clock.advanceMinutes(10) // clear the normal 5-minute interval gate
    await t.daemon.heartbeat.tick()
    expect(t.fake.heartbeats).toHaveLength(1)
    t.clock.advanceMs(61_000)
    await t.daemon.heartbeat.tick()
    expect(t.fake.heartbeats).toHaveLength(2)
    await t.stop()
  })

  // Round1 review, finding2: nothing pinned Heartbeat.tick()'s call to `loop.setSelf(self)` --
  // dropping that one line would break the repair path for a real prior bug (a stale
  // locally-cached today_paid_answers blocking paid questions, see question-loop.ts's setSelf
  // comment) without any test going red. Drives the exact same daily_cap-reopening scenario as
  // question-loop's round2-finding1 regression test, but through a real heartbeat response
  // (t.fake.self + t.daemon.heartbeat.tick()) instead of a manual loop.setSelf() call, so it
  // actually exercises the wiring inside Heartbeat, not just QuestionLoop in isolation.
  it('feeds a real heartbeat response into QuestionLoop, correcting view() and reopening blocked eligibility', async () => {
    const t = await startTestDaemon()
    const hook = (event: string) => fetch(`${t.base}/v1/hook`, { method: 'POST', headers: t.headers, body: JSON.stringify({ event, session_id: 's1', tool: 'claude-code', cwd: 'C:/proj' }) })
    await hook('SessionStart')
    t.clock.advanceMinutes(3) // past the 2-minute session warmup
    await hook('UserPromptSubmit')
    t.clock.advanceMs(9_000) // past the 8-second minimum turn length

    // Fill the profile cap (1/day) first: evaluateEligibility only reports daily_cap once BOTH
    // caps are exhausted, so a paid-only stale count wouldn't stop next() at all on its own.
    t.fake.nextQueue.push({ question: servedQuestion({ kind: 'profile', expires_at: new Date(t.clock.now.getTime() + 10 * 60_000).toISOString() }) })
    await t.daemon.loop.tick()
    await fetch(`${t.base}/v1/answer`, { method: 'POST', headers: t.headers, body: JSON.stringify({ assignment_id: servedQuestion().assignment_id, option_index: 0, source: 'pane' }) })

    t.clock.advanceMinutes(6) // clear the 5-minute gap from the profile serve above
    t.fake.answerResponder = () => ({ accepted: true, reason: 'ok', earned_cents: 50, balance_pending_cents: 500, balance_available_cents: 0, today_paid_answers: 10 })
    t.fake.nextQueue.push({ question: servedQuestion({ expires_at: new Date(t.clock.now.getTime() + 10 * 60_000).toISOString() }) })
    await t.daemon.loop.tick()
    await fetch(`${t.base}/v1/answer`, { method: 'POST', headers: t.headers, body: JSON.stringify({ assignment_id: servedQuestion().assignment_id, option_index: 0, source: 'pane' }) })
    expect(t.fake.nextCalls).toHaveLength(2)

    t.clock.advanceMinutes(6)
    await t.daemon.loop.tick()
    expect(t.fake.nextCalls).toHaveLength(2) // both caps locally exhausted -- blocked on daily_cap

    // A real heartbeat -- not a manual loop.setSelf() call -- delivers the server's
    // already-reset count.
    t.fake.self = { ...t.fake.self, balance_pending_cents: 500, balance_available_cents: 0, today_paid_answers: 0 }
    await t.daemon.heartbeat.tick()
    const view = await (await fetch(`${t.base}/v1/question`, { headers: t.headers })).json()
    expect(view.today_paid_answers).toBe(0)
    expect(view.balance_pending_cents).toBe(500)

    // And it must actually feed evaluateEligibility, not just the display.
    t.clock.advanceMinutes(6)
    t.fake.nextQueue.push({ question: servedQuestion() })
    await t.daemon.loop.tick()
    expect(t.fake.nextCalls).toHaveLength(3) // unblocked via the heartbeat's setSelf
    await t.stop()
  })

  // Whole-branch review I4 / X1: SessionTracker.prune() had ZERO production callers -- Task 5 wrote
  // it, Task 8 built IdleWatch on sessions.count() === 0, and neither owned the call site. A
  // Claude Code session that dies without SessionEnd (terminal window closed, process killed,
  // crash, laptop sleep) therefore stayed in the map forever: the count never reached zero, the
  // daemon never exited, and telemetry kept going out indefinitely after the developer stopped
  // working. Both existing idle tests drive SessionEnd explicitly, so neither could ever go red.
  //
  // Driven through the daemon's own composite tick(), not idle.tick(), because the whole defect
  // was a missing call in that composite -- a test that calls idle.tick() directly cannot see it.
  it('exits and stops heartbeating after a session dies silently, with no SessionEnd (I4)', async () => {
    let idle = 0
    const t = await startTestDaemon({ idleExitMs: 30 * 60_000, onIdle: () => { idle += 1 } })
    const hook = (event: string) => fetch(`${t.base}/v1/hook`, { method: 'POST', headers: t.headers, body: JSON.stringify({ event, session_id: 's1', tool: 'claude-code', cwd: t.home }) })
    await hook('SessionStart')
    await hook('UserPromptSubmit')
    // ...and then nothing. The terminal was closed; no Stop, no SessionEnd, ever again.

    await t.daemon.tick()
    expect(t.daemon.sessions.count()).toBe(1)
    const heartbeatsWhileAlive = t.fake.heartbeats.length
    expect(heartbeatsWhileAlive).toBeGreaterThan(0)

    // Well inside the staleness window: still believed alive, so nothing changes.
    t.clock.advanceMinutes(60)
    await t.daemon.tick()
    expect(t.daemon.sessions.count()).toBe(1)
    expect(idle).toBe(0)

    // Past it: the session is declared dead, and the idle clock can finally start.
    t.clock.advanceMinutes(3 * 60)
    await t.daemon.tick()
    expect(t.daemon.sessions.count()).toBe(0)
    expect(idle).toBe(0) // idle exit is 30 minutes AFTER the last session goes away, not instant
    const heartbeatsAtDeath = t.fake.heartbeats.length

    t.clock.advanceMinutes(31)
    await t.daemon.tick()
    expect(idle).toBe(1)
    // And the telemetry actually stopped -- the constraint is not only "the daemon exits", it is
    // that nothing keeps leaving the machine in the meantime.
    expect(t.fake.heartbeats).toHaveLength(heartbeatsAtDeath)
    await t.stop()
  })

  // Re-review finding 2, asserted on the channel the turn travels on: the wire. A session that
  // dies without SessionEnd is exactly the case where its last turn is still open, so the prune
  // that handles that death was also silently discarding the turn. It must survive the prune,
  // reach state, and go out on the next heartbeat a later session makes possible.
  it('still reports the turn of a session that died mid-turn (re-review 2)', async () => {
    const t = await startTestDaemon()
    const hook = (event: string, session: string) => fetch(`${t.base}/v1/hook`, { method: 'POST', headers: t.headers, body: JSON.stringify({ event, session_id: session, tool: 'claude-code' }) })
    await hook('SessionStart', 'dying')
    t.clock.advanceMinutes(1)
    await hook('UserPromptSubmit', 'dying')
    const turnStartedAt = t.clock.now
    await t.daemon.tick()
    // Nothing sent yet: the turn is still open, so there is nothing to report about it.
    expect(t.fake.heartbeats[0]!.turns).toHaveLength(0)

    // The terminal dies here. No Stop, no SessionEnd, ever.
    t.clock.advanceMinutes(3 * 60)
    await t.daemon.tick()
    expect(t.daemon.sessions.count()).toBe(0)

    // A new session later gives the heartbeat something to ride out on.
    await hook('SessionStart', 'fresh')
    t.clock.advanceMinutes(6)
    await t.daemon.tick()
    const turns = t.fake.heartbeats.flatMap((h) => h.turns)
    expect(turns).toHaveLength(1)
    expect(turns[0]!.started_at).toBe(turnStartedAt.toISOString())
    // Ended at the last evidence of life, not at the prune instant three hours later.
    expect(new Date(turns[0]!.ended_at).getTime()).toBe(turnStartedAt.getTime())
    await t.stop()
  })

  // The other half: a session that is genuinely alive but quiet must NOT be pruned out from under
  // a working developer. The status line polls /v1/status with its session_id every few seconds
  // for as long as Claude Code is rendering it, which is the strongest liveness signal the daemon
  // gets -- stronger than hooks, which can be hours apart while someone reads code.
  it('keeps a session alive on status-line polling, so a quiet developer is not pruned (I4)', async () => {
    let idle = 0
    const t = await startTestDaemon({ idleExitMs: 30 * 60_000, onIdle: () => { idle += 1 } })
    await fetch(`${t.base}/v1/hook`, { method: 'POST', headers: t.headers, body: JSON.stringify({ event: 'SessionStart', session_id: 's1', tool: 'claude-code' }) })

    // Six hours of reading code: no hooks at all, just the status line repainting.
    for (let hour = 0; hour < 6; hour++) {
      t.clock.advanceMinutes(60)
      await fetch(`${t.base}/v1/status?session_id=s1`, { headers: t.headers })
      await t.daemon.tick()
    }
    expect(t.daemon.sessions.count()).toBe(1)
    expect(idle).toBe(0)

    // A poll for a session the daemon has never heard of must not conjure one into existence --
    // that would resurrect a pruned session and hold the daemon open forever again (P1's shape).
    await fetch(`${t.base}/v1/status?session_id=ghost`, { headers: t.headers })
    expect(t.daemon.sessions.count()).toBe(1)
    await t.stop()
  })

  it('reports idle after the configured time with no sessions', async () => {
    let idle = 0
    const t = await startTestDaemon({ idleExitMs: 60_000, onIdle: () => { idle += 1 } })
    t.daemon.idle.tick()
    expect(idle).toBe(0)
    t.clock.advanceMinutes(2)
    t.daemon.idle.tick()
    expect(idle).toBe(1)
    // A watcher that fired on every tick past the threshold (instead of latching after the first
    // fire) would also pass everything above -- only a further tick, still idle, catches it.
    t.clock.advanceMinutes(2)
    t.daemon.idle.tick()
    expect(idle).toBe(1)
    await t.stop()
  })

  it('resets the idle clock when a session becomes active again, and never fires while sessions.count() > 0', async () => {
    let idle = 0
    const t = await startTestDaemon({ idleExitMs: 60_000, onIdle: () => { idle += 1 } })
    t.clock.advanceMinutes(2)
    t.daemon.idle.tick()
    expect(idle).toBe(0)
    await fetch(`${t.base}/v1/hook`, { method: 'POST', headers: t.headers, body: JSON.stringify({ event: 'SessionStart', session_id: 's1', tool: 'claude-code' }) })
    t.daemon.idle.tick()
    expect(idle).toBe(0)
    t.clock.advanceMinutes(2)
    // Still idle-checking with an open session: must not fire regardless of elapsed time.
    t.daemon.idle.tick()
    expect(idle).toBe(0)
    await fetch(`${t.base}/v1/hook`, { method: 'POST', headers: t.headers, body: JSON.stringify({ event: 'SessionEnd', session_id: 's1', tool: 'claude-code' }) })
    t.daemon.idle.tick()
    expect(idle).toBe(0)
    t.clock.advanceMinutes(2)
    t.daemon.idle.tick()
    expect(idle).toBe(1)
    await t.stop()
  })
})
