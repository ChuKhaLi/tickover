import type { SessionTracker } from './sessions.js'

/**
 * Fires `onIdle` exactly once after `sessions.count()` has been 0 continuously for `idleMs`.
 * Any tick that observes a session resets the idle clock. Deliberately latches after firing
 * (`fired`) rather than firing on every tick past the threshold -- the daemon's own idle exit
 * only wants a single stop()+process.exit() call, not one per tick.
 */
export class IdleWatch {
  private idleSince: Date | null = null
  private fired = false
  constructor(private sessions: SessionTracker, private clock: () => Date, private idleMs: number, private onIdle: () => void) {}

  tick(): void {
    if (this.idleMs <= 0 || this.fired) return
    const now = this.clock()
    if (this.sessions.count() > 0) {
      this.idleSince = null
      return
    }
    this.idleSince ??= now
    if (now.getTime() - this.idleSince.getTime() >= this.idleMs) {
      this.fired = true
      this.onIdle()
    }
  }
}
