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
import { PRICING, formatStatusLine, quoteStudy, resolveColumns } from '@tickover/contract'
import { HERO_STUDY } from '../src/app/lib/hero-study'
import { PROMPT } from '../src/app/lib/hero-timeline'
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
  await expect(page.getByRole('heading', { name: 'Ask AI-native developers while their agent works', level: 2 })).toBeVisible()

  // The two paths are no longer two clickable cards; each ends in its own call to
  // action. This one is the developer's.
  const developerPath = page.getByRole('link', { name: 'Install the plugin' })
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

// R411. The form is in the prerendered bytes (R400), so it takes typing before any script has run.
// Hydration keeps the element, but the forms module then writes its empty model into it, and event
// replay re-runs the queued input events only afterwards -- against an element that is already
// empty. Captured before the fix: value "" after hydration, the control ng-dirty, no POST, and
// "That email doesn't look right." for an address the visitor typed. The race is made certain rather
// than hoped for: every script is held until the typing is done. The `jsaction` attribute is what
// the replay removes once it has run, so its absence is the "hydration is finished" signal; it goes
// in both the broken and the fixed build, so it cannot make this pass by itself.
test('an email typed before the page hydrates is the one the waitlist sends', async ({ page }) => {
  const api = await mockApi(page)
  let release!: () => void
  const held = new Promise<void>((r) => { release = r })
  await page.route('**/assets/*.js', async (route) => { await held; await route.continue() })

  // 'commit', not the default: a module script defers DOMContentLoaded, which never comes while held.
  await page.goto('/developers', { waitUntil: 'commit' })
  const field = page.getByPlaceholder('you@company.com')
  await field.pressSequentially('dev@example.test')
  // Guards the premise: had anything hydrated already, this would be the ordinary path.
  await expect(field).toHaveAttribute('jsaction', /input/)

  release()
  await expect(field).not.toHaveAttribute('jsaction')
  await expect(field).toHaveValue('dev@example.test')

  await page.getByRole('button', { name: 'Join the waitlist' }).click()
  await expect(page.getByText("You're on the list.")).toBeVisible()
  expect(api.waitlistPosts).toEqual([{ email: 'dev@example.test', audience: 'developer' }])
})

// R413. The same held-script race, but the visitor submits before the page hydrates. Captured before
// the fix: the browser's own submission ran -- a GET to /developers?email=dev%40example.test -- so the
// address went into the URL, the history, the server's log and the next Referer, and no POST reached
// the waitlist. Enter and a click both, because they are two different ways into the same default.
test('a waitlist submitted before the page hydrates posts once and never puts the email in a URL', async ({ page }) => {
  const api = await mockApi(page)
  const urls: string[] = []
  page.on('request', (r) => urls.push(r.url()))
  // A replayed event throws if anything calls preventDefault on it; the forms module does, unless
  // the form's method is "dialog".
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  let release!: () => void
  const held = new Promise<void>((r) => { release = r })
  await page.route('**/assets/*.js', async (route) => { await held; await route.continue() })

  await page.goto('/developers', { waitUntil: 'commit' })
  const field = page.getByPlaceholder('you@company.com')
  await field.pressSequentially('dev@example.test')
  // The premise: the form's submit is still only queued, not handled.
  await expect(page.locator('form')).toHaveAttribute('jsaction', /submit/)
  await field.press('Enter')
  await page.getByRole('button', { name: 'Join the waitlist' }).click()

  release()
  await expect(page.getByText("You're on the list.").or(field)).toBeVisible()
  // The URL first: a native submission leaves the page, so the success check below would fail
  // anyway, and only this line says why. A request list rather than the address bar alone, because a
  // GET that redirected or was replaced would leave the bar clean and the log dirty.
  expect(urls.filter((u) => u.includes('email') || u.includes('example.test'))).toEqual([])
  expect(page.url()).not.toContain('email')
  await expect(page.getByText("You're on the list.")).toBeVisible()
  expect(api.waitlistPosts).toEqual([{ email: 'dev@example.test', audience: 'developer' }])
  expect(errors).toEqual([])
})

