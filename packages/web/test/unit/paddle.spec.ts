import { describe, it, expect, vi } from 'vitest'
import { PADDLE_SCRIPT, type PaddleLike } from '../../src/app/lib/paddle'

/**
 * `loadPaddle` caches its promise in module scope, which is right in a browser —
 * one script per document — and leaks between tests. Every test therefore takes a
 * fresh copy of the module rather than sharing one cache; without this the second
 * test in this file is answered by the first test's resolved Paddle.
 */
async function fresh() {
  vi.resetModules()
  return await import('../../src/app/lib/paddle')
}

type Mode =
  | 'ok'
  /** The CDN answers with an error: `onerror` fires. */
  | 'error'
  /** A blocker or a filter drops the request: neither event ever fires. */
  | 'silent'
  /** The script loads and registers nothing on the window. */
  | 'empty'

function fakeEnv(mode: Mode = 'ok') {
  const calls: string[] = []
  const opens: Array<Parameters<PaddleLike['Checkout']['open']>[0]> = []
  // Kept, not just invoked: Paddle holds the callback it was initialized with and
  // fires events through it much later. A fake that only calls it during
  // `Initialize` can never show which caller a *later* event reaches, which is
  // how a discarded callback stayed invisible.
  let emit: ((e: { name: string }) => void) | undefined
  const paddle: PaddleLike = {
    Environment: { set: (e) => calls.push(`env:${e}`) },
    Initialize: (o) => { calls.push(`init:${o.token}`); emit = o.eventCallback; o.eventCallback?.({ name: 'checkout.completed' }) },
    Checkout: { open: (o) => { opens.push(o); calls.push(`open:${o.items[0]!.priceId}:${o.customData['buyer_id']}:${o.settings?.displayMode}`) } },
  }
  type FakeScript = { src?: string; async?: boolean; onload: null | (() => void); onerror: null | (() => void) }
  const scripts: FakeScript[] = []
  const win = { } as Window & { Paddle?: PaddleLike }
  const doc = {
    querySelector: () => null,
    createElement: () => { const s: FakeScript = { onload: null, onerror: null }; scripts.push(s); return s as unknown as HTMLScriptElement },
    head: { appendChild: (s: HTMLScriptElement) => {
      const script = s as unknown as FakeScript
      if (mode === 'silent') return
      if (mode === 'error') { queueMicrotask(() => script.onerror!()); return }
      if (mode === 'ok') win.Paddle = paddle
      queueMicrotask(() => script.onload!())
    } },
  } as unknown as Document
  return {
    calls, opens, scripts, win, doc, paddle,
    /** What Paddle does long after `Initialize`, through the callback it kept. */
    fire: (name: string) => {
      if (!emit) throw new Error('Paddle was never initialized, so it has nothing to fire through')
      emit({ name })
    },
  }
}

