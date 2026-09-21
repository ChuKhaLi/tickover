import { existsSync, readdirSync } from 'node:fs'
import { join, extname } from 'node:path'
import { MAX_EXTENSION_KEYS, TELEMETRY_EXTENSIONS } from '@tickover/contract'
import type { ServerClient } from './server-client.js'
import type { SessionTracker } from './sessions.js'
import type { State } from './state.js'
import type { QuestionLoop } from './question-loop.js'
import type { Log } from './log.js'
import { backoffMs } from './answer-queue.js'

/**
 * The heartbeat's own retry ceiling, and it is the same number the money queue uses
 * today. **Naming it is the whole change (P7).**
 *
 * `backoffMs(attempts)` inherited `MAX_BACKOFF_MS` from `answer-queue.ts`, so retuning
 * the ceiling for *answers* -- which carry money and have their own reasons to move --
 * would silently have retuned telemetry's with it. `question-loop.ts` drew this line
 * for its own poll two rounds ago (`NEXT_POLL_MAX_BACKOFF_MS`); this is the third
 * caller finally doing the same.
 *
 * The value does not change and neither does the reason for it, which is in `tick()`:
 * nobody is waiting on a heartbeat.
 */
export const HEARTBEAT_MAX_BACKOFF_MS = 15 * 60_000

export const SKIP_DIRS = ['node_modules', '.git', 'dist', 'build', 'out', 'target', 'vendor', '.next', 'coverage']

/** HeartbeatRequest.os only ever accepts these three values; anything else (a BSD, aix, etc.)
 * is conservatively reported as 'linux' rather than sent unvalidated or dropped from the beat. */
function toOsName(platform: string): 'win32' | 'darwin' | 'linux' {
  return platform === 'win32' || platform === 'darwin' || platform === 'linux' ? platform : 'linux'
}

/**
 * Narrows merged extension counts to exactly what may go on the wire: allowlisted keys only, no
 * empty counts, and at most MAX_EXTENSION_KEYS of them, keeping the largest. Applied after the
 * per-cwd counts are merged, so a caller can't widen the key space between the walk and the
 * request body. Ties break on the key so the same directory always produces the same body.
 */
export function boundExtensionCounts(counts: Record<string, number>): Record<string, number> {
  return Object.fromEntries(
    Object.entries(counts)
      .filter(([ext, n]) => TELEMETRY_EXTENSIONS.has(ext) && Number.isFinite(n) && n > 0)
      .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
      .slice(0, MAX_EXTENSION_KEYS),
  )
}

/**
 * A bounded breadth-first filesystem walk that counts files by lowercase extension (without the
 * dot). Never returns or logs a path -- only the aggregate counts leave this function -- because
 * its result is exactly what Heartbeat puts on the wire (Global Constraint: no cwd, no paths, no
 * repo names ever leave the machine). Bounded by both an entry cap and a wall-clock budget so a
 * huge or slow (network-mounted) working directory can't block a heartbeat tick indefinitely.
 *
 * The extension itself is bounded too, against TELEMETRY_EXTENSIONS (whole-branch review C1).
 * `path.extname` returns everything after the LAST dot -- it is not a language-suffix lookup --
 * so `Dockerfile.acme-internal-prod` yields `acme-internal-prod` and `deploy.northwind` yields
 * `northwind`. Both are filenames a developer writes without a thought, and both would have put
 * a customer's name on the wire under a consent screen that promises file-extension counts. A
 * shape check ("short, lowercase, alphanumeric") does not close that: `northwind` passes it.
 * Only naming the permitted values does, so an unrecognised tail is counted as nothing at all.
 */
export function countExtensions(dir: string, opts: { maxEntries?: number; budgetMs?: number; skipDirs?: string[] } = {}): Record<string, number> {
  const maxEntries = opts.maxEntries ?? 5000
  const deadline = Date.now() + (opts.budgetMs ?? 2000)
  const skip = new Set(opts.skipDirs ?? SKIP_DIRS)
  const counts: Record<string, number> = {}
  if (!existsSync(dir)) return counts
  const queue = [dir]
  let seen = 0
  while (queue.length && seen < maxEntries && Date.now() < deadline) {
    const current = queue.shift()!
    let entries
    try {
      entries = readdirSync(current, { withFileTypes: true })
    } catch {
      // A directory that vanishes or is unreadable mid-walk (permissions, a race with the build
      // tool that owns it) must not abort the whole count -- just skip it.
      continue
    }
    for (const e of entries) {
      seen += 1
      if (seen > maxEntries) return counts
      if (e.isDirectory()) {
        if (!skip.has(e.name)) queue.push(join(current, e.name))
        continue
      }
      if (!e.isFile()) continue
      const ext = extname(e.name).slice(1).toLowerCase()
      if (TELEMETRY_EXTENSIONS.has(ext)) counts[ext] = (counts[ext] ?? 0) + 1
    }
  }
  return counts
}