// R413. The hero's width control takes a drag before hydration just as the form takes typing, and
// lost it the same way: the first render writes cols() -- 80 -- into the element the visitor had
// moved, and the replayed input event then reads 80 back. Captured before the fix: 80, "80 columns".
test('the hero width dragged before the page hydrates keeps the width it was dragged to', async ({ page }) => {
  await mockApi(page)
  let release!: () => void
  const held = new Promise<void>((r) => { release = r })
  await page.route('**/assets/*.js', async (route) => { await held; await route.continue() })

  await page.goto('/', { waitUntil: 'commit' })
  const slider = page.locator('[data-cols]')
  await slider.fill('100')
  await expect(slider).toHaveAttribute('jsaction', /input/)

  release()
  await expect(slider).not.toHaveAttribute('jsaction')
  await expect(slider).toHaveValue('100')
  await expect(page.getByText('100 columns')).toBeVisible()

  await expect(page.locator('tk-pane [data-line]')).toContainText(HERO_STUDY.sponsor)
  await page.waitForTimeout(3000)
  await expect(page.locator('[data-typed]'), 'the sequence started over a drag').toHaveText('')
})

test('a buyer lands, takes the buyer card, and reads the price table', async ({ page }) => {
  const api = await mockApi(page)
  await page.goto('/')

  await page.getByRole('link', { name: /For buyers/ }).click()
  await expect(page).toHaveURL('/buyers')
  await expect(page.getByRole('heading', { name: 'Ask AI-native developers while their agent works' })).toBeVisible()

  // Every figure is asked of the contract, never typed in (R49): moving
  // `PRICING.BASE_CENTS` has to move the page, and a page that stopped agreeing
  // with the contract is a money defect on the artifact that sells the product.
  const table = page.getByRole('table')
  await expect(table.getByRole('row', { name: /Per valid answer to each question/ })).toContainText(formatCents(full.priceCents))
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
  await expect(page.getByRole('heading', { name: 'Ask AI-native developers while their agent works' })).toBeVisible()
})

// The landing page's data-boundary link went to /data, which shows aggregates and none of the
// three lists. It now lands on the heading that carries them, and the browser is the only place
// that shows whether a cross-route fragment link scrolls there.
test('the landing data-boundary link lands on the lists on /developers', async ({ page }) => {
  await mockApi(page)
  await page.goto('/')

  await page.getByRole('link', { name: 'What leaves your machine' }).click()

  await expect(page).toHaveURL('/developers#what-leaves')
  await expect(page.getByRole('heading', { name: 'What leaves your machine' })).toBeInViewport()
})

