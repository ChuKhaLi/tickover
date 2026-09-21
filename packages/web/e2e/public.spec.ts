/**
 * The public site, driven in Chromium against the built artifact.
 *
 * This is the Phase 0 gate (spec §7): the pages posted to r/ClaudeAI, r/cursor and
 * X, and the waitlist those posts are meant to fill. Everything else in this
 * package mounts a component or drives a mocked HTTP layer; nothing else loads the
 * bundle Vite emits, and every defect this branch found only in a browser — a call
 * to action that navigated to the wrong page, an input that refused all typing —
 * was invisible to those.
 */
import { expect, test } from '@playwright/test'
import { PRICING, quoteStudy } from '@tickover/contract'
import { formatCents } from '../src/app/lib/money'
import { PAGE_META, SITE_URL } from '../src/app/lib/page-meta'
import { AGGREGATE_QUESTION, mockApi } from './mock-api'
import { longProseCount, proseOverMeasure } from './measure'

const full = quoteStudy({ targeted: false, atCost: false })
const atCost = quoteStudy({ targeted: false, atCost: true })
const atCostTargeted = quoteStudy({ targeted: true, atCost: true })

test('a developer lands, takes the developer card, and joins the waitlist', async ({ page }) => {
  const api = await mockApi(page)
  await page.goto('/')

  // The h1 points at the replica beneath it. "Earn while Claude thinks" is still on
  // the page and is now the developer path's h2, which is the job it was doing all
  // along on a page with two audiences.
  await expect(page.getByRole('heading', { name: 'This line is the product.', level: 1 })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Earn while Claude thinks', level: 2 })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Ask 300 AI-native developers one question', level: 2 })).toBeVisible()

  // The two paths are no longer two clickable cards; each ends in its own call to
  // action. This one is the developer's.
  const developerPath = page.getByRole('link', { name: 'Join the waitlist' })
  await expect(developerPath).toBeVisible()
  await developerPath.click()

  // The card is a `routerLink`, and a `routerLink` that resolves against
  // `index.html`'s `<base href="/">` is how the buyers page's call to action came
  // to navigate to the site root while every unit test stayed green (R50). The
  // address bar is the only place that shows.
  await expect(page).toHaveURL('/developers')
  await expect(page.getByRole('heading', { name: 'Get paid to answer one question while Claude works' })).toBeVisible()

  await page.getByPlaceholder('you@company.com').fill('dev@example.test')
  await page.getByRole('button', { name: 'Join the waitlist' }).click()

  await expect(page.getByText("You're on the list.")).toBeVisible()
  // The form is gone, not merely covered: the success panel replaces it, so a
  // second submission of the same address is not one click away.
  await expect(page.getByRole('button', { name: 'Join the waitlist' })).toHaveCount(0)

  // The one thing about this form that the screen cannot show. A mis-tagged
  // audience is unrecoverable — the endpoint keeps only what it was sent — and
  // both pages render the same component, so the tag is the only thing that tells
  // a developer signup from a buyer one.
  expect(api.waitlistPosts).toEqual([{ email: 'dev@example.test', audience: 'developer' }])
  expect(api.unhandled).toEqual([])
})

// Without this, the assertion above is a test of the mock: `submitWaitlist` returns
// `ok` on any `res.ok`, so a page that ignored the response entirely would also
// show the success panel. This is the same click with the endpoint refusing.
test('a waitlist the endpoint refuses says so instead of claiming to have sent it', async ({ page }) => {
  await mockApi(page, { waitlistStatus: 500 })
  await page.goto('/developers')

  await page.getByPlaceholder('you@company.com').fill('dev@example.test')
  await page.getByRole('button', { name: 'Join the waitlist' }).click()

  await expect(page.getByText("Couldn't send.")).toBeVisible()
  await expect(page.getByText("You're on the list.")).toHaveCount(0)
})

