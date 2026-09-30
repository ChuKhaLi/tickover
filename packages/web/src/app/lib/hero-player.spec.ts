// The clock behind the hero. Its browser APIs are injected, so every rule the spec gives it --
// start only in view, freeze on a hidden tab, pause, replay, release on destroy -- runs here.
import { afterEach, describe, it, expect, vi } from 'vitest'
import { HeroPlayer, browserEnv, type HeroPlayerEnv } from './hero-player'

const DURATION = 10_000

function fakeEnv() {
  let now = 0
  let nextId = 1
  const frames = new Map<number, () => void>()
  let onView: ((inView: boolean) => void) | null = null
  let onTab: ((isHidden: boolean) => void) | null = null
  const released = { view: false, tab: false }
  const env: HeroPlayerEnv = {
    clock: {
      now: () => now,
      frame: (cb) => { const id = nextId++; frames.set(id, cb); return id },
      cancel: (id) => { frames.delete(id) },
    },
    watchInView: (_el, cb) => { onView = cb; return () => { released.view = true } },
    watchTab: (cb) => { onTab = cb; return () => { released.tab = true } },
  }
  return {
    env,
    released,
    /** Moves the clock, then runs whatever frames were queued, as a browser does once per frame. */
    advance(ms: number) {
      now += ms
      const due = [...frames.values()]
      frames.clear()
      due.forEach((cb) => cb())
    },
    enterView: () => onView!(true),
    hideTab: () => onTab!(true),
    showTab: () => onTab!(false),
    queued: () => frames.size,
  }
}

function setup() {
  const f = fakeEnv()
  const p = new HeroPlayer(DURATION, f.env)
  p.attach({} as Element)
  return { f, p }
}

describe('HeroPlayer', () => {
  it('does nothing until the pane is in view', () => {
    const { f, p } = setup()
    f.advance(1000)
    expect(p.state()).toBe('idle')
    expect(p.elapsed()).toBe(0)
    expect(f.queued()).toBe(0)
  })

  it('plays from zero once the pane is in view', () => {
    const { f, p } = setup()
    f.enterView()
    expect(p.state()).toBe('playing')
    f.advance(500)
    expect(p.elapsed()).toBe(500)
  })

  it('pause freezes elapsed, and play resumes from there', () => {
    const { f, p } = setup()
    f.enterView()
    f.advance(500)
    p.pause()
    expect(p.state()).toBe('paused')
    f.advance(1000)
    expect(p.elapsed()).toBe(500)
    expect(f.queued()).toBe(0)
    p.play()
    f.advance(100)
    expect(p.elapsed()).toBe(600)
  })

  it('a hidden tab freezes elapsed without changing the state', () => {
    const { f, p } = setup()
    f.enterView()
    f.advance(500)
    f.hideTab()
    f.advance(3000)
    expect(p.elapsed()).toBe(500)
    expect(p.state()).toBe('playing')
    f.showTab()
    f.advance(100)
    expect(p.elapsed()).toBe(600)
  })

  it('showing the tab does not resume a paused player', () => {
    const { f, p } = setup()
    f.enterView()
    f.advance(500)
    p.pause()
    f.hideTab()
    f.showTab()
    f.advance(1000)
    expect(p.state()).toBe('paused')
    expect(p.elapsed()).toBe(500)
    expect(f.queued()).toBe(0)
  })

  it('a tab hidden before the pane is in view starts only when the tab is shown', () => {
    const { f, p } = setup()
    f.hideTab()
    f.enterView()
    expect(p.state()).toBe('playing')
    expect(f.queued()).toBe(0)
    f.showTab()
    f.advance(200)
    expect(p.elapsed()).toBe(200)
  })

  it('ends exactly at the duration and stops asking for frames', () => {
    const { f, p } = setup()
    f.enterView()
    f.advance(DURATION + 400)
    expect(p.elapsed()).toBe(DURATION)
    expect(p.state()).toBe('ended')
    expect(f.queued()).toBe(0)
  })

  it('coming back into view after the end does not play it again', () => {
    const { f, p } = setup()
    f.enterView()
    f.advance(DURATION)
    f.enterView()
    expect(p.state()).toBe('ended')
  })

  it('replay starts again from zero', () => {
    const { f, p } = setup()
    f.enterView()
    f.advance(DURATION)
    p.replay()
    expect(p.state()).toBe('playing')
    expect(p.elapsed()).toBe(0)
    f.advance(300)
    expect(p.elapsed()).toBe(300)
  })

  it('stop ends it where it is, and an ended player ignores play', () => {
    const { f, p } = setup()
    f.enterView()
    f.advance(500)
    p.stop()
    expect(p.state()).toBe('ended')
    expect(f.queued()).toBe(0)
    p.play()
    expect(p.state()).toBe('ended')
  })

  it('destroy releases everything', () => {
    const { f, p } = setup()
    f.enterView()
    f.advance(100)
    p.destroy()
    expect(f.released).toEqual({ view: true, tab: true })
    expect(f.queued()).toBe(0)
  })
})

/**
 * The one adapter line that decides "half in view" (final review M1). `isIntersecting` is true for
 * any overlap at all, and crossing the 0.5 threshold on the way out still queues an entry -- so
 * trusting it alone lets a browser start the sequence with a sliver of the pane on screen. The
 * observer is stubbed rather than restructured around: this is the only place it is read.
 */
describe('browserEnv in view', () => {
  afterEach(() => vi.unstubAllGlobals())

  function observe() {
    let fire: ((entries: Array<{ isIntersecting: boolean; intersectionRatio: number }>) => void) | null = null
    vi.stubGlobal('IntersectionObserver', class {
      constructor(cb: typeof fire) { fire = cb }
      observe() {}
      disconnect() {}
    })
    const seen: boolean[] = []
    browserEnv().watchInView({} as Element, (v) => seen.push(v))
    return { seen, fire: (isIntersecting: boolean, intersectionRatio: number) => fire!([{ isIntersecting, intersectionRatio }]) }
  }

  it('counts half the pane on screen as in view', () => {
    const { seen, fire } = observe()
    fire(true, 0.5)
    fire(true, 1)
    expect(seen).toEqual([true, true])
  })

  it('does not count a sliver as in view, although the entry says it intersects', () => {
    const { seen, fire } = observe()
    fire(true, 0.1)
    fire(false, 0)
    expect(seen).toEqual([false, false])
  })
})
