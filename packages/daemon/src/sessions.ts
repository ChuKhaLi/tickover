import type { HookEvent } from './http.js'

export interface SessionInfo {
  startedAt: Date
  cwd: string | null
  toolVersion: string | null
  turnStartedAt: Date | null
  lastSeenAt: Date
}
export interface TurnEnd { sessionId: string; startedAt: Date; endedAt: Date }

/**
 * How long a session may go with no evidence of life at all before it is declared dead and
 * removed. Not a guess about how long a developer might think between prompts: `touch()` below is
 * called by the status line, which repaints every few seconds for as long as Claude Code is
 * rendering it, so an ordinary terminal session is never anywhere near this window. The window
 * only has to cover a session whose only evidence is hooks -- the Claude Code VS Code panel, where
 * Spike B found the status line is never executed -- and two hours is far longer than any single
 * turn there.
 *
 * Two hours rather than a day, because the alternative failure is the one the whole-branch review
 * found: a session that died without SessionEnd keeps the daemon alive, keeps telemetry leaving
 * the machine, and can have a paid question served to it. Over-pruning is cheap and self-healing
 * by comparison -- notify.mjs relaunches the daemon on the next SessionStart/UserPromptSubmit, and
 * the frequency history that enforces the gap, skip-pause and daily caps lives in sqlite, so no
 * rule is reset by a restart. The cost is one untracked turn on that relaunch, which is the same
 * cost the ordinary 30-minute idle exit already pays.
 */
export const SESSION_STALE_MS = 2 * 3_600_000

/**
 * How long a band claim keeps the question off that session's status line (R204): three of the
 * module's 2-second polls. A module that stops claiming -- it died, a survey took the band, the
 * terminal went too narrow -- gives the question back to the status line within this window.
 */
export const BAND_FRESH_MS = 6_000

export class SessionTracker {
  private map = new Map<string, SessionInfo>()
  private claims = new Map<string, { assignmentId: string; at: Date }>()
  constructor(private clock: () => Date, private onTurnEnd: (t: TurnEnd) => void) {}

  // Only a session-opening event (SessionStart, or UserPromptSubmit for a hook stream that never
  // sent SessionStart) may create a new entry. P1 (Task 5 review): a bare Stop for a session id
  // never seen before used to create a phantom session here too, taking count() from 0 to 1. That
  // stayed harmless as long as nothing read count() -- but Task 8's IdleWatch fires on
  // sessions.count() === 0, so one stray Stop would hold the daemon (and its heartbeating) alive
  // for up to prune()'s 6-hour staleness window, against the 30-minute idle-exit constraint. A
  // Stop (or any other non-opening event) for an unknown session is now a no-op instead.
  private ensure(id: string, e: HookEvent): SessionInfo | null {
    const now = this.clock()
    let s = this.map.get(id)
    if (!s) {
      if (e.event !== 'SessionStart' && e.event !== 'UserPromptSubmit') return null
      s = { startedAt: now, cwd: null, toolVersion: null, turnStartedAt: null, lastSeenAt: now }
      this.map.set(id, s)
    }
    s.lastSeenAt = now
    if (e.cwd) s.cwd = e.cwd
    if (e.tool_version) s.toolVersion = e.tool_version
    return s
  }

  hook(e: HookEvent): void {
    const now = this.clock()
    if (e.event === 'SessionEnd') {
      const s = this.map.get(e.session_id)
      if (s?.turnStartedAt) this.onTurnEnd({ sessionId: e.session_id, startedAt: s.turnStartedAt, endedAt: now })
      this.claims.delete(e.session_id)
      this.map.delete(e.session_id)
      return
    }
    const s = this.ensure(e.session_id, e)
    if (!s) return
    if (e.event === 'UserPromptSubmit') s.turnStartedAt = s.turnStartedAt ?? now
    if (e.event === 'Stop' && s.turnStartedAt) {
      this.onTurnEnd({ sessionId: e.session_id, startedAt: s.turnStartedAt, endedAt: now })
      s.turnStartedAt = null
    }
  }