// R910: the founding block's terms link lands on the arrangement in the buyer terms.
test('the founding block links to the founding arrangement in the buyer terms', async ({ page }) => {
  await mockApi(page)
  await page.goto('/buyers')

  await page.locator('#founding').getByRole('link', { name: 'buyer terms' }).click()

  await expect(page).toHaveURL('/terms/buyers#founding')
  await expect(page.getByRole('heading', { name: 'Founding buyers' })).toBeInViewport()
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

  await expect(page.locator('tk-pane')).toBeVisible()
  // The row, not the whole replica: since R318 the surface also holds the session
  // above the line, and every claim below is about what the composer returned.
  const pane = page.locator('tk-pane [data-line]')
  // What the developer is paid for this study, which is what the line prints.
  const payoutCents = quoteStudy({ targeted: false, atCost: false }).developerCents

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
  // The study's own values, not copies of them: the sponsor and the payout are what the page holds
  // and what the contract prices, so a change to either moves this test with it rather than past it.
  expect(widest, 'a drag hands the sequence to the visitor and shows the question').toContain(HERO_STUDY.sponsor)
  expect(widest).toContain(formatCents(payoutCents))

  await slider.fill('80')
  const narrow = (await pane.innerText()).trim()
  expect(narrow).not.toBe(widest)
  expect(narrow.length).toBeLessThan(widest.length)
  expect(narrow, 'the sponsor and payout survive every rung — spec 4.7').toContain(HERO_STUDY.sponsor)

  /**
   * The floor, and the most honest thing this control shows: below the width where a
   * question fits, the composer drops the *question* rather than the disclosure, so
   * the line falls back to idle.
   *
   * **Derived, not typed.** This assertion has carried a stale literal twice. It said
   * 66, which was measured against the raw slider value while the client composes at
   * that value minus `STATUS_LINE_SAFETY_MARGIN` (R358). It then said 71/72, which was
   * right until the product was renamed: every composed line is prefixed with the
   * product name, `tickover` is one character shorter than `meanwhile`, and one
   * character of prefix is one column of floor -- so the rename moved it to 70/71 and
   * updated the string this test greps for without updating the width (R383). Nothing
   * caught it, because Playwright is in no CI job.
   *
   * So the floor is asked of the composer, for the study the page actually holds, and
   * what is asserted in the browser is that the replica agrees with it. That is also
   * the claim worth making: R358 was not a wrong number, it was `tk-pane` resolving
   * width differently from the daemon, and this goes red the moment it does so again.
   */
  const showsQuestion = (cols: number) =>
    formatStatusLine({
      loggedIn: true,
      answered: null,
      todayPaid: 0,
      pendingCents: 0,
      availableCents: 0,
      maxColumns: resolveColumns({ detected: cols }),
      question: {
        assignment_id: '00000000-0000-4000-8000-000000000000',
        kind: 'choice',
        text: HERO_STUDY.question,
        options: [...HERO_STUDY.options],
        context: null,
        sponsor: HERO_STUDY.sponsor,
        price_cents: payoutCents,
        served_at: '2026-01-01T00:00:00.000Z',
        expires_at: '2026-01-01T00:01:00.000Z',
      },
    }).includes(HERO_STUDY.sponsor)

  const minCols = Number(await slider.getAttribute('min'))
  let floor = 0
  for (let c = minCols; c <= maxCols; c++) if (showsQuestion(c)) { floor = c; break }
  // A floor claim needs both sides, or it only says something is suppressed somewhere.
  // These two also say the control's own range still straddles it -- a slider that
  // started above the floor would make the interesting rung unreachable.
  expect(floor, 'the composer never shows this study inside the slider range').toBeGreaterThan(0)
  expect(floor, 'the slider starts at or above the floor, so the drop is off the control').toBeGreaterThan(minCols)

  await slider.fill(String(floor - 1))
  const suppressed = (await pane.innerText()).trim()
  expect(suppressed, `a paid question is offered at ${floor - 1} columns, where the client shows none`).not.toContain(HERO_STUDY.sponsor)
  expect(suppressed).toContain('tickover')

  await slider.fill(String(floor))
  expect((await pane.innerText()).trim(), `the question does not come back at ${floor}, where the client shows it`)
    .toContain(HERO_STUDY.sponsor)

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
    const frame = document.querySelector('tk-pane > div') as HTMLElement
    const row = document.querySelector('tk-pane [data-line]') as HTMLElement
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
    const frame = document.querySelector('tk-pane > div') as HTMLElement
    const row = document.querySelector('tk-pane [data-line]') as HTMLElement
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

  const session = page.locator('tk-pane [data-session]')
  await expect(session, 'the session above the line is what makes the row legible').toBeVisible()
  await expect(session).toContainText('~/projects/acme')
  await expect(page.locator('tk-pane')).toContainText('refactor the auth module')

  // role=img replaces the subtree for a screen reader, so the label carries all of it.
  const label = await page.locator('tk-pane').getAttribute('aria-label')
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
 * - `tk-empty`'s sentence is an *input*. The prose is at the call site and the
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
  await expect(page.locator('tk-pane')).toContainText('today 4/', { timeout: 2000 })

  await expect(page.locator('[data-replay]'), 'no control where there is no motion').toBeHidden()
  await expect(page.locator('[data-typed]')).toHaveText('')
})