describe('paddle', () => {
  // The brief's test, with three assertions added: which script is injected, that
  // it is injected asynchronously, and the whole object the checkout is opened
  // with. The brief collected the script elements and never looked at them, and
  // an `open:` string cannot show that the buyer's email or the quantity reached
  // Paddle — that object is what the payment provider actually receives.
  it('injects the script once, sets the environment, initializes, forwards events, and opens the overlay', async () => {
    const { loadPaddle, openCheckout } = await fresh()
    const f = fakeEnv()
    const events: string[] = []
    const p = await loadPaddle(f.doc, f.win, { token: 'test_tok', environment: 'sandbox', onEvent: (n) => events.push(n) })
    expect(f.calls).toEqual(['env:sandbox', 'init:test_tok'])
    expect(events).toEqual(['checkout.completed'])
    expect(f.scripts).toHaveLength(1)
    expect(f.scripts[0]).toMatchObject({ src: PADDLE_SCRIPT, async: true })

    openCheckout(p, { priceId: 'pri_small', buyerId: 'b1', email: 'pm@acme.test' })
    expect(f.calls.at(-1)).toBe('open:pri_small:b1:overlay')
    expect(f.opens).toEqual([{
      items: [{ priceId: 'pri_small', quantity: 1 }],
      customData: { buyer_id: 'b1' },
      customer: { email: 'pm@acme.test' },
      settings: { displayMode: 'overlay' },
    }])

    const again = await loadPaddle(f.doc, f.win, { token: 'test_tok', environment: 'sandbox', onEvent: () => {} })
    expect(again).toBe(p)
    expect(f.calls).toHaveLength(3)
    expect(f.scripts, 'a second script tag went into the document').toHaveLength(1)
  })

  // C1. `Initialize` runs once and keeps the callback it was given, so the first
  // caller would own every event for the life of the document — and a component
  // is destroyed and recreated on every navigation into its route. The test that
  // missed this called `loadPaddle` twice and never fired an event afterwards,
  // which is the only moment the discarded callback is observable.
  it('hands events to the caller that asked most recently, not the first one', async () => {
    const { loadPaddle } = await fresh()
    const f = fakeEnv()
    const first: string[] = []
    const second: string[] = []
    await loadPaddle(f.doc, f.win, { token: 't', environment: 'sandbox', onEvent: (n) => first.push(n) })
    await loadPaddle(f.doc, f.win, { token: 't', environment: 'sandbox', onEvent: (n) => second.push(n) })

    f.fire('checkout.closed')
    expect(second, 'the event went to a caller that is no longer on screen').toEqual(['checkout.closed'])
    // The first caller keeps only what it heard while it was the current one:
    // `Initialize` fires a completed event during the first load.
    expect(first).toEqual(['checkout.completed'])
    // And still one script, one Initialize.
    expect(f.calls).toEqual(['env:sandbox', 'init:t'])
  })

  // The other end of the same thing: a page that goes away hands the events back,
  // so a destroyed component is not left as the standing recipient for the life of
  // the document. Releasing is ownership-checked, or the teardown of a superseded
  // page would silence the page that replaced it — C1 again, by another route.
  it('releases the events only for the caller that still owns them', async () => {
    const { loadPaddle, releasePaddleListener } = await fresh()
    const f = fakeEnv()
    const first: string[] = []
    const second: string[] = []
    const a = (n: string) => first.push(n)
    const b = (n: string) => second.push(n)
    await loadPaddle(f.doc, f.win, { token: 't', environment: 'sandbox', onEvent: a })
    await loadPaddle(f.doc, f.win, { token: 't', environment: 'sandbox', onEvent: b })

    // A stale release from the caller that has already been superseded.
    releasePaddleListener(a)
    f.fire('checkout.closed')
    expect(second, 'a superseded caller silenced the one that replaced it').toEqual(['checkout.closed'])

    // And the owner's own release does stop delivery.
    releasePaddleListener(b)
    f.fire('checkout.error')
    expect(second).toEqual(['checkout.closed'])
  })

  it('sets the production environment when that is what is configured', async () => {
    const { loadPaddle } = await fresh()
    const f = fakeEnv()
    await loadPaddle(f.doc, f.win, { token: 'live_tok', environment: 'production', onEvent: () => {} })
    expect(f.calls).toEqual(['env:production', 'init:live_tok'])
  })

  // The CDN can answer with an error, and the page has to hear about it: a
  // rejected load is what puts a message on screen instead of a dead button.
  it('rejects when the script fails, and lets the next attempt try again', async () => {
    const { loadPaddle } = await fresh()
    const bad = fakeEnv('error')
    await expect(loadPaddle(bad.doc, bad.win, { token: 't', environment: 'sandbox', onEvent: () => {} })).rejects.toThrow(/failed to load/)

    // The cache was cleared, so a retry genuinely retries rather than handing
    // back the same rejection for the life of the page.
    const good = fakeEnv()
    const p = await loadPaddle(good.doc, good.win, { token: 't', environment: 'sandbox', onEvent: () => {} })
    expect(p).toBe(good.paddle)
    expect(good.scripts).toHaveLength(1)
  })

  // The blocked case, and the one the brief has no answer for: an extension can
  // drop the request so that *neither* event fires. Without a deadline the promise
  // never settles, `busy` never clears, and the buyer is left with a disabled
  // button and nothing on screen.
  it('rejects rather than hanging when nothing at all comes back', async () => {
    const { loadPaddle } = await fresh()
    const f = fakeEnv('silent')
    // Raced against a sentinel rather than awaited: a promise that never settles
    // would otherwise fail this as a five-second test timeout, and "the test timed
    // out" does not distinguish a hang from a component that threw.
    const outcome = await Promise.race([
      loadPaddle(f.doc, f.win, { token: 't', environment: 'sandbox', onEvent: () => {}, timeoutMs: 5 }).then(() => 'resolved', (e: Error) => `rejected: ${e.message}`),
      new Promise((ok) => setTimeout(() => ok('still waiting'), 200)),
    ])
    expect(outcome).toBe('rejected: Paddle did not load in time')
    expect(f.calls, 'a script that never loaded was initialized anyway').toEqual([])
  })

  // Raced for the same reason as the test above: without the guard the load
  // throws inside a microtask rather than rejecting, so a plain `rejects` would
  // report a five-second timeout instead of naming what happened.
  it('rejects when the script loads but registers nothing', async () => {
    const { loadPaddle } = await fresh()
    const f = fakeEnv('empty')
    const outcome = await Promise.race([
      loadPaddle(f.doc, f.win, { token: 't', environment: 'sandbox', onEvent: () => {} }).then(() => 'resolved', (e: Error) => `rejected: ${e.message}`),
      new Promise((ok) => setTimeout(() => ok('still waiting'), 200)),
    ])
    expect(outcome).toBe('rejected: Paddle loaded but registered nothing')
  })

  // A second component mounting on a page that already has the tag must wait for
  // it rather than append another copy of Paddle.js.
  it('waits for a script tag that is already in the document', async () => {
    const { loadPaddle } = await fresh()
    const listeners: Record<string, Array<() => void>> = {}
    const selectors: string[] = []
    const created: string[] = []
    const calls: string[] = []
    const paddle: PaddleLike = {
      Environment: { set: (e) => calls.push(`env:${e}`) },
      Initialize: (o) => calls.push(`init:${o.token}`),
      Checkout: { open: () => {} },
    }
    const win = { } as Window & { Paddle?: PaddleLike }
    const tag = { addEventListener: (n: string, fn: () => void) => { (listeners[n] ??= []).push(fn) } } as unknown as Element
    const doc = {
      querySelector: (s: string) => { selectors.push(s); return tag },
      createElement: () => { created.push('created'); return { } as HTMLScriptElement },
      head: { appendChild: () => created.push('appended') },
    } as unknown as Document

    const pending = loadPaddle(doc, win, { token: 't', environment: 'sandbox', onEvent: () => {} })
    expect(selectors[0]).toContain(PADDLE_SCRIPT)
    expect(created, 'a second copy of Paddle.js was appended').toEqual([])
    win.Paddle = paddle
    for (const fn of listeners['load'] ?? []) fn()
    expect(await pending).toBe(paddle)
    expect(calls).toEqual(['env:sandbox', 'init:t'])
  })

  // Both variables are unset in this repo, and the page hangs its "cannot take
  // payment" state on the empty token, so the default is behaviour rather than
  // trivia. A bad `VITE_PADDLE_ENV` resolves to the sandbox: an environment this
  // cannot read is not one where real cards may be charged.
  it('reads the configuration out of the environment, defaulting to no token and the sandbox', async () => {
    const { readPaddleConfig } = await fresh()
    expect(readPaddleConfig({})).toEqual({ token: '', environment: 'sandbox' })
    expect(readPaddleConfig({ VITE_PADDLE_TOKEN: 'live_x', VITE_PADDLE_ENV: 'production' })).toEqual({ token: 'live_x', environment: 'production' })
    expect(readPaddleConfig({ VITE_PADDLE_TOKEN: 'test_x', VITE_PADDLE_ENV: 'Production' })).toEqual({ token: 'test_x', environment: 'sandbox' })
  })
})
