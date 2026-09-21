import { TestBed, type ComponentFixture } from '@angular/core/testing'
import { provideHttpClient } from '@angular/common/http'
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing'
import { provideRouter } from '@angular/router'
import { describe, it, expect } from 'vitest'
import CreditsPage, { POLL_ATTEMPTS, POLL_INTERVAL_MS, routeMeta } from './credits.page'
import { AuthState, buyerGuard } from '../../lib/auth'
import { SITE_NAME } from '../../lib/page-meta'
import { loadPaddle, type PaddleLike } from '../../lib/paddle'

const BUYER = { id: '8f0b0f2e-6f6a-4a3a-9c1f-0f1e2d3c4b5a', email: 'pm@acme.test', org: null, credit_cents: 0, first_study_used: false }
const PACKS = [{ price_id: 'pri_small', cents: 5000 }, { price_id: 'pri_large', cents: 20000 }]

/** One macrotask drains every pending microtask; `whenStable()` alone does not. */
async function settle(fixture: ComponentFixture<unknown>) {
  await fixture.whenStable()
  await new Promise((ok) => setTimeout(ok, 0))
  fixture.detectChanges()
}

/** Lets a promise chain run without touching change detection. */
const drain = () => new Promise((ok) => setTimeout(ok, 0))

/** Collapses the whitespace an inline template leaves between elements. */
const squish = (s: string) => s.replace(/\s+/g, ' ').trim()

interface Opened { priceId: string; buyerId: string; email: string; quantity: number }

/**
 * One Paddle "document" for the whole file, used by the tests that drive the
 * page's **own** loader rather than replacing it. It has to be shared:
 * `loadPaddle` caches per module load, so a second session's `Initialize` would
 * never run and its `emit` would stay undefined. One document across several
 * visits is also what a single-page app actually has.
 */
function paddleSession() {
  let emit: ((e: { name: string }) => void) | undefined
  const paddle: PaddleLike = {
    // Kept rather than invoked: this is what Paddle does, and a fake that only
    // fires during `Initialize` is what hid the discarded callback.
    Environment: { set() {} },
    Initialize: (o) => { emit = o.eventCallback },
    Checkout: { open() {} },
  }
  const win = { } as Window & { Paddle?: PaddleLike }
  const doc = {
    querySelector: () => null,
    createElement: () => ({ onload: null, onerror: null }) as unknown as HTMLScriptElement,
    head: { appendChild: (s: HTMLScriptElement) => { win.Paddle = paddle; queueMicrotask(() => (s as unknown as { onload: () => void }).onload()) } },
  } as unknown as Document
  return {
    /** The page's default loader expression, with only the document replaced. */
    shipped: (page: CreditsPage) => (onEvent: (name: string) => void) => loadPaddle(doc, win, { ...page.config, onEvent }),
    fire: (name: string) => {
      if (!emit) throw new Error('Paddle was never initialized, so it has nothing to fire through')
      emit({ name })
    },
  }
}
const SESSION = paddleSession()

/**
 * Renders the page with a fake Paddle and a fake clock. Neither is optional: the
 * real loader fetches a script from a CDN, and the real clock would make the
 * give-up path a sixty-second test.
 */
async function mount(over: { buyer?: Partial<typeof BUYER>; packs?: unknown[] | { status: number }; token?: string } = {}) {
  TestBed.resetTestingModule()
  TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])] })
  const auth = TestBed.inject(AuthState)
  auth.buyer.set({ ...BUYER, ...over.buyer })
  const fixture = TestBed.createComponent(CreditsPage)
  const page = fixture.componentInstance

  const opened: Opened[] = []
  const waits: number[] = []
  let onEvent: ((name: string) => void) | null = null
  page.config = { token: over.token ?? 'test_tok', environment: 'sandbox' }
  page.loader = async (fn) => {
    onEvent = fn
    return {
      Environment: { set() {} },
      Initialize() {},
      Checkout: { open: (o) => { opened.push({ priceId: o.items[0]!.priceId, buyerId: o.customData['buyer_id']!, email: o.customer?.email ?? '', quantity: o.items[0]!.quantity }) } },
    }
  }
  page.wait = async (ms) => { waits.push(ms) }

  fixture.detectChanges()
  const http = TestBed.inject(HttpTestingController)
  const packs = over.packs ?? PACKS
  const req = http.expectOne('/api/buyer/credits/packs')
  if (Array.isArray(packs)) req.flush(packs)
  else req.flush({ error: 'internal' }, { status: packs.status, statusText: 'Server Error' })
  await settle(fixture)

  const el = fixture.nativeElement as HTMLElement
  return {
    fixture, page, el, http, auth, opened, waits,
    text: () => squish(el.textContent ?? ''),
    buttons: () => Array.from(el.querySelectorAll('button[data-pack]')) as HTMLButtonElement[],
    /** What Paddle does when a payment goes through. Throws if no checkout was opened. */
    fire: (name: string) => {
      if (!onEvent) throw new Error('no checkout was opened, so Paddle had nothing to call')
      onEvent(name)
    },
  }
}