  sessions(): Map<string, SessionInfo> { return this.map }
  count(): number { return this.map.size }

  // Called from the status line's GET /v1/status, which is the one surface that actually carries
  // the real Claude Code version (the hook payload notify.mjs sends does not) -- see Task 11.
  noteVersion(sessionId: string, version: string): void {
    const s = this.map.get(sessionId)
    if (s && version) s.toolVersion = version
  }

  /**
   * Records that a known session is still alive, without opening one. Called from GET /v1/status,
   * which the status line polls every few seconds for as long as Claude Code is rendering it --
   * far better evidence of life than hooks, which can be hours apart while a developer reads code.
   * This is what makes prune()'s window below safe to keep short.
   *
   * Never creates an entry, for the same reason `ensure()` refuses to (P1, Task 5 review): a poll
   * carrying an unknown or already-pruned session id must not resurrect it, or the daemon is held
   * open by a session nobody is in.
   */
  touch(sessionId: string): void {
    const s = this.map.get(sessionId)
    if (s) s.lastSeenAt = this.clock()
  }

  /** Records that this session's band drew `assignmentId`. Never opens a session (the P1 rule). */
  claimBand(sessionId: string, assignmentId: string): void {
    if (!this.map.has(sessionId)) return
    this.claims.set(sessionId, { assignmentId, at: this.clock() })
  }

  bandHolds(sessionId: string, assignmentId: string): boolean {
    const c = this.claims.get(sessionId)
    return c !== undefined && c.assignmentId === assignmentId && this.clock().getTime() - c.at.getTime() <= BAND_FRESH_MS
  }

  activeTurn(): { sessionId: string; sessionStartedAt: Date; turnStartedAt: Date } | null {
    let best: { sessionId: string; sessionStartedAt: Date; turnStartedAt: Date } | null = null
    for (const [id, s] of this.map) {
      if (!s.turnStartedAt) continue
      if (!best || s.turnStartedAt.getTime() < best.turnStartedAt.getTime()) best = { sessionId: id, sessionStartedAt: s.startedAt, turnStartedAt: s.turnStartedAt }
    }
    return best
  }

  cwds(): string[] {
    return Array.from(new Set(Array.from(this.map.values()).map((s) => s.cwd).filter((c): c is string => c !== null)))
  }

  toolVersion(): string | null {
    for (const s of this.map.values()) if (s.toolVersion) return s.toolVersion
    return null
  }

  /**
   * Drops every session with no evidence of life inside `staleMs`. Called from the daemon's tick,
   * before the idle check -- see the call site in daemon.ts. Until the whole-branch review this
   * had no production caller at all, which made a silently-dead session permanent.
   *
   * A session dropped mid-turn closes that turn on the way out, exactly as SessionEnd does. Turns
   * are the developer's activity record (the server tiers on how many they have in a week), and a
   * session that died without SessionEnd is precisely the case where the last turn is still open
   * -- so dropping it silently threw that turn away, which is the one thing pruning must not cost.
   *
   * The turn ends at `lastSeenAt`, not at the prune instant: the developer stopped existing to us
   * somewhere in that gap, and `lastSeenAt` is the last moment we have evidence for. Reporting the
   * prune instant would invent up to `staleMs` of work that may never have happened. Guarded so it
   * can never fall before `turnStartedAt` -- the wire requires `ended_at >= started_at`, and a
   * backwards wall-clock adjustment is the one way that could otherwise break.
   */
  prune(staleMs = SESSION_STALE_MS): void {
    const cutoff = this.clock().getTime() - staleMs
    for (const [id, s] of this.map) {
      if (s.lastSeenAt.getTime() >= cutoff) continue
      if (s.turnStartedAt) {
        const endedAt = new Date(Math.max(s.lastSeenAt.getTime(), s.turnStartedAt.getTime()))
        this.onTurnEnd({ sessionId: id, startedAt: s.turnStartedAt, endedAt })
      }
      this.claims.delete(id)
      this.map.delete(id)
    }
  }
}