/**
 * The sequence, watched where it runs (R384). Real time rather than `page.clock`: hydration itself
 * rides on timers, and a faked clock would be testing a page that never finished waking up.
 */
const heroRow = (page: import('@playwright/test').Page) => page.locator('tk-pane [data-line]')

test('the hero plays its session once, and the pane never changes height', async ({ page }) => {
  await mockApi(page)
  await page.goto('/')
  // Every height the pane takes from here on, by the browser's own account.
  await page.evaluate(() => {
    const w = window as unknown as { __heights: number[] }
    w.__heights = []
    new ResizeObserver((es) => es.forEach((e) => w.__heights.push(Math.round(e.contentRect.height))))
      .observe(document.querySelector('tk-pane')!)
  })

  await expect(page.locator('[data-typed]')).toContainText(PROMPT.slice(0, 10), { timeout: 5000 })
  await expect(heroRow(page)).toContainText(HERO_STUDY.sponsor, { timeout: 8000 })
  await expect(heroRow(page)).toContainText('✓', { timeout: 5000 })
  await expect(heroRow(page)).toContainText('today 4/', { timeout: 5000 })
  await expect(heroRow(page)).not.toContainText('✓')
  await expect(page.locator('[data-replay]')).toHaveText('Replay')

  const heights = await page.evaluate(() => (window as unknown as { __heights: number[] }).__heights)
  expect(heights.length, 'the observer saw the pane at all').toBeGreaterThan(0)
  expect([...new Set(heights)], 'the pane changed height during the sequence').toHaveLength(1)
})

/**
 * The channel the bug travels on (task 6's finding, fix round 1): the Layout Instability API
 * itself, not a bounding-box sample taken between arbitrary waits -- that is how Lighthouse's own
 * CLS score is built, and `cls-culprits-insight` named the caret span by watching this.
 *
 * Only what the sequence does is counted (final review I3). The self-hosted faces swap in with
 * `font-display: swap`, and that swap is a real shift of the slider, the price table and the footer
 * that the sequence did not cause. The window used to open at navigation, so a late swap counted
 * (1 of 5 full runs; 1.3e-4 in a run with font responses held 1200ms). `document.fonts.ready` on
 * its own is not the answer either: awaited after `goto` it resolved 3-7ms *after* the swap's own
 * entry (fonts held 300/1200/3000ms). The window opens two frames after it instead, at `t0`, and
 * only entries starting at or after `t0` count. So that the whole sequence -- frame 0 and the first
 * characters typed -- still falls inside it, the page is served with the band pushed below the
 * fold, where the player never starts, and the pane is scrolled in only once `t0` is taken. A
 * scroll is not a shift, and nothing here is input, so `hadRecentInput` excludes nothing that
 * matters.
 *
 * 518px is where the control's label used to move the page (final review I1): the row it sits in
 * wrapped with "Replay" or "Pause" and fit one line with "Play", and the lead paragraph under it
 * moved 32px each time the label changed. Measured there before the fix: 0.256.
 */