test('a buyer lands, takes the buyer card, and reads the price table', async ({ page }) => {
  const api = await mockApi(page)
  await page.goto('/')

  await page.getByRole('link', { name: /For buyers/ }).click()
  await expect(page).toHaveURL('/buyers')
  await expect(page.getByRole('heading', { name: 'Ask 300 AI-native developers one question' })).toBeVisible()

  // Every figure is asked of the contract, never typed in (R49): moving
  // `PRICING.BASE_CENTS` has to move the page, and a page that stopped agreeing
  // with the contract is a money defect on the artifact that sells the product.
  const table = page.getByRole('table')
  await expect(table.getByRole('row', { name: /Per valid response/ })).toContainText(formatCents(full.priceCents))
  await expect(table.getByRole('row', { name: /With targeting/ })).toContainText(
    formatCents(PRICING.TARGETING_CENTS),
  )
  // Both at-cost figures, because the row above sells targeting and nothing stops a
  // first study from using it. A flat untargeted quote understated the targeted
  // case by 45% on this page once already.
  await expect(table.getByRole('row', { name: /Your first study/ })).toContainText(
    formatCents(atCost.priceCents),
  )
  await expect(table.getByRole('row', { name: /Your first study/ })).toContainText(
    formatCents(atCostTargeted.priceCents),
  )

  expect(api.unhandled).toEqual([])
})

// R52's mutant, in the browser it was measured in: `<a href="#waitlist">` resolves
// against `<base href="/">`, so on /buyers the call to action navigated to the
// landing page. Nothing about the click looks different; only the URL does.
test('the buyers waitlist link stays on the buyers page', async ({ page }) => {
  await mockApi(page)
  await page.goto('/buyers')

  await page.getByRole('link', { name: 'ask us to tell you when the first studies run' }).click()

  await expect(page).toHaveURL('/buyers#waitlist')
  await expect(page.getByRole('heading', { name: 'Ask 300 AI-native developers one question' })).toBeVisible()
})

test('the data page draws a bar per option from the aggregates it is served', async ({ page }) => {
  const api = await mockApi(page)
  await page.goto('/data')

  await expect(page.getByRole('heading', { name: AGGREGATE_QUESTION.text })).toBeVisible()
  await expect(page.locator('[data-bar]')).toHaveCount(AGGREGATE_QUESTION.options.length)

  // Counts, not just bars. 30 and 10 of 40 is 75% and 25%, and a page that drew two
  // bars of the same width would pass a count assertion on its own.
  await expect(page.getByText('75%')).toBeVisible()
  await expect(page.getByText('25%')).toBeVisible()
  const widths = await page.locator('[data-bar]').evaluateAll((els) =>
    els.map((el) => (el as HTMLElement).style.width),
  )
  expect(widths).toEqual(['75%', '25%'])

  expect(api.unhandled).toEqual([])
})

test('an aggregates outage says the numbers are missing, not that there are none', async ({ page }) => {
  await page.route('**/api/public/aggregates', (route) => route.fulfill({ status: 503, body: '' }))
  await page.goto('/data')

  await expect(page.getByText("Couldn't load the latest numbers.")).toBeVisible()
  await expect(page.getByText('No data yet.')).toHaveCount(0)
})

/**
 * The deployment contract, exercised rather than described. Each prerendered route
 * has its own `<title>`, description and `og:url`, and a proxy that answers
 * `/developers` from the root `index.html` throws all of that away — which is
 * exactly what `vite preview` does, and what the brief's Caddyfile
 * (`try_files {path} /index.html`) would do in production.
 *
 * Read through `request`, not through `page`: `PageMetaTitleStrategy` retitles the
 * tab once the SPA boots, so `page.title()` is correct whichever document was
 * served and the assertion would be vacuous. What a crawler reads is the bytes.
 */
test('every prerendered route is served its own document, at the URL og:url names', async ({ request }) => {
  for (const [route, meta] of Object.entries(PAGE_META)) {
    const res = await request.get(route)
    expect(res.status(), route).toBe(200)
    const html = await res.text()
    expect(html, route).toContain(`<title>${meta.title.replace(/&/g, '&amp;')}</title>`)
    expect(html, route).toContain(
      `content="${SITE_URL}${route === '/' ? '/' : route}"`,
    )
  }
})

