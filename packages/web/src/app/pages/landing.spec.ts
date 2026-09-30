import type { Provider, Type } from '@angular/core'
import { ViewportScroller } from '@angular/common'
import { provideLocationMocks } from '@angular/common/testing'
import { provideHttpClient } from '@angular/common/http'
import { provideHttpClientTesting } from '@angular/common/http/testing'
import { bootstrapApplication } from '@angular/platform-browser'
import { TestBed, type ComponentFixture } from '@angular/core/testing'
import { Router, provideRouter } from '@angular/router'
import { RouterTestingHarness } from '@angular/router/testing'
import { describe, it, expect } from 'vitest'
import { ActivityTier, PRICING, RULES, SITE, quoteStudy } from '@tickover/contract'
import { App } from '../app'
import { appConfig } from '../app.config'
import { PROMPT } from '../lib/hero-timeline'
import { HERO_STUDY } from '../lib/hero-study'
import IndexPage from './index.page'
import DevelopersPage from './developers.page'
import BuyersPage from './buyers.page'
import DataPage from './data.page'
import LoginPage, { routeMeta as loginRouteMeta } from './app/login.page'
import { WAITLIST_FETCH, WAITLIST_URL } from '../ui/waitlist-form'
import { formatCents } from '../lib/money'
import { PAGE_META, SITE_NAME } from '../lib/page-meta'

// These pages are the Phase 0 validation artifact: the landing page whose two
// paths and prices go to 50 buyers, r/ClaudeAI, r/cursor and X. The strings below
// are quoted from the spec, so a reword is a product change, not a refactor — and
// every price is derived from the contract, never typed in, so the copy cannot
// drift from `PRICING` the way the at-cost row did.
const full = quoteStudy({ targeted: false, atCost: false })
const targeted = quoteStudy({ targeted: true, atCost: false })
// Both at-cost branches. Targeting is sold one row above the at-cost row and
// nothing forbids it on a first study, so a page naming only the untargeted
// figure understates a targeted first study by 45%.
const atCost = quoteStudy({ targeted: false, atCost: true })
const atCostTargeted = quoteStudy({ targeted: true, atCost: true })

const ENDPOINT = 'https://formspree.io/f/test'

function configure(extra: Provider[] = []) {
  TestBed.configureTestingModule({ providers: [provideRouter([]), ...extra] })
}

function render<T>(page: Type<T>) {
  const fixture = TestBed.createComponent(page)
  fixture.detectChanges()
  return fixture
}

function textOf<T>(page: Type<T>): string {
  configure()
  return (render(page).nativeElement as HTMLElement).textContent ?? ''
}

/** One macrotask drains every pending microtask; `whenStable()` alone does not. */
async function settle(fixture: ComponentFixture<unknown>) {
  await fixture.whenStable()
  await new Promise((ok) => setTimeout(ok, 0))
  fixture.detectChanges()
}

/**
 * Fills in and submits the waitlist form as it sits on a real page, and returns
 * what was actually POSTed. Reading the component's `audience` input instead
 * leaves `audience: 'buyer'` hardcoded inside the form fully green, which is the
 * one failure mode that cannot be recovered — a third-party form endpoint records
 * only what it was sent, and the Phase 0 gate counts developers.
 */
async function submitFrom<T>(page: Type<T>, email: string) {
  const calls: Array<{ url: string; init: RequestInit }> = []
  const capture = (async (url: string, init: RequestInit) => {
    calls.push({ url, init })
    return new Response('{}', { status: 200 })
  }) as unknown as typeof fetch
  configure([
    { provide: WAITLIST_URL, useValue: ENDPOINT },
    { provide: WAITLIST_FETCH, useValue: capture },
  ])
  const fixture = render(page)
  await settle(fixture) // NgForm wires its NgModel a microtask after the first render
  const el = fixture.nativeElement as HTMLElement
  const input = el.querySelector('input')!
  input.value = email
  input.dispatchEvent(new Event('input'))
  await settle(fixture)
  el.querySelector('form')!.dispatchEvent(new Event('submit'))
  await settle(fixture)
  return { calls, el }
}