async function sequenceShift(page: import('@playwright/test').Page, width: number) {
  await mockApi(page)
  await page.setViewportSize({ width, height: 900 })
  await page.route((url) => url.pathname === '/', async (route) => {
    const served = await route.fetch()
    const body = (await served.text()).replace('</head>', '<style>body{padding-top:3000px}</style></head>')
    await route.fulfill({ response: served, body })
  })
  await page.goto('/')
  // Hydrated (the control is only shown once motion is allowed), and still the final frame.
  await expect(page.locator('[data-replay]')).toBeVisible()
  await expect(page.locator('[data-typed]')).toHaveText('')

  await page.evaluate(async () => {
    await document.fonts.ready
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
    const w = window as unknown as {
      __t0: number
      __shifts: { start: number; value: number; sources: string[] }[]
      __shiftObserver: PerformanceObserver
    }
    w.__t0 = performance.now()
    w.__shifts = []
    const describe = (n: Node | null | undefined): string => {
      if (!n) return '(detached node)'
      if (!(n instanceof Element)) return n.nodeName
      const cls = n.className ? `.${String(n.className).trim().replace(/\s+/g, '.')}` : ''
      return `${n.tagName.toLowerCase()}${cls}`
    }
    const record = (entries: PerformanceEntryList) => {
      for (const entry of entries) {
        const e = entry as unknown as { startTime: number; value: number; hadRecentInput: boolean; sources?: { node?: Node }[] }
        if (e.hadRecentInput || e.startTime < w.__t0) continue
        w.__shifts.push({ start: e.startTime, value: e.value, sources: (e.sources ?? []).map((s) => describe(s.node)) })
      }
    }
    w.__shiftObserver = new PerformanceObserver((list) => record(list.getEntries()))
    w.__shiftObserver.observe({ type: 'layout-shift', buffered: true })
    // Last, so the whole sequence plays inside the window.
    document.querySelector('tk-pane')!.scrollIntoView({ block: 'start' })
  })

  // Through the whole sequence: typing, submit, tool lines, spinner, the row's wash and credited
  // flash, back to idle -- the control reads Pause as it starts and Replay once it has ended.
  await expect(page.locator('[data-typed]')).not.toHaveText('', { timeout: 5000 })
  await expect(page.locator('[data-replay]')).toHaveText('Replay', { timeout: 15000 })
  // Two frames for the last change to be laid out, then whatever the observer has not yet delivered.
  return page.evaluate(async () => {
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
    const w = window as unknown as {
      __shifts: { start: number; value: number; sources: string[] }[]
      __shiftObserver: PerformanceObserver
      __t0: number
    }
    for (const entry of w.__shiftObserver.takeRecords()) {
      const e = entry as unknown as { startTime: number; value: number; hadRecentInput: boolean }
      if (!e.hadRecentInput && e.startTime >= w.__t0) w.__shifts.push({ start: e.startTime, value: e.value, sources: ['(late record)'] })
    }
    return w.__shifts
  })
}

for (const width of [1280, 518]) {
  test(`the hero sequence causes zero layout shift at ${width}px`, async ({ page }) => {
    const shifts = await sequenceShift(page, width)
    const total = shifts.reduce((sum, s) => sum + s.value, 0)
    const sources = [...new Set(shifts.flatMap((s) => s.sources))]
    expect(total, `layout-shift sources: ${sources.join(', ') || '(none)'}`).toBe(0)
  })
}

/**
 * The control's width does not depend on what it says (final review I1). It sits in a row that
 * wraps, so a label one word wider can push the row to a second line; measured before the fix, at
 * 513-528px the row was 68px with "Replay" or "Pause" and 36px with "Play", and the label changes
 * on its own twice (hydration, and the sequence starting). Each label is reached the way a visitor
 * reaches it rather than written into the DOM, and the row is measured at every width in each.
 */
test('the control row is the same height whatever the control reads', async ({ page }) => {
  await mockApi(page)
  await page.goto('/')
  const control = page.locator('[data-replay]')
  const widths = [375, ...Array.from({ length: 41 }, (_, i) => 480 + i * 2), 1280]
  const sweep = async (expected: string) => {
    const out: Record<number, number> = {}
    for (const width of widths) {
      await page.setViewportSize({ width, height: 900 })
      const seen = await page.evaluate(() => {
        const button = document.querySelector('[data-replay]')!
        return { label: button.textContent!.trim(), row: button.closest('p')!.getBoundingClientRect().height }
      })
      expect(seen.label, `the control changed label mid-sweep, at ${width}px`).toBe(expected)
      out[width] = seen.row
    }
    return out
  }

  await expect(control).toHaveText('Pause', { timeout: 5000 })
  await control.click()
  await expect(control).toHaveText('Play')
  const play = await sweep('Play')
  await control.click()
  await expect(control).toHaveText('Pause')
  const pause = await sweep('Pause')
  await expect(control).toHaveText('Replay', { timeout: 15000 })
  const replay = await sweep('Replay')

  const differ = widths
    .filter((w) => play[w] !== pause[w] || play[w] !== replay[w])
    .map((w) => `${w}px: Play ${play[w]}, Pause ${pause[w]}, Replay ${replay[w]}`)
  expect(differ, 'widths where the row height follows the label').toEqual([])
})

