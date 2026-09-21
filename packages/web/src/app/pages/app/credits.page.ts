import { Component, DestroyRef, effect, inject, signal } from '@angular/core'
import { RouterLink } from '@angular/router'
import type { RouteMeta } from '@analogjs/router'
import type { z } from 'zod'
import { quoteStudy, type BuyerSelf, type CreditPack } from '@tickover/contract'
import { ApiService } from '../../lib/api'
import { AuthState, buyerGuard } from '../../lib/auth'
import { SITE_NAME } from '../../lib/page-meta'
import { PADDLE_CONFIG, loadPaddle, openCheckout, releasePaddleListener, type PaddleConfig, type PaddleLike } from '../../lib/paddle'
import { Async } from '../../ui/async'
import { Banner } from '../../ui/banner'
import { Button, Link } from '../../ui/button'
import { Card } from '../../ui/card'
import { Money } from '../../ui/money'
import { PageHeader } from '../../ui/page-header'

// Guarded per page, not on the layout -- see `app.page.ts`.
export const routeMeta = { title: `${SITE_NAME} — Credits`, canActivate: [buyerGuard] } satisfies RouteMeta

// `CreditPack` and `BuyerSelf` reach the contract's surface as schemas only, with
// no companion `export type` (R45).
type Pack = z.infer<typeof CreditPack>
type Buyer = z.infer<typeof BuyerSelf>

/**
 * The webhook is what credits an account, so the browser has to wait for it. Two
 * seconds apart for a minute in total: Paddle's own delivery is usually inside a
 * few seconds, and a minute is long enough to say something definite without
 * holding a page open indefinitely. Exported so the tests wait on these numbers
 * rather than on copies of them.
 */
export const POLL_INTERVAL_MS = 2000
export const POLL_ATTEMPTS = 30

/** What the page is saying about a purchase, and whether the server has confirmed it. */
interface Status {
  text: string
  settled: boolean
}

