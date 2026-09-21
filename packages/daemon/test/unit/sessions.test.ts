import { describe, it, expect } from 'vitest'
import { SessionTracker } from '../../src/sessions.js'

describe('SessionTracker', () => {
  it('tracks sessions, turns, and reports the active turn', () => {
    let now = new Date('2026-09-10T10:00:00Z')
    const ended: Array<{ sessionId: string; startedAt: Date; endedAt: Date }> = []
    const s = new SessionTracker(() => now, (t) => ended.push(t))
    s.hook({ event: 'SessionStart', session_id: 'a', cwd: 'C:/p', tool: 'claude-code', tool_version: '2.1.90' })
    expect(s.count()).toBe(1)
    expect(s.activeTurn()).toBeNull()
    now = new Date(now.getTime() + 5_000)
    s.hook({ event: 'UserPromptSubmit', session_id: 'a', tool: 'claude-code' })
    expect(s.activeTurn()).toMatchObject({ sessionId: 'a', turnStartedAt: now })
    now = new Date(now.getTime() + 20_000)
    s.hook({ event: 'Stop', session_id: 'a', tool: 'claude-code' })
    expect(s.activeTurn()).toBeNull()
    expect(ended).toHaveLength(1)
    expect(ended[0]!.endedAt.getTime() - ended[0]!.startedAt.getTime()).toBe(20_000)
    expect(s.cwds()).toEqual(['C:/p'])
    expect(s.toolVersion()).toBe('2.1.90')
  })

  it('creates a session implicitly from a prompt, prefers the oldest active turn, and prunes stale sessions', () => {
    let now = new Date('2026-09-10T10:00:00Z')
    const s = new SessionTracker(() => now, () => {})
    s.hook({ event: 'UserPromptSubmit', session_id: 'x', tool: 'claude-code' })
    now = new Date(now.getTime() + 1_000)
    s.hook({ event: 'UserPromptSubmit', session_id: 'y', tool: 'claude-code' })
    expect(s.activeTurn()!.sessionId).toBe('x')
    s.hook({ event: 'SessionEnd', session_id: 'x', tool: 'claude-code' })
    expect(s.activeTurn()!.sessionId).toBe('y')
    now = new Date(now.getTime() + 7 * 3_600_000)
    s.prune(6 * 3_600_000)
    expect(s.count()).toBe(0)
  })

  // Re-review finding 2: pruning a session that still had an open turn dropped that turn on the
  // floor. Turns are the developer's activity record -- the server tiers on how many they have in
  // a week -- and a session dying without SessionEnd is exactly the case where the last turn is
  // still open, so the prune that exists to handle that death was also the thing throwing it away.
  it('closes an open turn when it prunes the session, instead of discarding it', () => {
    let now = new Date('2026-09-10T10:00:00Z')
    const ended: Array<{ sessionId: string; startedAt: Date; endedAt: Date }> = []
    const s = new SessionTracker(() => now, (t) => ended.push(t))
    s.hook({ event: 'SessionStart', session_id: 'a', tool: 'claude-code' })
    now = new Date(now.getTime() + 60_000)
    s.hook({ event: 'UserPromptSubmit', session_id: 'a', tool: 'claude-code' })
    const turnStartedAt = now
    // A last sign of life 30 seconds into the turn -- a status-line poll -- and then nothing.
    now = new Date(now.getTime() + 30_000)
    s.touch('a')
    const lastSeenAt = now

    now = new Date(now.getTime() + 3 * 3_600_000)
    s.prune(2 * 3_600_000)

    expect(s.count()).toBe(0)
    expect(ended).toHaveLength(1)
    expect(ended[0]).toEqual({ sessionId: 'a', startedAt: turnStartedAt, endedAt: lastSeenAt })
    // Ends at the last evidence of life, NOT at the prune instant: reporting `now` would invent
    // three hours of work that may never have happened, on a record the server tiers people by.
    expect(ended[0]!.endedAt.getTime()).toBeLessThan(now.getTime())
    expect(ended[0]!.endedAt.getTime()).toBeGreaterThanOrEqual(ended[0]!.startedAt.getTime())
  })

  it('emits nothing extra when it prunes a session with no turn open', () => {
    let now = new Date('2026-09-10T10:00:00Z')
    const ended: unknown[] = []
    const s = new SessionTracker(() => now, (t) => ended.push(t))
    s.hook({ event: 'SessionStart', session_id: 'a', tool: 'claude-code' })
    now = new Date(now.getTime() + 10_000)
    s.hook({ event: 'UserPromptSubmit', session_id: 'a', tool: 'claude-code' })
    now = new Date(now.getTime() + 10_000)
    s.hook({ event: 'Stop', session_id: 'a', tool: 'claude-code' }) // turn already closed properly
    expect(ended).toHaveLength(1)

    now = new Date(now.getTime() + 3 * 3_600_000)
    s.prune(2 * 3_600_000)
    expect(s.count()).toBe(0)
    expect(ended).toHaveLength(1) // no phantom second turn for the same work
  })

  // P1 (Task 5 review, resolved in Task 8): a bare Stop for a session id never seen before used
  // to fall through to ensure(), which created a brand-new (phantom) session -- count() 0 -> 1 --
  // even though nothing about a lone Stop means a session actually started. Harmless on its own
  // (it self-pruned after 6 hours), but IdleWatch (Task 8) fires the daemon's exit on
  // sessions.count() === 0, so one stray Stop would have held the daemon -- and its heartbeating
  // -- alive for up to 6 hours, against the 30-minute idle-exit constraint. Against the
  // unfixed ensure() (which created a session for any event), count() below would be 1, not 0.
  it('ignores a bare Stop for a session id that was never opened (P1)', () => {
    const ended: unknown[] = []
    const s = new SessionTracker(() => new Date('2026-09-10T10:00:00Z'), (t) => ended.push(t))
    s.hook({ event: 'Stop', session_id: 'ghost', tool: 'claude-code' })
    expect(s.count()).toBe(0)
    expect(ended).toHaveLength(0)
    // A real session must still work normally: SessionStart (or an implicit UserPromptSubmit,
    // covered above) opens one, and only then does Stop end a turn.
    s.hook({ event: 'SessionStart', session_id: 'real', tool: 'claude-code' })
    expect(s.count()).toBe(1)
  })

  // Round1 review of the P1 fix: the guard on ensure() must reject a *bare* Stop for an unopened
  // session without also breaking the case a wrong guard would most easily break -- a session
  // that only ever opened via an implicit UserPromptSubmit (the daemon starting up after Claude
  // Code already has a session running, so the first hook it ever sees is UserPromptSubmit, not
  // SessionStart) must still have its turn closed correctly by a later Stop.
  it('still closes a turn with Stop for a session that only ever opened via UserPromptSubmit', () => {
    let now = new Date('2026-09-10T10:00:00Z')
    const ended: Array<{ sessionId: string; startedAt: Date; endedAt: Date }> = []
    const s = new SessionTracker(() => now, (t) => ended.push(t))
    s.hook({ event: 'UserPromptSubmit', session_id: 'daemon-started-late', tool: 'claude-code' })
    expect(s.count()).toBe(1)
    expect(s.activeTurn()?.sessionId).toBe('daemon-started-late')
    now = new Date(now.getTime() + 12_000)
    s.hook({ event: 'Stop', session_id: 'daemon-started-late', tool: 'claude-code' })
    expect(s.activeTurn()).toBeNull()
    expect(ended).toHaveLength(1)
    expect(ended[0]).toMatchObject({ sessionId: 'daemon-started-late', endedAt: now })
    expect(ended[0]!.endedAt.getTime() - ended[0]!.startedAt.getTime()).toBe(12_000)
  })

  // Task 11: the hook payload notify.mjs sends never carries a version -- the real Claude Code
  // version only arrives via the status line's GET /v1/status, which calls this directly.
  it('noteVersion records a version on an existing session and is a no-op otherwise', () => {
    const s = new SessionTracker(() => new Date('2026-09-10T10:00:00Z'), () => {})
    s.hook({ event: 'SessionStart', session_id: 'a', tool: 'claude-code' })
    s.noteVersion('a', '2.1.90')
    expect(s.toolVersion()).toBe('2.1.90')
    // An unknown session id must not create a phantom session (same P1 concern as a bare Stop).
    s.noteVersion('unknown', '9.9.9')
    expect(s.count()).toBe(1)
    // An empty version string must not clobber an already-recorded one.
    s.noteVersion('a', '')
    expect(s.toolVersion()).toBe('2.1.90')
  })
})