/**
 * The landing page is the Phase 0 artifact, and until now every load of it asked
 * for `/favicon.ico` and was answered with the SPA shell — an HTML document under
 * an icon request, which the browser reports as a failed load. Recorded as deferred
 * to this task rather than fixed where it was found.
 *
 * Asserted as "nothing on this page failed to load" rather than "the icon exists",
 * because that is the property worth keeping: a missing chunk or a stylesheet with
 * a wrong hash would show up here too, and neither has any other test watching it.
 */
/**
 * The hero, in the only place it can be checked: a real browser.
 *
 * The unit suite cannot reach any of this. `matchMedia` is absent from that DOM, so
 * the page correctly treats it as reduced motion and renders the final frame -- which
 * means the sequence, the width ladder and the reduced-motion branch are all
 * unexercised there. This is the test that watches the channel the behaviour travels
 * on.
 */
test('the hero replica is a real composed line, and the width ladder is real', async ({ page }) => {
  await mockApi(page)
  await page.goto('/')

  await expect(page.locator('mw-pane')).toBeVisible()
  // The row, not the whole replica: since R318 the surface also holds the session
  // above the line, and every claim below is about what the composer returned.
  const pane = page.locator('mw-pane [data-line]')

  // Spec 4.7: the disclosure is unconditional, so it survives every rung.
  await expect(pane).toContainText('tickover')
  const wide = (await pane.innerText()).trim()

  // The persuasive part, and the reason the budget is a control rather than a
  // decision: the line steps down through the composer's real rungs. Narrowing it
  // must produce a different, shorter line -- not a scaled-down picture of this one.
  const slider = page.locator('[data-cols]')
  // Read off the control, not typed here: the floor and the ceiling are the page's
  // to decide, and a literal would go on asserting the old one after it moves.
  const maxCols = Number(await slider.getAttribute('max'))
  expect(maxCols).toBeGreaterThan(100)
  await slider.fill(String(maxCols))
  await expect(page.getByText(`${maxCols} columns`)).toBeVisible()
  const widest = (await pane.innerText()).trim()
  expect(widest, 'a drag hands the sequence to the visitor and shows the question').toContain('Raycast')
  expect(widest).toContain('$0.50')

  await slider.fill('80')
  const narrow = (await pane.innerText()).trim()
  expect(narrow).not.toBe(widest)
  expect(narrow.length).toBeLessThan(widest.length)
  expect(narrow, 'the sponsor and payout survive every rung — spec 4.7').toContain('Raycast')

  /**
   * The floor, and the most honest thing this control shows: below the width where a
   * question fits, the composer drops the *question* rather than the disclosure, so
   * the line falls back to idle. 72 is where that happens for this study.
   *
   * It said 66, and the assertion passed, and it was measuring the wrong thing. The
   * pane was composing at the raw slider value while the client composes at that
   * value minus `STATUS_LINE_SAFETY_MARGIN`, so this test was honest about the pane
   * and pointed at a pipe that does not carry the product claim (R358). 71 is the
   * widest terminal this study's question does not reach, and 72 is the narrowest it
   * does — both asserted, because a floor claim with only one side of it is a claim
   * that something is suppressed *somewhere*.
   */
  await slider.fill('71')
  const suppressed = (await pane.innerText()).trim()
  expect(suppressed, 'a paid question is offered at a width the client shows nothing at').not.toContain('Raycast')
  expect(suppressed).toContain('tickover')

  await slider.fill('72')
  expect((await pane.innerText()).trim(), 'the question does not come back where the client says it should')
    .toContain('Raycast')

  /**
   * The replica is wide enough for the line it holds, **at the widest budget the
   * control offers**. This is the assertion that `ch` failed: measured here, `1ch` is
   * 7.0px while the face's own advance is 8.4px, so an 80-column replica rendered 68
   * columns wide and hid the rest behind a scrollbar. Nothing but a real browser with
   * the real face can catch that, and nothing else in this repository was looking.
   *
   * It filled **104** for four commits, which is the widest value that happened to
   * fit, and the comment above it claimed the general thing. At 120 -- the slider's
   * own maximum, which a visitor reaches by dragging to the end -- the line needed
   * 1008px inside a 992px frame and was clipped on every screen made, a 1920px
   * monitor included, with 900px of page unused either side. `max-w-5xl` is 1024px
   * and design system §5 says app content is 1120px; the shell had been approximating
   * the number for the whole of this design's life, and the 96px between them is
   * exactly what this control needs (R368). A check aimed at the case that passes is
   * the shape this branch has found five times now.
   */
  await slider.fill(String(maxCols))
  const fits = await page.evaluate(() => {
    const frame = document.querySelector('mw-pane > div') as HTMLElement
    const row = document.querySelector('mw-pane [data-line]') as HTMLElement
    return { shown: frame.clientWidth, needed: row.scrollWidth }
  })
  expect(fits.needed, `at the slider's maximum the frame is ${fits.shown}px and the line needs ${fits.needed}px`)
    .toBeLessThanOrEqual(fits.shown + 1)

  /**
   * And it still scrolls where it must. A viewport that genuinely cannot hold the
   * budget is the case design system §5 allows the pane to scroll in — the page never
   * does, which the check below asserts. Without this half, widening the container
   * until nothing ever scrolls would pass the assertion above and quietly retire the
   * behaviour the phone depends on.
   */
  await page.setViewportSize({ width: 900, height: 900 })
  const cramped = await page.evaluate(() => {
    const frame = document.querySelector('mw-pane > div') as HTMLElement
    const row = document.querySelector('mw-pane [data-line]') as HTMLElement
    return { scrolls: row.scrollWidth > frame.clientWidth + 1, page: document.documentElement.scrollWidth <= document.documentElement.clientWidth }
  })
  expect(cramped.scrolls, 'a 900px viewport cannot hold 120 columns, so the frame must scroll').toBe(true)
  expect(cramped.page, 'and the page still must not').toBe(true)
  await page.setViewportSize({ width: 1280, height: 720 })

  // The frame scrolls, never the page. Design system 5.
  await slider.fill(String(maxCols))
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
  )
  expect(overflow, 'the page must not scroll sideways at any budget').toBe(true)
})