export interface HeartbeatDeps {
  server: ServerClient
  sessions: SessionTracker
  state: State
  loop: QuestionLoop
  clock: () => Date
  log: Log
  loggedIn: () => boolean
  intervalMs?: number
}

/**
 * Reports activity to the server at most every `intervalMs` while at least one session is open
 * and the developer is logged in. The only outbound telemetry in the daemon: OS, tool version,
 * extension counts merged across every open session's cwd (never the cwd itself), and unsent
 * turn timestamps. Feeds the server's response into QuestionLoop.setSelf so balances stay fresh
 * (a stale locally-cached today_paid_answers is what blocked paid questions after a restart, per
 * Task 7's review; a heartbeat response is the only repair path for that).
 */
export class Heartbeat {
  private lastSentAt: Date | null = null
  private force = false
  private intervalMs: number
  // Backoff state for a failing heartbeat request, independent of the success-interval gate
  // above (round1 review, finding1). Without this, a failure never advances `lastSentAt`, so the
  // very next tick's gate check (`now - lastSentAt < intervalMs`) sees an ever-growing elapsed
  // time against a fixed old timestamp and lets the retry straight through -- in production, a
  // request every tickIntervalMs (2s) for as long as a session stays open, from every daemon.
  // This is the identical shape of bug Task 7 fixed for QuestionLoop's next() polling (I2); fixed
  // here the same way, reusing AnswerQueue's own doubling schedule.
  private failAttempts = 0
  private nextAttemptAt: Date | null = null
  constructor(private d: HeartbeatDeps) {
    this.intervalMs = d.intervalMs ?? 5 * 60_000
  }

  /** Makes the next tick() send immediately, ignoring the interval gate (once). Never bypasses
   * an active failure backoff below -- a new session starting is not a reason to hammer a server
   * that's already failing. */
  forceNext(): void {
    this.force = true
  }

  async tick(): Promise<void> {
    const now = this.d.clock()
    if (!this.d.loggedIn() || this.d.sessions.count() === 0) return
    if (this.nextAttemptAt && now.getTime() < this.nextAttemptAt.getTime()) return
    if (!this.force && this.lastSentAt && now.getTime() - this.lastSentAt.getTime() < this.intervalMs) return
    this.force = false
    const counts: Record<string, number> = {}
    for (const cwd of this.d.sessions.cwds()) {
      for (const [ext, n] of Object.entries(countExtensions(cwd))) counts[ext] = (counts[ext] ?? 0) + n
    }
    const turns = this.d.state.unsentTurns()
    try {
      const self = await this.d.server.heartbeat({
        os: toOsName(process.platform),
        tool: 'claude-code',
        tool_version: this.d.sessions.toolVersion() ?? 'unknown',
        extension_counts: boundExtensionCounts(counts),
        turns: turns.map((t) => ({ started_at: t.startedAt, ended_at: t.endedAt })),
      })
      // Mark sent (and adopt the server's balances) only once the request has actually landed --
      // a throw below must leave these turns eligible to go out on the next successful tick.
      this.d.state.markTurnsSent(turns.map((t) => t.id))
      this.d.loop.setSelf(self)
      this.lastSentAt = now
      this.failAttempts = 0
      this.nextAttemptAt = null
    } catch (err) {
      // A failed heartbeat must not crash the daemon's interval loop or the tests driving tick()
      // directly -- log and back off before the next attempt (still gated further by the normal
      // interval too, since lastSentAt/force were never advanced on a failure). The ceiling is
      // 15 minutes and stays 15 minutes: unlike a served question or an already-given answer,
      // nobody is waiting on a heartbeat, so there is no urgency pushing it down the way there
      // was for QuestionLoop's next() poll. It is passed explicitly now rather than inherited
      // from the money queue's default -- see HEARTBEAT_MAX_BACKOFF_MS.
      this.d.log.error('heartbeat failed', { message: (err as Error).message })
      this.nextAttemptAt = new Date(now.getTime() + backoffMs(this.failAttempts, HEARTBEAT_MAX_BACKOFF_MS))
      this.failAttempts += 1
    }
  }
}