describe('band claims (R204)', () => {
  const A = '8f0b0f2e-6f6a-4a3a-9c1f-0f1e2d3c4b5a'
  const B = '11111111-1111-4111-8111-111111111111'
  const tracker = () => {
    const clock = { now: new Date('2026-09-10T10:00:00Z') }
    const s = new SessionTracker(() => clock.now, () => {})
    const advance = (ms: number) => { clock.now = new Date(clock.now.getTime() + ms) }
    return { s, advance }
  }

  it('holds the question for the session that claimed it, for 6 seconds and not a millisecond more', () => {
    const { s, advance } = tracker()
    s.hook({ event: 'SessionStart', session_id: 'a', tool: 'claude-code' })
    expect(s.bandHolds('a', A)).toBe(false)
    s.claimBand('a', A)
    expect(s.bandHolds('a', A)).toBe(true)
    advance(6_000)
    expect(s.bandHolds('a', A)).toBe(true)
    advance(1)
    expect(s.bandHolds('a', A)).toBe(false)
  })

  it('holds only the assignment claimed, and only for the session that claimed it', () => {
    const { s } = tracker()
    s.hook({ event: 'SessionStart', session_id: 'a', tool: 'claude-code' })
    s.hook({ event: 'SessionStart', session_id: 'b', tool: 'claude-code' })
    s.claimBand('a', A)
    expect(s.bandHolds('a', B)).toBe(false)
    expect(s.bandHolds('b', A)).toBe(false)
  })

  it('never lets a claim open a session', () => {
    const { s } = tracker()
    s.claimBand('ghost', A)
    expect(s.count()).toBe(0)
    expect(s.bandHolds('ghost', A)).toBe(false)
  })

  // The session comes back inside the freshness window, so only the delete on SessionEnd can make
  // this false.
  it('drops the claim with its session on SessionEnd, even if the session id comes back at once', () => {
    const { s } = tracker()
    s.hook({ event: 'SessionStart', session_id: 'a', tool: 'claude-code' })
    s.claimBand('a', A)
    s.hook({ event: 'SessionEnd', session_id: 'a', tool: 'claude-code' })
    s.hook({ event: 'SessionStart', session_id: 'a', tool: 'claude-code' })
    expect(s.bandHolds('a', A)).toBe(false)
  })

  // The claim is made after the session went stale and immediately before prune, so it is still
  // fresh when prune runs: only the delete in prune can make this false.
  it('forgets a claim when prune removes its session, even if the session id comes back at once', () => {
    const { s, advance } = tracker()
    s.hook({ event: 'SessionStart', session_id: 'a', tool: 'claude-code' })
    advance(3 * 3_600_000)
    s.claimBand('a', A)            // accepted: the session still exists, and lastSeenAt is 3 h old
    s.prune(2 * 3_600_000)          // removes 'a'; its claim must go with it
    s.hook({ event: 'SessionStart', session_id: 'a', tool: 'claude-code' })
    expect(s.bandHolds('a', A)).toBe(false)
  })
})