/**
 * Boots the real `appConfig` the way `main.ts` does, with a ViewportScroller that
 * records what the router asks of it. TestBed cannot reach the scrolling options:
 * Angular calls `ROUTER_SCROLLER.init()` from the bootstrap listener, which
 * TestBed never runs, so a TestBed-based check stays green with the whole feature
 * deleted. Analog generates its file routes at build time, so the real config's
 * route table is empty under vitest and the two below stand in — only the
 * scrolling options are under test here.
 */
async function underRealAppConfig(
  body: (ctx: { router: Router; anchors: string[]; positions: Array<[number, number]> }) => Promise<void>,
) {
  const anchors: string[] = []
  const positions: Array<[number, number]> = []
  const scroller: Partial<ViewportScroller> = {
    scrollToAnchor: (a: string) => void anchors.push(a),
    scrollToPosition: (p: [number, number]) => void positions.push(p),
    getScrollPosition: () => [0, 0],
    setHistoryScrollRestoration: () => {},
    setOffset: () => {},
  }
  document.body.appendChild(document.createElement('tk-root'))
  const app = await bootstrapApplication(App, {
    providers: [appConfig.providers, { provide: ViewportScroller, useValue: scroller }],
  })
  try {
    const router = app.injector.get(Router)
    router.resetConfig([
      { path: 'buyers', component: BuyersPage },
      { path: 'developers', component: DevelopersPage },
      // Carries the page's own `routeMeta`, so what is measured is the title the
      // app route actually declares rather than one invented here.
      { path: 'app/login', component: LoginPage, ...loginRouteMeta },
      // A route `PAGE_META` does not describe and that declares no title of its
      // own, so the last-resort fallback has something to be measured against.
      // Matched last, so it shadows none of the routes above.
      { path: '**', component: IndexPage },
    ])
    await body({ router, anchors, positions })
  } finally {
    app.destroy()
    document.querySelector('tk-root')?.remove()
  }
}

/** The router schedules its scroll through `runOutsideAngular(setTimeout)`; one microtask loses the race. */
const settleScroll = () => new Promise((ok) => setTimeout(ok, 50))