/**
 * Where the caret sits (fix round 2, re-review finding): `.tk-caret` is positioned against the
 * prompt box's own padding edge, and the box carries `px-2 py-1` and a border the caret's anchor
 * did not account for, so it rendered about 8px short of the typed text and 5px high enough to
 * cover the last character rather than sit after it. Measured against `[data-typed]`'s own
 * rendered edge rather than against a hand-copied padding figure, so a future padding change on
 * the box cannot silently reopen this without also moving the number this test compares against.
 * Top-aligned with the typed span (not vertically centred): both are plain inline text on one
 * line, so their line boxes already start at the same y once the caret's anchor is right.
 */
async function caretOffset(page: import('@playwright/test').Page): Promise<{ dx: number; dy: number }> {
  return page.evaluate(() => {
    const typed = document.querySelector('[data-typed]')!.getBoundingClientRect()
    const caret = document.querySelector('[data-caret]')!.getBoundingClientRect()
    return { dx: caret.left - typed.right, dy: caret.top - typed.top }
  })
}

test('the caret sits at the end of the typed text, mid-typing and at the final frame', async ({ page }) => {
  await mockApi(page)
  await page.goto('/')

  // Paused rather than sampled mid-flight: typing keeps moving between the wait above resolving
  // and the measurement below running, and an extra character typed in that gap is a whole
  // ADVANCE_EM off -- Pause freezes `f.typed` so the measurement is of a still target.
  await expect(page.locator('[data-typed]')).toContainText(PROMPT.slice(0, 10), { timeout: 5000 })
  await page.locator('[data-replay]').click()
  await expect(page.locator('[data-replay]')).toHaveText('Play')

  const mid = await caretOffset(page)
  expect(Math.abs(mid.dx), 'caret left vs typed text right, mid-typing (paused)').toBeLessThanOrEqual(1)
  expect(Math.abs(mid.dy), 'caret top vs typed text top, mid-typing (paused)').toBeLessThanOrEqual(1)

  await page.locator('[data-replay]').click()
  await expect(page.locator('[data-replay]')).toHaveText('Replay', { timeout: 15000 })

  const final = await caretOffset(page)
  expect(Math.abs(final.dx), 'caret left vs typed text right, final frame').toBeLessThanOrEqual(1)
  expect(Math.abs(final.dy), 'caret top vs typed text top, final frame').toBeLessThanOrEqual(1)
})

/**
 * The case the sampled test above reaches only by chance (final review I2: 5 of 24 runs). A space
 * typed last is still a column in a terminal, and the caret's shift counts it; the typed span has to
 * keep it too, or the span's edge ends a column short of where the caret is drawn. Pause is clicked
 * in the same animation frame the typed text is first seen ending in a space, and the attempt is
 * repeated if a frame's typing landed between the look and the click.
 */