@Component({
  imports: [Money, RouterLink, Async, Banner, Button, Card, Link, PageHeader],
  template: `
    <mw-page-header heading="Credits" />
    <!-- The balance shown is the last figure the server actually reported, and it
         survives a lost session. A 401 clears the principal, and reading the
         balance straight off it then renders $0.00 to someone who has just paid
         -- a number the server never said, on the one screen whose whole promise
         is that this figure comes from the server. -->
    <p class="mt-3 max-w-[68ch] text-ink-800 dark:text-ink-100">
      @if (lastBuyer(); as b) {
        <!-- Two labels, because a signed-out page has two causes and only one of
             them is a surprise. Telling someone who chose to sign out that their
             session "ended" describes a fault that did not happen. -->
        Balance: <mw-money [cents]="b.credit_cents" />@if (!auth.buyer()) { <span class="text-ink-600 dark:text-ink-400">{{ sessionExpired() ? ' (last confirmed before your sign-in ended)' : ' (last confirmed balance)' }}</span> }.
      } @else { Balance unknown. }
      Credits are held when you submit a study and refunded for invalid responses when it settles.
    </p>

    <!-- Two tones, deliberately not one. The done tone is a claim that the money
         has landed in the account, and only a balance read back from the server
         may make it; everything before that is provisional and looks it. -->
    @if (status(); as s) {
      @if (s.settled) {
        <mw-banner data-settled class="mt-3" tone="done">{{ s.text }}</mw-banner>
      } @else {
        <mw-banner data-pending class="mt-3" tone="warn">{{ s.text }}</mw-banner>
      }
    }
    @if (error(); as e) { <mw-banner data-error class="mt-3" tone="error">{{ e }}</mw-banner> }
    <!-- The third way a third-party script fails is by being slow. The buttons are
         already disabled while it loads; without this line that is a page that has
         stopped responding for no stated reason. -->
    @if (busy()) { <p class="mt-3 text-small text-ink-600 dark:text-ink-400">Opening checkout…</p> }

    @if (!auth.buyer()) {
      <!-- The buttons below are disabled in this state, and a disabled button
           that says nothing is the no-signal failure this page keeps closing:
           clicking it did precisely nothing, silently. -->
      <mw-banner class="mt-6" tone="warn">You are not signed in, so credits cannot be bought. <a mw-link routerLink="/app/login">Sign in</a> and come back to this page.</mw-banner>
    }

    @if (!configured()) {
      <!-- The token comes from the deployment environment, and there is none in
           this repo yet. A page that renders live buttons over a checkout it
           cannot open would let a buyer click and get an unexplained failure.

           A line, not a banner, and R352 is why: the warn tone carries role=alert,
           so this was a live region present at first paint, announcing itself over
           whatever a screen-reader user was listening to on every single visit --
           because whether the deployment holds a Paddle token is a standing fact and
           not something that just happened. The banner above it is correct by the
           same rule: on a guarded page, a signed-out state is a lapsed session (R361). -->
      <p class="mt-6 max-w-[68ch] text-small text-review-fg dark:text-review-edge">Card payment is not configured on this deployment, so credits cannot be bought here yet.</p>
    }

    <mw-async
      class="mt-6"
      [failed]="packsFailed()"
      [loading]="packs() === null"
      [empty]="(packs() ?? []).length === 0"
      failedSays="Couldn't load the credit packs. Reload the page to try again."
      emptySays="No credit packs are on sale at the moment. Get in touch and we will set one up."
    >
      <!-- Both counts, because a response has two prices and targeting is
           available on a first study too. A single figure here was wrong by 45%
           for a targeted first study: 55c untargeted against 80c targeted. No
           number below is a constant read out of PRICING -- each is quoteStudy
           evaluated for the configuration named next to it (R49, R58). -->
      <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        @for (p of packs() ?? []; track p.price_id) {
          <!-- A card holding a button, rather than one large button holding
               everything. Three reasons, in order of weight: the control's
               accessible name becomes "Buy $50.00" instead of a paragraph of
               arithmetic read aloud; the affordance is carried by an edge already
               measured at 3.0 against both grounds, where a card edge is 1.3 and
               decorative by design; and the action says what it does, which is
               what every other control in this product does. What it costs is the
               tap target, which stops being the whole tile -- the button is
               min-h-11, so it stays at the 44px floor. -->
          <div mw-card rank="raised" pad="lg" class="flex h-full flex-col">
            <div class="text-h2 text-ink-900 dark:text-ink-50"><mw-money voice="data" [cents]="p.cents" /></div>
            <p class="mt-2 text-small text-ink-600 dark:text-ink-400">{{ responsesAt(p, untargetedCents()) }} responses untargeted, at <mw-money [cents]="untargetedCents()" /> each</p>
            <p class="text-small text-ink-600 dark:text-ink-400">{{ responsesAt(p, targetedCents()) }} responses targeted, at <mw-money [cents]="targetedCents()" /> each</p>
            <button type="button" data-pack mw-button class="mt-4 w-full" [disabled]="busy() || !configured() || !auth.buyer()" (click)="buy(p)"><span>Buy <mw-money [cents]="p.cents" /></span></button>
          </div>
        }
      </div>
      @if (atCost()) {
        <p class="mt-3 max-w-[68ch] text-small text-ink-600 dark:text-ink-400">Those are first-study prices: your first study runs at cost. After it a response is <mw-money [cents]="laterUntargetedCents" /> untargeted and <mw-money [cents]="laterTargetedCents" /> targeted, so the same pack buys fewer.</p>
      } @else {
        <p class="mt-3 max-w-[68ch] text-small text-ink-600 dark:text-ink-400">Credits are spent per valid response, at the price the study is quoted at when it is submitted.</p>
      }
    </mw-async>`,
})
export default class CreditsPage {
  auth = inject(AuthState)
  private api = inject(ApiService)

  packs = signal<Pack[] | null>(null)
  packsFailed = signal(false)
  status = signal<Status | null>(null)
  error = signal<string | null>(null)
  busy = signal(false)

  /** Read from the environment at construction, and a field so a test can supply one. */
  config: PaddleConfig = PADDLE_CONFIG