/**
 * The terminal around the line, and the texture behind it (R318).
 *
 * Both are here rather than in a unit test because both are claims a DOM cannot
 * answer. The lattice is two custom properties inside a background-image: if either
 * token stopped reaching the sheet -- and a token reaches it only where a utility
 * references it, which no utility does for these two -- the declaration would be
 * invalid at computed-value time and the texture would leave with nothing red. A
 * computed style that has resolved to a colour is the only proof it is painting.
 */
test('the replica is shown inside a terminal, textured with the character cell', async ({ page }) => {
  await mockApi(page)
  await page.goto('/')

  const session = page.locator('mw-pane [data-session]')
  await expect(session, 'the session above the line is what makes the row legible').toBeVisible()
  await expect(session).toContainText('~/projects/acme')
  await expect(page.locator('mw-pane')).toContainText('refactor the auth module')

  // role=img replaces the subtree for a screen reader, so the label carries all of it.
  const label = await page.locator('mw-pane').getAttribute('aria-label')
  expect(label, 'the label still describes only the last row').toContain('A terminal where')
  expect(label).toContain('columns')

  const painted: Record<string, string> = {}
  for (const scheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: scheme })
    const lattice = await page.evaluate(() => {
      const band = document.querySelector('[data-band]') as HTMLElement
      const s = getComputedStyle(band)
      return { image: s.backgroundImage, size: s.backgroundSize }
    })
    // Two layers -- the uprights and the baselines -- so the browser reports the size
    // once per layer. Both must be the same cell or it is not a lattice.
    expect([...new Set(lattice.size.split(', '))], `the cell is 9x21 in ${scheme}`).toEqual(['9px 21px'])
    expect(lattice.image, `the lattice paints nothing in ${scheme}`).toContain('linear-gradient')
    expect(lattice.image, `a lattice token did not resolve in ${scheme}`).toContain('rgb(')
    painted[scheme] = lattice.image
  }
  // And the twin is a twin. Without this the dark theme could simply inherit the
  // paper rule -- ink-200 ruled across ink-900, the loudest possible version of this
  // texture -- and every assertion above would still be green, because each one is
  // about the light values being present rather than about the dark values differing.
  expect(painted['dark'], 'the dark ground is ruled in the paper colour').not.toBe(painted['light'])

  // The band ends at the hero's lower edge and nothing below it is textured.
  const belowIsBare = await page.evaluate(() => {
    const h2 = document.querySelector('h2') as HTMLElement
    return getComputedStyle(h2.closest('section') as HTMLElement).backgroundImage
  })
  expect(belowIsBare, 'the texture reaches the price list').toBe('none')
})

