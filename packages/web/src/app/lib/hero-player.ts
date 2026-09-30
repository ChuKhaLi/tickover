import { signal } from '@angular/core'

/**
 * The clock behind the landing hero (R384): elapsed time as a signal, advanced once per animation
 * frame while playing, and nothing else. What that time *shows* is `hero-timeline.ts`'s business.
 *
 * The browser APIs come in through `HeroPlayerEnv` so that every rule the spec gives the clock runs
 * under vitest, where `IntersectionObserver` and `requestAnimationFrame` do not exist. `browserEnv`
 * touches nothing until its functions are called, because the page builds it during the prerender.
 *
 * A hidden tab is tracked apart from `state`: the visitor did not pause anything, so the button
 * must not say they did. Browsers stop animation frames in a hidden tab anyway; what this adds is
 * re-basing the clock on return, so the sequence resumes where it was instead of leaping ahead by
 * however long the tab was away.
 */
export type PlayerState = 'idle' | 'playing' | 'paused' | 'ended'

export interface HeroPlayerEnv {
  clock: { now(): number; frame(cb: () => void): number; cancel(id: number): void }
  /** Calls back with true when at least half of `el` is on screen. Returns a disconnect. */
  watchInView(el: Element, cb: (inView: boolean) => void): () => void
  /** Calls back when the tab is put away or brought back. Returns a disconnect. */
  watchTab(cb: (isHidden: boolean) => void): () => void
}

export function browserEnv(): HeroPlayerEnv {
  return {
    clock: {
      now: () => performance.now(),
      frame: (cb) => requestAnimationFrame(() => cb()),
      cancel: (id) => cancelAnimationFrame(id),
    },
    watchInView(el, cb) {
      // isIntersecting alone is true for any overlap, and a crossing of the threshold on the way
      // out still queues an entry, so the ratio is what says "half" (final review M1).
      const io = new IntersectionObserver(
        (entries) => cb(entries.some((e) => e.isIntersecting && e.intersectionRatio >= 0.5)),
        { threshold: 0.5 },
      )
      io.observe(el)
      return () => io.disconnect()
    },
    watchTab(cb) {
      const on = () => cb(document.hidden)
      document.addEventListener('visibilitychange', on)
      return () => document.removeEventListener('visibilitychange', on)
    },
  }
}

export class HeroPlayer {
  readonly elapsed = signal(0)
  readonly state = signal<PlayerState>('idle')
  private base = 0
  private pending: number | null = null
  private tabAway = false
  private releases: Array<() => void> = []

  constructor(
    private readonly duration: number,
    private readonly env: HeroPlayerEnv,
  ) {}

  attach(el: Element): void {
    this.releases.push(
      this.env.watchInView(el, (inView) => {
        if (inView && this.state() === 'idle') this.play()
      }),
      this.env.watchTab((isHidden) => {
        this.tabAway = isHidden
        if (isHidden) this.halt()
        else if (this.state() === 'playing') this.run()
      }),
    )
  }

  play(): void {
    const s = this.state()
    if (s === 'playing' || s === 'ended') return
    this.state.set('playing')
    if (!this.tabAway) this.run()
  }

  pause(): void {
    if (this.state() !== 'playing') return
    this.halt()
    this.state.set('paused')
  }

  replay(): void {
    this.halt()
    this.elapsed.set(0)
    this.state.set('idle')
    this.play()
  }

  stop(): void {
    this.halt()
    this.state.set('ended')
  }

  destroy(): void {
    this.halt()
    this.releases.forEach((release) => release())
    this.releases = []
  }

  private run(): void {
    this.halt()
    this.base = this.env.clock.now() - this.elapsed()
    this.tick()
  }

  private tick = (): void => {
    this.pending = null
    const e = this.env.clock.now() - this.base
    if (e >= this.duration) {
      this.elapsed.set(this.duration)
      this.state.set('ended')
      return
    }
    this.elapsed.set(e)
    this.pending = this.env.clock.frame(this.tick)
  }

  private halt(): void {
    if (this.pending !== null) this.env.clock.cancel(this.pending)
    this.pending = null
  }
}