  /**
   * One stable function for the life of this page, so the teardown below can say
   * "release the events only if they are still mine" and mean it.
   */
  private paddleEvent = (n: string) => void this.onPaddleEvent(n)

  /**
   * The one seam a test replaces: everything else on this page is ours, but this
   * fetches a script from a third-party CDN, which no test may do.
   */
  loader: (onEvent: (name: string) => void) => Promise<PaddleLike> = (onEvent) =>
    loadPaddle(document, window as Window & { Paddle?: PaddleLike }, { ...this.config, onEvent })

  /** The poll's clock, replaced in tests so a minute of waiting takes no time. */
  wait: (ms: number) => Promise<void> = (ms) => new Promise((ok) => setTimeout(ok, ms))

  private destroyed = false
  /** Set when Paddle reports a completed payment; cleared when a new checkout opens. */
  private completed = false
  /**
   * The balance the purchase has to beat, read when the overlay opens rather than
   * when the payment completes. The webhook can land first -- it is a
   * server-to-server call and does not wait for the browser -- and a baseline
   * taken after that would already include the credit, so the poll would run its
   * full minute and then report that nothing had arrived.
   */
  private balanceBefore: number | null = null

  laterUntargetedCents = quoteStudy({ targeted: false, atCost: false }).priceCents
  laterTargetedCents = quoteStudy({ targeted: true, atCost: false }).priceCents

  /**
   * The last buyer the server actually confirmed, which is not the same thing as
   * the current principal: a 401 clears `AuthState.buyer`, and every figure on
   * this page derived from a null buyer is a figure the server never sent -- a
   * $0.00 balance, and pack prices silently repriced off the entitlement default.
   * This mirror only ever moves forward, so the page keeps the last real answer
   * and says it is the last one.
   */
  lastBuyer = signal<Buyer | null>(null)

  /**
   * Whether this page watched the session expire, as against the buyer choosing
   * to sign out. Both leave `AuthState.buyer` null and both make the balance
   * stale, but only one of them is a fault, and describing a deliberate sign-out
   * as a session that "ended" reports a problem that did not happen.
   */
  sessionExpired = signal(false)

  constructor() {
    inject(DestroyRef).onDestroy(() => {
      this.destroyed = true
      // Paddle keeps whatever it was last given. Left in place, a destroyed page
      // stays the standing recipient for the life of the document and answers
      // events nobody can see.
      releasePaddleListener(this.paddleEvent)
    })
    // Seeded eagerly as well as mirrored, so the first render has the balance
    // rather than waiting for an effect to run.
    this.lastBuyer.set(this.auth.buyer())
    effect(() => {
      const b = this.auth.buyer()
      if (b) this.lastBuyer.set(b)
    })
    // A rejected load used to leave a page saying "Loading…" for as long as the
    // buyer was willing to wait for an answer that was never coming.
    void this.api.creditPacks().then(
      (p) => this.packs.set(p),
      () => this.packsFailed.set(true),
    )
  }

  configured(): boolean { return this.config.token.length > 0 }

  /** The entitlement decides the price, and an unknown buyer is quoted the dearer one. */
  atCost(): boolean { return !(this.lastBuyer()?.first_study_used ?? true) }

  untargetedCents(): number { return quoteStudy({ targeted: false, atCost: this.atCost() }).priceCents }
  targetedCents(): number { return quoteStudy({ targeted: true, atCost: this.atCost() }).priceCents }

  /** Whole responses only: a pack that covers 90.9 of them covers 90. */
  responsesAt(p: Pack, cents: number): number { return Math.floor(p.cents / cents) }