test('the caret sits after a trailing space, paused on the frame that typed it', async ({ page }) => {
  await mockApi(page)
  await page.goto('/')
  const control = page.locator('[data-replay]')
  await expect(control).toHaveText('Pause', { timeout: 5000 })

  let typed = ''
  for (let attempt = 0; attempt < 6 && !typed.endsWith(' '); attempt++) {
    const caught = await page.evaluate(() => new Promise<boolean>((done) => {
      const look = () => {
        const t = document.querySelector('[data-typed]')!.textContent ?? ''
        if (t.endsWith(' ')) {
          document.querySelector<HTMLButtonElement>('[data-replay]')!.click()
          done(true)
        } else if (t.length === 0 && document.querySelector('[data-sent]:not(.opacity-0)')) done(false)
        else requestAnimationFrame(look)
      }
      look()
    }))
    if (!caught) break
    await expect(control).toHaveText('Play')
    typed = (await page.locator('[data-typed]').textContent()) ?? ''
    if (!typed.endsWith(' ')) {
      await control.click()
      await expect(control).toHaveText('Pause')
    }
  }
  expect(typed, 'never paused on a trailing space, so this proved nothing').toMatch(/ $/)

  const { dx, dy } = await caretOffset(page)
  expect(Math.abs(dx), `caret left vs typed text right, paused after "${typed}"`).toBeLessThanOrEqual(1)
  expect(Math.abs(dy), 'caret top vs typed text top, paused after a space').toBeLessThanOrEqual(1)
})

test('the caret sits at the end of the typed text under reduced motion', async ({ page }) => {
  await mockApi(page)
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto('/')

  // The final frame, served at once: nothing typed, so `[data-typed]` is an empty box and the
  // caret should sit right at its start, which is also its end.
  await expect(page.locator('[data-typed]')).toHaveText('')
  const { dx, dy } = await caretOffset(page)
  expect(Math.abs(dx), 'caret left vs typed text right, reduced motion').toBeLessThanOrEqual(1)
  expect(Math.abs(dy), 'caret top vs typed text top, reduced motion').toBeLessThanOrEqual(1)
})

test('the sequence waits until the pane is in view', async ({ page }) => {
  await mockApi(page)
  await page.setViewportSize({ width: 1280, height: 220 })
  await page.goto('/')
  await page.waitForTimeout(2500)
  // Still the final frame: nothing typed, the counters already moved.
  await expect(page.locator('[data-typed]')).toHaveText('')
  await expect(heroRow(page)).toContainText('today 4/')
  await page.locator('tk-pane').scrollIntoViewIfNeeded()
  await expect(page.locator('[data-typed]')).toContainText(PROMPT.slice(0, 10), { timeout: 5000 })
})

test('Pause stops the clock and Play resumes it', async ({ page }) => {
  await mockApi(page)
  await page.goto('/')
  const spinner = page.locator('[data-spinner]')
  await expect(spinner).toContainText('(1s)', { timeout: 6000 })
  await page.locator('[data-replay]').click()
  await expect(page.locator('[data-replay]')).toHaveText('Play')
  const held = await spinner.innerText()
  await page.waitForTimeout(1500)
  expect(await spinner.innerText(), 'the spinner kept counting while paused').toBe(held)
  await page.locator('[data-replay]').click()
  await expect(page.locator('[data-replay]')).toHaveText('Pause')
  await expect(spinner).not.toHaveText(held, { timeout: 3000 })
})

test('a drag during the sequence stops it on the question', async ({ page }) => {
  await mockApi(page)
  await page.goto('/')
  await expect(page.locator('[data-typed]')).toContainText(PROMPT.slice(0, 5), { timeout: 5000 })
  await page.locator('[data-cols]').fill('110')
  await expect(heroRow(page)).toContainText(HERO_STUDY.sponsor)
  await expect(page.locator('[data-replay]')).toHaveText('Replay')
  await page.waitForTimeout(4000)
  await expect(heroRow(page), 'the sequence carried on over the drag').toContainText(HERO_STUDY.sponsor)
})

test('Replay plays it again from the start', async ({ page }) => {
  await mockApi(page)
  await page.goto('/')
  await expect(page.locator('[data-replay]')).toHaveText('Replay', { timeout: 15000 })
  await page.locator('[data-replay]').click()
  await expect(heroRow(page)).toContainText('today 3/')
  await expect(heroRow(page)).toContainText(HERO_STUDY.sponsor, { timeout: 8000 })
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
  await expect(page.getByRole('link', { name: /Ask AI-native developers while/ })).toBeVisible()
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