/**
 * Prose is capped at the measure, asked of the rendered page.
 *
 * `tokens.spec.ts` asks this of the source and cannot finish the job, which was
 * proved by sweeping the running product against it: **three violations on twenty
 * pages, none of them visible to a source-side check**, and one of them on every
 * page in the product.
 *
 * - The footer's sentence is a `<p>` with **no class attribute at all**, so a regex
 *   keyed on `class="..."` never saw it. 208 characters at 12px, on all twenty.
 * - `/admin`'s policy line reads `Refuse a study for {{ policy.join(', ') }}`. The
 *   literal is 55 characters and the render is 155; source cannot know that.
 * - `mw-empty`'s sentence is an *input*. The prose is at the call site and the
 *   element is in the primitive, and neither half looks long on its own.
 *
 * Measure is a rendered property -- it is a function of font size and container
 * width, and source knows neither. So this is the check that carries the claim, and
 * the source-side one is now only a style rule about declared classes (R369).
 *
 * 82, not 68: the cap is 68ch of the *font's* own character, and this counts against
 * 0.5em, the value a browser falls back to when it cannot read a glyph's advance.
 * The gap between the two is the same 17% that made `ch` the wrong unit for the
 * replica. A bound that would not have caught 155 or 208 is what matters here.
 */
test('no prose on any public page runs past the measure', async ({ page }) => {
  await mockApi(page)
  const pages = ['/', '/developers', '/buyers', '/data', '/privacy', '/terms/developers', '/terms/buyers', '/nope']
  const over: string[] = []
  for (const path of pages) {
    await page.goto(path)
    over.push(...(await proseOverMeasure(page, path)))
  }
  expect(over.sort(), 'prose past the measure, measured where it renders').toEqual([])

  // And it is looking at prose at all: a page of legal text has plenty, and a bound
  // that matched nothing would pass the assertion above by finding nothing.
  //
  // Polled rather than read once. The first version read straight after `goto` and
  // was green on its own and red in the full suite -- a prerendered document that
  // Angular re-renders on hydration is empty for a frame, and a vacuity check that
  // races the thing it is counting is its own kind of false negative.
  await page.goto('/terms/buyers')
  await page.waitForSelector('h1')
  await expect
    .poll(() => longProseCount(page), { message: 'no long prose found, so the sweep proved nothing' })
    .toBeGreaterThan(10)
})

test('reduced motion gets the final frame rather than a faster sequence', async ({ page }) => {
  await mockApi(page)
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto('/')

  // Beat 4 is idle with the counters already moved. Asserted immediately, with no
  // wait: if the sequence were merely sped up, this would still be beat 1.
  await expect(page.locator('mw-pane')).toContainText('today 4/', { timeout: 2000 })
})