describe('public pages', () => {
  it('offers both paths with the price, on the landing page', () => {
    const text = textOf(IndexPage)
    // The h1 points at the pane beneath it rather than pitching one of the two
    // audiences. "Earn while Claude thinks" was the page title and is now the
    // developer path's heading, which is the job it was always doing.
    expect(text).toContain('This line is the product.')
    expect(text).toContain('Earn while Claude thinks')
    expect(text).toContain('Ask 300 AI-native developers one question')
    // R81. Both figures used to be literals here as well as on the page, so the test
    // agreed with the card rather than with `quoteStudy`: halving DEVELOPER_SHARE
    // reddened 16 tests elsewhere and left this one green on a stale price, and the
    // daily cap was not asserted at all. Both read the contract, and so does the
    // template, so a pricing change reaches the Phase 0 artifact without anyone
    // remembering that it has to.
    expect(text).toContain(`${formatCents(full.developerCents)} a question, up to ${RULES.MAX_PAID_PER_DAY} a day. Never $0.002 an ad.`)
    // Spec §7 Phase 0 requires the price on the landing page itself. It is a table
    // now rather than a sentence, because a price list is rows; Angular drops the
    // whitespace between cells, so the label and its figure read as one string.
    expect(text).toContain(`Per valid response${formatCents(full.priceCents)}`)
    expect(text).toContain(`With targeting (language, country, activity, OS)+${formatCents(targeted.priceCents - full.priceCents)}`)
    expect(text).toContain(`Study size${PRICING.MIN_RESPONDENTS} to ${PRICING.MAX_RESPONDENTS}`)
    expect(text).toContain(`Your first study, at cost${formatCents(atCost.priceCents)}`)
  })

  /**
   * The hero is the one place on this site that makes a claim about what the client
   * prints, so the claim is checked against the composer rather than against a
   * screenshot of it. `tk-pane` has its own spec for the general case; this asserts
   * that *this page* wired it to real figures -- a sponsor, the developer's actual
   * share, and a width the slider can move.
   */
  it('shows a real composed line, at a width the visitor can change', () => {
    configure()
    const el = render(IndexPage).nativeElement as HTMLElement
    const text = el.textContent ?? ''
    expect(text, 'the disclosure spec 4.7 makes unconditional').toContain('tickover')
    expect(text).toContain('Terminal width')
    // The *final* frame, and that is the rule being checked rather than an accident of this DOM:
    // `matchMedia` is absent here, the page treats an environment it cannot ask as having asked
    // for reduced motion, and reduced motion gets the last frame at once (R384).
    expect(text, 'motion needs consent, and "could not ask" is not consent').toContain(`today 4/${RULES.MAX_PAID_PER_DAY}`)
    expect(el.querySelector('[data-sent]')!.textContent).toContain(PROMPT)
    expect(el.querySelector('[data-typed]')!.textContent, 'the prompt box is empty once sent').toBe('')
    expect(el.querySelector('[data-spinner]')!.textContent).toContain('(7s)')
    expect(el.querySelectorAll('[data-tool].opacity-0'), 'every tool line has arrived').toHaveLength(0)
  })

  it('holds a place for the replay control without offering it where there is no motion', () => {
    configure()
    const el = render(IndexPage).nativeElement as HTMLElement
    const slot = el.querySelector('[data-replay-slot]') as HTMLElement
    expect(slot, 'the control is always in the layout, so its arrival shifts nothing').not.toBeNull()
    expect(slot.classList.contains('invisible')).toBe(true)
    expect(slot.querySelector('[data-replay]')!.textContent!.trim()).toBe('Replay')
  })

  it('a width drag stops the sequence on the question', () => {
    configure()
    const fixture = render(IndexPage)
    fixture.componentInstance.setCols('110')
    fixture.detectChanges()
    const row = (fixture.nativeElement as HTMLElement).querySelector('tk-pane [data-line]')!.textContent!
    expect(row).toContain(HERO_STUDY.sponsor)
  })

  it('states the developer pay, the payout terms and the data boundary', () => {
    const text = textOf(DevelopersPage)
    // Spec §7's launch angle. It is also the headline `PAGE_META['/developers']`
    // quotes, so the link preview for the URL the Phase 0 posts carry claims this
    // page says it — and until this line existed here, it did not.
    expect(text).toContain(`${formatCents(full.developerCents)} a question, not $0.002 an ad`)
    expect(text).toContain(`${formatCents(PRICING.BASE_CENTS)} per response to the buyer, you keep ${PRICING.DEVELOPER_SHARE * 100}%, up to ${RULES.MAX_PAID_PER_DAY} paid answers a day`)
    expect(text).toContain(`Payout monthly from ${formatCents(RULES.PAYOUT_MIN_CENTS)} via PayPal.`)
    // Spec §5.5: "The consent screen lists exactly these lists. The developer web
    // page mirrors them." Both halves are pinned, not just the never-sent half.
    expect(text).toContain('Your GitHub id, operating system, Claude Code version, when each turn starts and stops, counts of file extensions in your project directory, and your answers with how long you took and where you answered them (terminal pane, local page, VS Code, or inside Claude Code).')
    // §5.5's third list. Without it a developer never learns their country is
    // derived at all, on the one page whose credibility rests on saying what
    // leaves the machine — while /buyers sells targeting on that same country.
    expect(text).toContain('Derived on our side, not sent by the plugin: your country, from the IP address of the request, and an activity tier from how many turns you run a week (light under 5, regular 5 to 20, heavy over 20). Buyers can target on both.')
    // A tier added to the contract has to reach this sentence too.
    for (const tier of ActivityTier.options) expect(text, `activity tier "${tier}" is not disclosed`).toContain(tier)
    expect(text).toContain('Never: prompts, file contents, file paths, repository names, repository owners, or transcripts.')
  })

  /**
   * A link preview quotes the page it previews, and the page is what a reader sees.
   *
   * This lived in `test/unit/page-meta.spec.ts` and read each page's source for the
   * headline, which held for as long as every headline was a literal. `/developers`
   * derives its price now, so the string is no longer in the file although the page
   * still says it -- the guard went red on a page that had not drifted, which is the
   * same mistake the measure guard made about measure (R369): a claim about what is
   * rendered, checked against what is written.
   *
   * Four routes, because those are the four whose titles carry a headline after the
   * dash; the legal pages name what they settle instead.
   */
  it('previews each page with a headline that page actually says', () => {
    for (const [route, page] of [
      ['/', IndexPage],
      ['/developers', DevelopersPage],
      ['/buyers', BuyersPage],
      ['/data', DataPage],
    ] as Array<[string, Type<unknown>]>) {
      const parts = PAGE_META[route].title.split(' — ')
      expect(parts, `${route} title has no headline after the dash`).toHaveLength(2)
      // Four pages in one test, so each gets its own module: `textOf` configures one
      // and a configured module cannot be configured again.
      TestBed.resetTestingModule()
      // Case-insensitive: a headline reads "Ask 300…" as an h1 and "ask 300…" after
      // "Tickover for buyers".
      expect(textOf(page).toLowerCase(), `${route} previews a headline it does not say`).toContain(
        parts[1]!.toLowerCase(),
      )
    }
  })

  it('prices the buyer table from the contract, at-cost row included', () => {
    const text = textOf(BuyersPage)
    expect(text).toContain('Every respondent answered inside Claude Code')
    expect(text).toContain(`Per valid response${formatCents(full.priceCents)}`)
    expect(text).toContain(`With targeting (language, country, activity, OS)+${formatCents(targeted.priceCents - full.priceCents)}`)
    expect(text).toContain(`Study size${PRICING.MIN_RESPONDENTS} to ${PRICING.MAX_RESPONDENTS} respondents`)
    // The row that carries the Phase 0 offer to 50 buyers, and the one the server
    // will actually invoice from. Every figure comes from `quoteStudy`, both
    // branches, because `buyer.controller.ts` quotes `{ targeted, atCost }` and
    // re-quotes the same pair under the buyer row lock at submit.
    expect(text).toContain(`at cost: ${formatCents(atCost.priceCents)} per response, or ${formatCents(atCostTargeted.priceCents)} with targeting — the developer's ${formatCents(atCost.developerCents)} or ${formatCents(atCostTargeted.developerCents)} plus ${formatCents(PRICING.AT_COST_FEE_CENTS)} payment fees, we take $0`)
    expect(text).toContain('Every study is approved by a person before it goes live')
  })

  // Founding buyers (spec 2026-09-28): the outreach links here, and the h1 promises 300
  // developers the panel does not have yet. The block says so, carries the refund promise the
  // emails make, and sits above the review policy so a buyer arriving from an email meets it
  // before the fine print.
  it('tells a founding buyer the panel is new, the 14-day refund, and where to write', () => {
    configure()
    const el = render(BuyersPage).nativeElement as HTMLElement
    const block = el.querySelector('#founding')
    expect(block, 'no #founding block on /buyers').toBeTruthy()
    expect(block!.textContent).toContain('The developer panel is new')
    // Each term the outreach emails promise, asserted on its own so a copy edit cannot drop one:
    // pay later, and the refund -- scoped to founding studies, which is all the offer covers.
    expect(block!.textContent).toContain('pay only once the panel can fill it')
    expect(block!.textContent).toContain('if a founding study does not fill within 14 days of going live, the unused part is refunded')
    const mail = block!.querySelector('a[href^="mailto:"]')
    expect(mail?.getAttribute('href')).toBe(`mailto:${SITE.CONTACT_EMAIL}?subject=Founding%20buyer`)
    const policy = Array.from(el.querySelectorAll('h2')).find((h) => h.textContent === 'Review policy')!
    expect(block!.compareDocumentPosition(policy) & Node.DOCUMENT_POSITION_FOLLOWING, 'the block sits above the review policy').toBeTruthy()
  })

  // R500: a study is paid by invoice before review, not bought ahead in a Paddle pack. The row
  // that used to name the packs now names that, and the page names no payment provider.
  it('names paying per study by PayPal on the buyer row, and no merchant of record', () => {
    configure()
    const el = render(BuyersPage).nativeElement as HTMLElement
    const rows = Array.from(el.querySelectorAll('tr'))
    const row = rows.find((r) => r.textContent?.includes('Pay per study'))
    expect(row, 'no buyer row names paying per study').toBeTruthy()
    expect(row!.textContent).toContain('By PayPal')
    expect(el.textContent).not.toContain('Paddle')
  })

  it('posts a developer signup as a developer, all the way to the wire', async () => {
    const { calls, el } = await submitFrom(DevelopersPage, 'dev@example.com')
    expect(calls).toHaveLength(1)
    expect(calls[0]!.url).toBe(ENDPOINT)
    expect(JSON.parse(String(calls[0]!.init.body))).toEqual({ email: 'dev@example.com', audience: 'developer' })
    expect(el.textContent).toContain("You're on the list.")
  })

  it('posts a buyer signup as a buyer, all the way to the wire', async () => {
    const { calls } = await submitFrom(BuyersPage, 'pm@acme.test')
    expect(calls).toHaveLength(1)
    expect(JSON.parse(String(calls[0]!.init.body))).toEqual({ email: 'pm@acme.test', audience: 'buyer' })
  })

  // R50 restored. Task 3 dropped both links rather than send the primary call to
  // action of the Phase 0 artifact to a 404; `/app/login` resolves now, so they
  // are back. The developers page still has none: a developer signs in with
  // `tickover web` from the CLI, and a buyer sign-in link there would be the
  // wrong door.
  it('offers buyer sign-in on the two pages that sell buyer accounts, and nowhere else', () => {
    configure()
    for (const page of [IndexPage, BuyersPage] as Type<unknown>[]) {
      const el = render(page).nativeElement as HTMLElement
      expect(el.querySelectorAll('a[href="/app/login"]').length, `${page.name} has no sign-in link`).toBeGreaterThan(0)
    }
    const devs = render(DevelopersPage).nativeElement as HTMLElement
    expect(devs.querySelectorAll('a[href="/app/login"]')).toHaveLength(0)
    expect(devs.textContent, 'the probe is reading an empty render').toContain('Join the waitlist')
  })

  // Where the click lands, not what the attribute says — the rule the fragment CTA
  // below was written under, applied to the link that replaced it. Both routes are
  // real here, so a link that resolves against the wrong base, or one the router
  // never sees, fails on `Router.url` rather than passing on its own href.
  it('sends both buyer sign-in links to the sign-in page', async () => {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([{ path: 'buyers', component: BuyersPage }, { path: 'app/login', component: LoginPage }]),
        provideLocationMocks(), provideHttpClient(), provideHttpClientTesting(),
      ],
    })
    const harness = await RouterTestingHarness.create('/buyers')
    const router = TestBed.inject(Router)
    // Exact text, not `includes`: the call to action starts with the nav link's
    // whole label, so a substring match would find the wrong anchor and keep
    // passing with the other one deleted.
    const find = (text: string) => {
      const links = Array.from(harness.routeNativeElement!.querySelectorAll('a[href="/app/login"]'))
      expect(links, 'the buyers page carries the nav link and the call to action').toHaveLength(2)
      const hit = links.find((a) => a.textContent?.trim() === text) as HTMLAnchorElement | undefined
      expect(hit, `no sign-in link reading "${text}"`).toBeTruthy()
      return hit!
    }
    for (const text of ['Sign in to create a study', 'Sign in']) {
      await harness.navigateByUrl('/buyers')
      find(text).click()
      await harness.fixture.whenStable()
      expect(router.url, text).toBe('/app/login')
      expect(harness.routeNativeElement!.querySelector('input[type=email]'), 'the sign-in page did not render').not.toBeNull()
    }
  })

  // index.html carries `<base href="/">`, so a bare `href="#waitlist"` resolves
  // against the *base* URL, not the current one: on /buyers the CTA pointed at
  // the site root, and clicking it left the page for one with no form on it.
  // Asserting the href *attribute* cannot see that — it reads the string that was
  // authored, never the URL a browser resolves.
  //
  // **The click assertion is the robust half.** Measured against the broken markup
  // in three configurations, it is red in all of them — including with the `<base>`
  // and the `replaceState` below both removed — and it is the only one that kills a
  // fourth mutant, `<a href="/buyers#waitlist">`. What it pins is the *router
  // mechanism*, not a visibly broken link: that mutant behaves correctly in a
  // browser (a same-document fragment navigation, no reload, scrollY 0 → 423), but
  // the router never sees it, so `Router.url` stays `/buyers` while the address bar
  // disagrees, and the route is hardcoded back into the CTA. Do not delete this
  // assertion because the one above looks more specific.
  //
  // The resolved-href assertion needs the arrangement below to mean anything: the
  // document has to sit at `/buyers` with `<base href="/">`, the way a shipped route
  // does. The vitest document sits at `/` with no base, which is a more forgiving
  // document — a bare `#waitlist` resolves there to something that looks right. The
  // `baseURI` guard is what stops that arrangement being tidied away. So arranged,
  // it fails with `expected '/#waitlist' to be '/buyers#waitlist'`.
  it('sends the buyer CTA to the form on this page, not to the site root', async () => {
    TestBed.configureTestingModule({
      providers: [provideRouter([{ path: 'buyers', component: BuyersPage }]), provideLocationMocks()],
    })
    const base = document.createElement('base')
    base.setAttribute('href', '/')
    document.head.appendChild(base)
    history.replaceState({}, '', '/buyers')
    try {
      const harness = await RouterTestingHarness.create('/buyers')
      const el = harness.routeNativeElement!
      const cta = el.querySelector('a[href*="waitlist"]') as HTMLAnchorElement | null
      expect(cta, 'the buyers page has no waitlist call to action').not.toBeNull()
      expect(document.baseURI, 'the probe did not reproduce the shipped document').toBe(new URL('/', document.URL).href)

      const url = new URL(cta!.href)
      expect(url.pathname + url.hash).toBe('/buyers#waitlist')

      cta!.click()
      await harness.fixture.whenStable()
      expect(TestBed.inject(Router).url).toBe('/buyers#waitlist')
      expect(el.querySelector('#waitlist'), 'the CTA has no target to scroll to').not.toBeNull()
    } finally {
      base.remove()
      history.replaceState({}, '', '/')
    }
  })

  // The URL being right is only half of it: `anchorScrolling` in `app.config.ts` is
  // what makes that fragment actually move the page, and with the feature deleted
  // the rest of the suite stays green.
  it('scrolls to that fragment, under the real app config', async () => {
    await underRealAppConfig(async ({ router, anchors }) => {
      await router.navigateByUrl('/buyers#waitlist')
      await settleScroll()
      expect(anchors).toContain('waitlist')
    })
  })

  // A routed navigation with no fragment has to land at the top. RouterScroller
  // normalises every option it is not given to 'disabled', so `anchorScrolling`
  // alone left the next page holding the previous page's offset: clicking "For
  // buyers" from the bottom of /developers arrived 342px down the buyers page,
  // measured on the built artifact.
  it('lands a routed navigation at the top of the new page', async () => {
    await underRealAppConfig(async ({ router, positions }) => {
      await router.navigateByUrl('/buyers#waitlist')
      await settleScroll()
      // Cleared after the fragment navigation, so anything recorded below belongs
      // only to the fragment-less navigation under test.
      positions.length = 0
      await router.navigateByUrl('/developers')
      await settleScroll()
      expect(positions).toEqual([[0, 0]])
    })
  })

  // The prerendered head is what a crawler reads; this is what the developer's own
  // browser tab reads once the SPA takes over, and after an in-app navigation the
  // two disagree unless something sets it. Tested under the real `appConfig` because
  // a TestBed that supplies its own `provideRouter` is green with the strategy
  // missing from `app.config.ts` entirely — the same blind spot the scrolling tests
  // above are arranged around.
  it('retitles the browser tab on every routed navigation, under the real app config', async () => {
    await underRealAppConfig(async ({ router }) => {
      const seen: string[] = []
      for (const route of ['/developers', '/buyers']) {
        await router.navigateByUrl(route)
        expect(document.title, route).toBe(PAGE_META[route].title)
        seen.push(document.title)
      }
      // Four identical heads is the defect this comes from; two identical tab
      // titles would be the same defect wearing the runtime path.
      expect(new Set(seen).size).toBe(seen.length)

      // `PAGE_META` is the prerender list and nothing else may join it, so the app
      // routes carry their titles in `routeMeta` instead and the strategy falls
      // through to them. Without that fall-through every screen a buyer signs in
      // to shares one tab title.
      await router.navigateByUrl('/app/login')
      expect(typeof loginRouteMeta.title, 'a resolver would need a different probe').toBe('string')
      expect(document.title).toBe(loginRouteMeta.title)
      expect(document.title).not.toBe(SITE_NAME)

      // A route with no entry in either place must not inherit the previous page's
      // title, and must not claim the landing headline either.
      await router.navigateByUrl('/nothing-here')
      expect(document.title).toBe(SITE_NAME)
    })
  })
})