describe('CreditsPage', () => {
  // The brief's test, with `settle` in place of a bare `whenStable()` and with the
  // whole checkout object asserted rather than two of its fields. What Paddle is
  // handed is what the buyer is charged against, so the email and the quantity
  // matter as much as the price id.
  it('lists packs and opens checkout with the buyer id', async () => {
    const { fixture, el, opened, buttons } = await mount()
    expect(buttons()).toHaveLength(2)
    expect(el.querySelectorAll('button[data-pack]')[1]!.textContent).toContain('$200.00')

    buttons()[0]!.click()
    await settle(fixture)
    expect(opened).toEqual([{ priceId: 'pri_small', buyerId: BUYER.id, email: 'pm@acme.test', quantity: 1 }])
  })

  // R49, and the ruling carried out of Task 5: a price in copy is a function of
  // the configuration in front of the buyer, never a constant. The brief printed
  // `p.cents / 100` responses "at $1.00" — a literal price, and the wrong one for
  // the buyer most likely to be reading it, since a first study runs at cost.
  //
  // Then the first fix was itself incomplete, which is why both configurations
  // are pinned here: a response has *two* prices, and targeting is available on a
  // first study too (`buyer.controller.ts` quotes `{ targeted, atCost }`). A flat
  // 55c overstated a targeted first study by 45% — 90 responses against the real
  // 62. Every number below is typed here and computed there, so a `PRICING` move
  // in `packages/contract` turns this red with no web file touched.
  it('prices a pack at every configuration it could be spent in', async () => {
    const first = await mount({ buyer: { first_study_used: false } })
    // At cost: 55c untargeted, 80c targeted. 5000 and 20000 cents, whole
    // responses only.
    expect(first.text()).toContain('90 responses untargeted, at $0.55 each')
    expect(first.text()).toContain('62 responses targeted, at $0.80 each')
    expect(first.text()).toContain('363 responses untargeted, at $0.55 each')
    expect(first.text()).toContain('250 responses targeted, at $0.80 each')
    // And the prices that apply once the entitlement is spent, said out loud
    // rather than left for the buyer to discover in the wizard.
    expect(first.text()).toContain('After it a response is $1.00 untargeted and $1.50 targeted')

    const later = await mount({ buyer: { first_study_used: true } })
    expect(later.text()).toContain('50 responses untargeted, at $1.00 each')
    expect(later.text()).toContain('33 responses targeted, at $1.50 each')
    expect(later.text()).toContain('200 responses untargeted, at $1.00 each')
    expect(later.text()).toContain('133 responses targeted, at $1.50 each')
    expect(later.text(), 'an at-cost price was quoted to a buyer who has spent that entitlement').not.toContain('$0.55')
    expect(later.text()).not.toContain('$0.80')
  })

  it('shows the balance the server reported, and says what credits are for', async () => {
    const { text } = await mount({ buyer: { credit_cents: 1234 } })
    expect(text()).toContain('Balance: $12.34')
    expect(text(), 'integer cents reached the page raw').not.toContain('1234')
    expect(text()).toContain('held when you submit a study')
    expect(text()).toContain('refunded for invalid responses')
  })

  // The heart of this page. A completed checkout in the browser is not credit:
  // the webhook credits the account, server to server, and until a balance read
  // back from /api/buyer/me has risen the page may say the payment went through
  // and nothing more.
  it('says the payment arrived and nothing more until the balance has risen', async () => {
    const { fixture, http, buttons, fire, waits, text } = await mount()
    buttons()[0]!.click()
    await settle(fixture)

    fire('checkout.completed')
    await settle(fixture)
    expect(text()).toContain('Payment received')
    expect(text(), 'credit was claimed before the server had shown any').not.toContain('Credits added')

    // Still nothing while the balance comes back unchanged.
    await drain()
    http.expectOne('/api/buyer/me').flush({ ...BUYER, credit_cents: 0 })
    await settle(fixture)
    expect(text()).not.toContain('Credits added')

    await drain()
    http.expectOne('/api/buyer/me').flush({ ...BUYER, credit_cents: 5000 })
    await settle(fixture)
    expect(text()).toContain('Credits added')
    expect(text(), 'the balance is not the one the server just sent').toContain('Balance: $50.00')
    expect(waits).toEqual([POLL_INTERVAL_MS, POLL_INTERVAL_MS])
  })

  // The other order, and the reason the baseline is read when the overlay opens
  // rather than when the payment completes: the webhook is a server-to-server
  // call and does not wait for the browser. If anything refreshes the buyer in
  // between — a guard, the layout — a baseline taken at event time already
  // includes the credit, so the balance never appears to rise and the page spends
  // its whole minute before reporting that the money did not arrive.
  it('credits the purchase even when the webhook lands before the browser hears about it', async () => {
    const { fixture, http, auth, buttons, fire, text } = await mount()
    buttons()[0]!.click()
    await settle(fixture)

    auth.buyer.set({ ...BUYER, credit_cents: 5000 })
    fire('checkout.completed')
    await drain()
    http.expectOne('/api/buyer/me').flush({ ...BUYER, credit_cents: 5000 })
    await settle(fixture)
    expect(text()).toContain('Credits added')
  })

  // The webhook can be late or never arrive, and the honest thing to say then is
  // that the money has not shown up yet — not "Credits added", and not silence.
  it('does not claim credits were added when they never arrive', async () => {
    const { fixture, http, buttons, fire, waits, text } = await mount()
    buttons()[0]!.click()
    await settle(fixture)
    fire('checkout.completed')

    for (let i = 0; i < POLL_ATTEMPTS; i++) {
      await drain()
      http.expectOne('/api/buyer/me').flush({ ...BUYER, credit_cents: 0 })
    }
    await settle(fixture)

    expect(waits).toHaveLength(POLL_ATTEMPTS)
    expect(text()).not.toContain('Credits added')
    expect(text()).toContain('have not arrived yet')
    // And it stops there rather than asking for ever.
    http.verify()
  })

  // A 500 on the balance check is not an answer about the money, so it must not
  // end the poll — the webhook is still coming either way.
  it('keeps asking when a balance check fails', async () => {
    const { fixture, http, buttons, fire, text } = await mount()
    buttons()[0]!.click()
    await settle(fixture)
    fire('checkout.completed')

    await drain()
    http.expectOne('/api/buyer/me').flush({ error: 'internal' }, { status: 500, statusText: 'Server Error' })
    await settle(fixture)
    expect(text()).not.toContain('Credits added')

    await drain()
    http.expectOne('/api/buyer/me').flush({ ...BUYER, credit_cents: 5000 })
    await settle(fixture)
    expect(text()).toContain('Credits added')
  })

  // A 401 is different: `refreshBuyer` has cleared the principal and every later
  // poll would 401 too. Spending a minute on that, and then saying the credits
  // have not arrived, would blame the payment for a session that expired.
  it('stops and says so when the sign-in ends mid-poll', async () => {
    const { fixture, http, buttons, fire, text } = await mount({ buyer: { credit_cents: 1234 } })
    buttons()[0]!.click()
    await settle(fixture)
    fire('checkout.completed')

    await drain()
    http.expectOne('/api/buyer/me').flush({ error: 'unauthorized' }, { status: 401, statusText: 'Unauthorized' })
    await settle(fixture)
    expect(text()).toContain('your sign-in has ended')
    expect(text()).not.toContain('Credits added')
    http.verify()

    // The 401 clears the principal, and every figure read straight off it is then
    // a figure the server never sent. Showing $0.00 to someone who has just
    // handed over money is worse than showing them a stale number, so the last
    // confirmed balance stays and is labelled.
    expect(text(), 'a balance the server never reported was rendered').toContain('Balance: $12.34')
    expect(text()).not.toContain('$0.00')
    expect(text()).toContain('last confirmed before your sign-in ended')
    // Same root cause, same fix: the packs must not silently reprice off the
    // entitlement default either.
    expect(text(), 'the packs repriced when the session ended').toContain('90 responses untargeted, at $0.55 each')
  })

  // A closed overlay is not silence. On a screen where money may or may not have
  // moved, saying nothing is the worst signal there is: the buyer's reasonable
  // next action is to pay again.
  it('says nothing was charged when the buyer closes the overlay', async () => {
    const { fixture, http, buttons, fire, text } = await mount({ buyer: { credit_cents: 1234 } })
    buttons()[0]!.click()
    await settle(fixture)
    fire('checkout.closed')
    await settle(fixture)

    expect(text()).toContain('nothing was charged')
    expect(text()).not.toContain('Credits added')
    expect(text()).not.toContain('Payment received')
    // The balance is the server's last word and a closed overlay does not move it.
    expect(text()).toContain('Balance: $12.34')
    // And nothing is being waited for, because nothing was paid.
    http.verify()
    expect(buttons()[0]!.disabled, 'the buyer cannot try again').toBe(false)
  })

  it('says the payment did not go through on a checkout error', async () => {
    const { fixture, http, buttons, fire, text } = await mount({ buyer: { credit_cents: 1234 } })
    buttons()[0]!.click()
    await settle(fixture)
    fire('checkout.error')
    await settle(fixture)

    expect(text()).toContain('did not go through')
    expect(text()).toContain('no credits were added')
    expect(text()).not.toContain('Credits added')
    expect(text()).toContain('Balance: $12.34')
    http.verify()
  })

  // The ordering that makes the two above dangerous rather than merely missing:
  // Paddle emits `checkout.closed` when the overlay goes away, and that happens
  // after a successful payment too — the buyer dismisses the success screen. A
  // page that answers it blindly tells someone who has just paid that nothing was
  // charged, which is the worst sentence it could produce.
  it('does not tell a buyer who has just paid that nothing was charged', async () => {
    const { fixture, http, buttons, fire, text } = await mount()
    buttons()[0]!.click()
    await settle(fixture)

    fire('checkout.completed')
    fire('checkout.closed')
    await settle(fixture)
    expect(text(), 'the close overwrote a payment that had gone through').not.toContain('nothing was charged')
    expect(text()).toContain('Payment received')

    // And the purchase still reconciles: the close did not stop the poll either.
    await drain()
    http.expectOne('/api/buyer/me').flush({ ...BUYER, credit_cents: 5000 })
    await settle(fixture)
    expect(text()).toContain('Credits added')
    expect(text()).not.toContain('nothing was charged')
  })

  // M2. Two completions for one checkout would run two loops with independent
  // baselines against the same purchase — harmless in what they say, and double
  // the request rate at /api/buyer/me.
  it('does not start a second poll for a repeated completion', async () => {
    const { fixture, http, buttons, fire } = await mount()
    buttons()[0]!.click()
    await settle(fixture)
    fire('checkout.completed')
    fire('checkout.completed')

    await drain()
    const polls = http.match('/api/buyer/me')
    expect(polls, 'two loops are polling the same purchase').toHaveLength(1)
    polls[0]!.flush({ ...BUYER, credit_cents: 5000 })
    await settle(fixture)
  })

  // A second attempt starts clean rather than under the last one's verdict.
  it('clears what the last attempt said when a new checkout opens', async () => {
    const { fixture, buttons, fire, text } = await mount()
    buttons()[0]!.click()
    await settle(fixture)
    fire('checkout.closed')
    await settle(fixture)
    expect(text()).toContain('nothing was charged')

    buttons()[1]!.click()
    await settle(fixture)
    expect(text()).not.toContain('nothing was charged')
  })

  // The other half of that reset: after a purchase that did complete, a second
  // checkout has to be answered on its own terms. A page that still thinks it has
  // completed goes silent on the close — the no-signal failure, one attempt later.
  it('answers a second checkout on its own terms, not the first one', async () => {
    const { fixture, http, buttons, fire, text } = await mount()
    buttons()[0]!.click()
    await settle(fixture)
    fire('checkout.completed')
    await drain()
    http.expectOne('/api/buyer/me').flush({ ...BUYER, credit_cents: 5000 })
    await settle(fixture)
    expect(text()).toContain('Credits added')

    buttons()[1]!.click()
    await settle(fixture)
    fire('checkout.closed')
    await settle(fixture)
    expect(text()).toContain('nothing was charged')
    expect(text(), 'the first purchase is still being claimed for the second attempt').not.toContain('Credits added')
  })

  // C1. The wiring exactly as it ships — the page's own default loader, with only
  // the document and the window replaced, which is the injection point that
  // exists so no test reaches the CDN. A test that swaps the whole loader cannot
  // see this defect at all: it lived between the page's loader and `loadPaddle`'s
  // module-level cache, where `Initialize` keeps the *first* caller's callback for
  // the life of the document while the component is destroyed and rebuilt on
  // every navigation into the route.
  //
  // Measured before the fix: visit, click, leave, come back, click, complete the
  // payment — the second page's text was byte-identical before and after, with
  // zero polls issued. A real charge, and a screen indistinguishable from one
  // where the buyer never clicked.
  it('delivers a completed payment to the page on screen, not the one that was', async () => {
    const first = await mount()
    first.page.loader = SESSION.shipped(first.page)
    first.buttons()[0]!.click()
    await settle(first.fixture)
    first.fixture.destroy()

    const second = await mount()
    second.page.loader = SESSION.shipped(second.page)
    second.buttons()[0]!.click()
    await settle(second.fixture)

    SESSION.fire('checkout.completed')
    await settle(second.fixture)
    expect(second.text(), 'the payment was delivered to the page that had been destroyed').toContain('Payment received')

    // And it reconciles, so the second page is fully live rather than merely
    // painting one string.
    await drain()
    second.http.expectOne('/api/buyer/me').flush({ ...BUYER, credit_cents: 5000 })
    await settle(second.fixture)
    expect(second.text()).toContain('Credits added')
  })

  // The other end of C1: Paddle keeps whatever it was last given, so a page that
  // does not hand the events back stays the standing recipient for the life of
  // the document and answers events nobody can see.
  it('stops taking Paddle events once the page is left', async () => {
    const only = await mount()
    only.page.loader = SESSION.shipped(only.page)
    only.buttons()[0]!.click()
    await settle(only.fixture)
    only.fixture.destroy()

    SESSION.fire('checkout.completed')
    await drain()
    expect(only.page.status(), 'a destroyed page is still answering Paddle').toBeNull()
  })

  // Clicking a pack while signed out did precisely nothing, silently — the
  // no-signal failure again, on the payment screen.
  it('offers no dead buttons when the sign-in has gone', async () => {
    const { fixture, auth, el, buttons, opened, text } = await mount({ buyer: { credit_cents: 1234 } })
    expect(buttons()[0]!.disabled, 'the baseline is a live button').toBe(false)

    auth.buyer.set(null)
    await settle(fixture)
    expect(buttons()[0]!.disabled).toBe(true)
    buttons()[0]!.click()
    await settle(fixture)
    expect(opened).toHaveLength(0)
    expect(text()).toContain('You are not signed in, so credits cannot be bought')
    expect(Array.from(el.querySelectorAll('a'), (a) => a.getAttribute('href'))).toContain('/app/login')

    // And a deliberate sign-out is not a fault. The balance is still marked as
    // not live, but nothing claims a session ended unexpectedly — that sentence
    // belongs to the 401 path, which is the one that is a surprise.
    expect(text()).toContain('Balance: $12.34')
    expect(text()).toContain('(last confirmed balance)')
    expect(text(), 'a buyer who signed out was told their session had ended').not.toContain('your sign-in has ended')
  })

  // A poll that outlives the page keeps a destroyed component asking the server
  // for a balance nobody is looking at.
  it('stops polling when the page is left', async () => {
    const { fixture, http, buttons, fire } = await mount()
    buttons()[0]!.click()
    await settle(fixture)
    fire('checkout.completed')

    await drain()
    const pending = http.expectOne('/api/buyer/me')
    fixture.destroy()
    pending.flush({ ...BUYER, credit_cents: 0 })
    await drain()
    await drain()
    http.expectNone('/api/buyer/me')
  })

  // A checkout that cannot be reached — an ad blocker, a filtered network, a CDN
  // that answers nothing — must say so. A button that stays disabled with no
  // message is the silent failure this branch keeps rediscovering.
  it('says the checkout could not load, and leaves the buttons usable', async () => {
    const { fixture, page, buttons, opened, text } = await mount()
    page.loader = async () => { throw new Error('blocked') }
    buttons()[0]!.click()
    await settle(fixture)

    expect(text()).toContain('Checkout could not load')
    expect(opened).toHaveLength(0)
    expect(buttons()[0]!.disabled, 'the buyer is left with a button they cannot use and no way back').toBe(false)
  })

  // M1. A pack Paddle does not recognise throws from `Checkout.open`, with the
  // script loaded and working. Reported as a load failure it sends the buyer to
  // turn off an ad blocker that was never the problem — advice they will act on,
  // on a page where the alternative is to try a different pack.
  it('does not blame the ad blocker when it is the pack that failed', async () => {
    const { fixture, page, buttons, text } = await mount()
    page.loader = async () => ({
      Environment: { set() {} },
      Initialize() {},
      Checkout: { open: () => { throw new Error('unknown price id') } },
    })
    buttons()[0]!.click()
    await settle(fixture)

    expect(text()).toContain('That pack could not be opened for checkout')
    expect(text(), 'a working script was reported as a load failure').not.toContain('ad blocker')
    expect(buttons()[0]!.disabled).toBe(false)
  })

  // The third way a script from someone else's CDN fails is by being slow. The
  // buttons are disabled while it loads either way; the question is whether the
  // page says why.
  it('says it is opening the checkout while the script is still loading', async () => {
    const { fixture, page, buttons, text } = await mount()
    let release: ((p: PaddleLike) => void) | null = null
    page.loader = () => new Promise<PaddleLike>((ok) => { release = ok })
    buttons()[0]!.click()
    await settle(fixture)
    expect(text()).toContain('Opening checkout…')
    expect(buttons()[0]!.disabled).toBe(true)

    // Non-vacuous: it goes away the moment the script arrives.
    release!({ Environment: { set() {} }, Initialize() {}, Checkout: { open: () => {} } })
    await settle(fixture)
    expect(text()).not.toContain('Opening checkout…')
  })

  // Neither Paddle variable is set in this repo. A page that renders live buttons
  // over a checkout it has no token for would let a buyer click and get an
  // unexplained failure; it says so instead.
  it('will not offer a checkout it has no configuration for', async () => {
    const { fixture, buttons, opened, text } = await mount({ token: '' })
    expect(text()).toContain('Card payment is not configured')
    expect(buttons()[0]!.disabled).toBe(true)
    buttons()[0]!.click()
    await settle(fixture)
    expect(opened).toHaveLength(0)

    // Non-vacuous: the same probe with a token finds a live button and no notice.
    const live = await mount()
    expect(live.buttons()[0]!.disabled).toBe(false)
    expect(live.text()).not.toContain('Card payment is not configured')
  })

  it('says the packs could not be loaded rather than loading for ever', async () => {
    const { text, buttons } = await mount({ packs: { status: 500 } })
    expect(text()).not.toContain('Loading')
    expect(text()).toContain("Couldn't load the credit packs")
    expect(buttons()).toHaveLength(0)
  })

  // `PADDLE_PRICE_MAP` defaults to `{}` on the server, so an empty list is the
  // shipping default rather than a curiosity.
  it('says so when the deployment sells no packs', async () => {
    const { text } = await mount({ packs: [] })
    expect(text()).toContain('No credit packs are on sale')
    expect(text()).not.toContain('Loading')
  })

  it('is behind the buyer guard and names itself', () => {
    // `expect(undefined).toContain(fn)` passes in this vitest, so the array check
    // is what makes the line after it mean anything.
    expect(Array.isArray(routeMeta.canActivate)).toBe(true)
    expect(routeMeta.canActivate).toContain(buyerGuard)
    expect(routeMeta.title).toBe(`${SITE_NAME} — Credits`)
  })
})