  async buy(p: Pack): Promise<void> {
    const b = this.auth.buyer()
    if (!b || !this.configured()) return
    this.busy.set(true)
    this.error.set(null)
    // A fresh attempt, so nothing the last one said still stands.
    this.status.set(null)
    this.completed = false
    this.balanceBefore = b.credit_cents
    try {
      let paddle: PaddleLike
      try {
        paddle = await this.loader(this.paddleEvent)
      } catch {
        // Reworded once already: the word this line first used for a network-level
        // content blocker is itself a Tailwind utility, so naming it -- even in a
        // comment about not naming it -- shipped a rule and 1.6 kB with it (R47).
        this.error.set('Checkout could not load. An ad blocker or a privacy extension can stop it; allow this page and try again.')
        return
      }
      try {
        openCheckout(paddle, { priceId: p.price_id, buyerId: b.id, email: b.email })
      } catch {
        // A price id Paddle does not recognise throws here, with the script
        // loaded and working. One message for both failures would send a buyer to
        // turn off an ad blocker that was never the problem, on a page where they
        // will act on the advice.
        this.error.set('That pack could not be opened for checkout. Try another pack, or reload the page.')
      }
    } finally {
      this.busy.set(false)
    }
  }

  /**
   * The three outcomes Paddle reports, and what each may claim about money. None
   * of them may claim credit landed: only a balance read back from the server can,
   * because only the webhook credits an account.
   */
  async onPaddleEvent(name: string): Promise<void> {
    // Nothing that arrives after a completed payment may speak, for two reasons.
    // Paddle emits `checkout.closed` when the overlay goes away, and that happens
    // after a *successful* payment too -- the buyer dismisses the success screen.
    // Telling someone who has just paid that nothing was charged would be the
    // worst sentence on this page. And a repeated `checkout.completed` would
    // start a second poll against the same purchase, doubling the request rate
    // for two loops that can only agree. `buy()` clears the flag, so the next
    // checkout is answered on its own terms.
    if (this.completed) return
    if (name === 'checkout.completed') {
      this.completed = true
      await this.waitForCredit()
      return
    }
    // Neither of these is silence and neither implies a pending credit: on a
    // screen where money may or may not have moved, no signal is the worst signal,
    // because the buyer's reasonable next action (pay again) is the wrong one.
    // The balance is untouched by both -- it is only ever written by a server read.
    if (name === 'checkout.closed') {
      this.status.set({ text: 'Checkout closed, so nothing was charged. Your balance is unchanged; choose a pack to try again.', settled: false })
    } else if (name === 'checkout.error') {
      this.status.set({ text: 'The payment did not go through, so no credits were added. Try again, or use a different card.', settled: false })
    }
  }

  /**
   * A completed checkout in the browser is not credit. The transaction is credited
   * by `POST /webhooks/paddle`, server to server, and until a balance read back
   * from `/api/buyer/me` has risen this page may say the payment went through and
   * nothing more. Telling a buyer their money had arrived when it had not is the
   * worst thing this screen could do, so every branch below that has not seen the
   * money says so.
   */
  private async waitForCredit(): Promise<void> {
    const before = this.balanceBefore ?? this.auth.buyer()?.credit_cents ?? 0
    this.status.set({ text: 'Payment received. Waiting for your credits to arrive…', settled: false })
    for (let i = 0; i < POLL_ATTEMPTS; i++) {
      await this.wait(POLL_INTERVAL_MS)
      // One guard, here, because this is the only point in the loop a request can
      // be issued from: a page the buyer has left goes on asking the server for a
      // balance nobody is reading. A second guard after the response was tried and
      // no test could tell it from this one, so it came out rather than shipping
      // as a line nothing holds.
      if (this.destroyed) return
      // A failed balance check is not an answer about the money -- asking again
      // is, because the webhook is still coming either way. `undefined` is that
      // failure; `null` is a 401, which is a different thing entirely.
      const buyer = await this.auth.refreshBuyer().catch(() => undefined)
      if (buyer === undefined) continue
      if (buyer === null) {
        // `refreshBuyer` returns null only on a 401, and it has cleared the
        // principal. Every later poll would 401 too, so this stops rather than
        // spending a minute on it.
        this.sessionExpired.set(true)
        this.status.set({ text: 'Payment received, but your sign-in has ended. Sign in again to see your credits.', settled: false })
        return
      }
      if (buyer.credit_cents > before) {
        this.status.set({ text: 'Credits added.', settled: true })
        return
      }
    }
    this.status.set({ text: 'Payment received. Your credits have not arrived yet — they usually appear within a few minutes. Reload this page to check again.', settled: false })
  }
}