/**
 * The lines the plan-2 review left parked as "seven further pre-existing unpinned
 * spec lines", plus spec §4.7's payout-amount clause. Every one was measured green
 * with the sentence deleted (`task-3-rereview.md`), which is the definition of copy
 * that is not under test: these pages are the Phase 0 artifact, they go to 50 buyers
 * and to r/ClaudeAI, r/cursor and X, and each of these sentences is a promise the
 * server actually keeps.
 *
 * They are grouped by the claim rather than by the page, because that is what makes
 * a failure readable: "the review policy stopped saying what is refused" is a product
 * change, "buyers.page.ts line 34 changed" is not.
 */
describe('the spec claims these pages make', () => {
  // R418: "the plugin is open source" was said twice on this page with nothing to click. The trust
  // pitch is that the claims can be checked, so both say it with a link to the code.
  it('links both open-source claims on /developers to the public repository', () => {
    TestBed.resetTestingModule()
    TestBed.configureTestingModule({ providers: [provideRouter([])] })
    const fixture = TestBed.createComponent(DevelopersPage)
    fixture.detectChanges()
    const links = Array.from((fixture.nativeElement as HTMLElement).querySelectorAll(`main a[href="${SITE.SOURCE_REPO}"]`))
    expect(links.map((a) => a.textContent?.trim())).toEqual(['open source', 'open source'])
  })

  // R418: the install step names what lands on the developer's machine, and links it.
  it('names and links the npm package the setup installs', () => {
    TestBed.resetTestingModule()
    TestBed.configureTestingModule({ providers: [provideRouter([])] })
    const fixture = TestBed.createComponent(DevelopersPage)
    fixture.detectChanges()
    const link = (fixture.nativeElement as HTMLElement).querySelector(`main a[href="${SITE.NPM_PACKAGE_URL}"]`)
    expect(link?.textContent?.trim()).toBe('tickover-cli')
  })

  // Spec §4.7's rejection grounds, and the same list the buyer terms carry. A study
  // that would be refused is cheaper to not write than to have rejected.
  it('states the review policy in full, on the page a buyer decides from', () => {
    const text = textOf(BuyersPage)
    expect(text).toContain('Every study is approved by a person before it goes live.')
    expect(text).toContain('Not allowed: harvesting personal data, political or adult content, deceptive framing, questions phrased as feedback about Claude Code or Anthropic.')
  })

  // Spec §4.7 ends "Sponsor name **and payout amount** are always displayed with paid
  // questions". This page named only the sponsor until now -- and the amount is the
  // half the developer decides on.
  it('promises the sponsor and the payout amount, both, and prices the amount from the contract', () => {
    const text = textOf(BuyersPage)
    expect(text).toContain(`The sponsor name and the ${formatCents(full.developerCents)} a developer earns are always shown with the question.`)
  })

  // The claim the whole /data page rests on. Weakening it to "aggregates from paid
  // studies, updated daily" was green -- and it would be a different product.
  it('says what the data page publishes, and what it does not', () => {
    const text = textOf(DataPage)
    expect(text).toContain('Aggregates from unpaid panel-profile questions. Updated weekly.')
    expect(text).toContain('No individual answers are published.')
  })

  // Three promises to the developer, each of which the client actually keeps:
  // skipping is free (`skipAssignment` writes no ledger entry), payment is per
  // answer (`developerCents` is per answer, and no code reads elapsed time), and
  // there is no self-updater (spec §5).
  it('keeps the three developer promises that cost money to break', () => {
    const text = textOf(DevelopersPage)
    expect(text).toContain('Skips cost nothing.')
    expect(text).toContain('Paid per answer, never per second, so a longer Claude run earns nothing extra.')
    expect(text).toContain('The plugin is open source and has no self-updater.')
  })

  // The command a developer is told to run. Changing it to `/tickover:install` was
  // green, and it is the one string on this page that has to match the plugin.
  it('names the setup command the plugin actually ships', () => {
    expect(textOf(DevelopersPage)).toContain('/tickover:setup')
  })

  // The differentiator the whole buyer pitch rests on. One `textOf` per test: this
  // file's helper configures the TestBed on every call, so a second call in one test
  // throws rather than rendering.
  it('makes the claim that distinguishes this panel from a survey panel', () => {
    expect(textOf(BuyersPage)).toContain('Every respondent answered inside Claude Code. No panel can fake that.')
  })

  // The developer page's own headline, which `PAGE_META` quotes into the link preview
  // the spec §7 Phase 0 posts render -- so it is read by more people than the page.
  it('leads the developer page with the line its link preview claims it does', () => {
    expect(textOf(DevelopersPage)).toContain('Get paid to answer one question while Claude works')
  })
})