test('the landing page loads with nothing failing, favicon included', async ({ page }) => {
  await mockApi(page)
  const failures: string[] = []
  page.on('response', (res) => {
    if (res.status() >= 400) failures.push(`${res.status()} ${new URL(res.url()).pathname}`)
  })

  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'This line is the product.', level: 1 })).toBeVisible()

  const icon = await page.request.get('/favicon.ico')
  expect(icon.status()).toBe(200)
  // The type is the half that matters. The shell was already answering this path
  // with a 200; what made it a failed icon was `text/html` on the way back.
  expect(icon.headers()['content-type']).toBe('image/x-icon')
  expect(failures).toEqual([])
})

test('an unknown path is served the shell, and the app renders its own not-found', async ({ page }) => {
  await mockApi(page)
  const res = await page.goto('/this-route-does-not-exist')

  // The SPA fallback: 200 and the shell, because `/app/**`, `/dev/**` and
  // `/admin/**` are client routes with no file of their own and a 404 here would
  // make every one of them undeep-linkable.
  expect(res?.status()).toBe(200)
  await expect(page.getByRole('heading', { name: 'That address is not a page here' })).toBeVisible()

  // R313: the one page a visitor reaches by mistake was the only one with no way
  // forward from it, and an empty header as well. Both halves are asserted, because
  // the heading coming back alone is exactly the state this replaced.
  await expect(page.getByRole('link', { name: 'What Tickover is' })).toBeVisible()
  await expect(page.getByRole('link', { name: /Get paid to answer/ })).toBeVisible()
  await expect(page.getByRole('link', { name: /Ask 300 AI-native developers/ })).toBeVisible()
  await expect(page.locator('header').getByRole('link', { name: 'For buyers' })).toBeVisible()

  // And they go somewhere: a route out that 404s again is not a route out.
  await page.getByRole('link', { name: 'What Tickover is' }).click()
  await expect(page.getByRole('heading', { name: 'This line is the product.' })).toBeVisible()
})

/**
 * The faces are self-hosted, so the question a browser alone can answer is whether
 * they actually resolved. A build that references the right file proves nothing:
 * the variable package declares the family `IBM Plex Sans Variable`, and asking for
 * `IBM Plex Sans` alone matched nothing we ship and fell back to the system face —
 * a page that looks close enough that no unit test, no typecheck and no byte count
 * would have noticed. That was a real defect, caught by reading the package rather
 * than by any suite, which is why it now has one.
 */
test('the self-hosted faces load and are the ones actually used', async ({ page }) => {
  await mockApi(page)
  await page.goto('/')
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()

  const resolved = await page.evaluate(async () => {
    await document.fonts.ready
    // The sans is asked for by the page itself, so it is already loaded here.
    const sansLoaded = document.fonts.check('600 16px "IBM Plex Sans Variable"')

    // The mono is not. Faces load on demand, and no page renders mono until the
    // primitives that use it exist — so checking it the same way would assert that
    // today's markup happens to use it, which is not the claim. The claim is that
    // the face we ship is declared under the name the tokens ask for and can be
    // fetched: `load` resolves with the matching faces, empty if the name matches
    // nothing. That is precisely the defect this test exists for, and it would keep
    // catching it whether or not any page uses mono yet.
    const monoMatches = await document.fonts.load('400 14px "IBM Plex Mono"')

    return {
      sansStack: getComputedStyle(document.body).fontFamily,
      sansLoaded,
      monoCount: monoMatches.length,
      monoLoaded: document.fonts.check('400 14px "IBM Plex Mono"'),
      loaded: [...document.fonts].filter((f) => f.status === 'loaded').map((f) => f.family),
    }
  })

  expect(resolved.sansStack).toContain('IBM Plex Sans Variable')
  expect(resolved.sansLoaded, 'the sans resolved to a face we ship, not the system fallback').toBe(true)
  expect(resolved.monoCount, 'no @font-face is declared under the name the mono token asks for').toBeGreaterThan(0)
  expect(resolved.monoLoaded, 'the mono is declared but did not fetch').toBe(true)
  // Only the subsets a page needs are fetched; the other seven stay unrequested.
  expect(resolved.loaded).toContain('IBM Plex Sans Variable')
})
