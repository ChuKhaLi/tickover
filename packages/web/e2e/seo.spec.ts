/**
 * What a crawler reads, pinned on the bytes the static server returns (R400, R401).
 *
 * Everything that asks about the document goes through `request`, never `page`: after boot the SPA
 * rewrites the head and the body, so a `page` assertion passes whichever document was served (the
 * same reasoning as public.spec.ts's document test). The two console tests are the exception, and
 * are about the browser on purpose.
 */
import { test, expect, type APIRequestContext } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { PAGE_META } from '../src/app/lib/page-meta'
import { mockApi } from './mock-api'
// The five-question fixture Task 3 created, which the Lighthouse runner also serves.
import { AGGREGATES_FIXTURE } from './fixtures/aggregates'

// Reused by the later SEO tasks, so it is exported rather than local.
export async function raw(
  request: APIRequestContext,
  path: string,
): Promise<{ status: number; html: string; doc: Document; headers: Record<string, string> }> {
  const res = await request.get(path)
  const html = await res.text()
  const { JSDOM } = await import('jsdom')
  return { status: res.status(), html, doc: new JSDOM(html).window.document, headers: res.headers() }
}

// The h1 text of each page, copied from the page sources (`grep -n "<h1" src/app/pages`). Read
// from the built page it would be circular.
const H1: Record<string, string> = {
  '/': 'This line is the product.',
  '/developers': 'Get paid to answer one question while Claude works',
  '/buyers': 'Ask AI-native developers while their agent works',
  '/data': 'What AI-native developers say',
  '/privacy': 'Privacy',
  '/terms/developers': 'Developer terms',
  '/terms/buyers': 'Buyer terms',
}

test('the h1 map covers every public route', () => {
  expect(Object.keys(H1).sort()).toEqual(Object.keys(PAGE_META).sort())
})

for (const [route, text] of Object.entries(H1)) {
  test(`${route} ships its h1 in the document itself`, async ({ request }) => {
    const { doc } = await raw(request, route)
    expect(doc.querySelector('h1')?.textContent?.trim()).toBe(text)
  })
}

// Task 9, R410: both headings below the fold on `/` were tried under `@defer (hydrate on
// viewport)` and vanished from the served bytes entirely -- the framework's own internal flag for
// "this pass is a server render" never read true for those two blocks in this build, the same gap
// R407 found in `afterNextRender`'s own guard, but this time inside compiled framework output a
// page cannot add a guard to (captured: `_debug_node-chunk.mjs`'s hydrate-trigger checks carried
// zero occurrences of the flag's name in the built bundle, folded away before any runtime value
// could reach them). The wrap was reverted rather than shipped with silently missing copy. This
// pins the two headings into the raw response so a future reintroduction of that wrapper, on this
// route or a new one, goes red on the bytes rather than only in a browser tab someone happens to
// scroll all the way down.
const H2_BELOW_FOLD: Record<string, string[]> = {
  '/': ['Earn while Claude thinks', 'Ask AI-native developers while their agent works'],
}

for (const [route, headings] of Object.entries(H2_BELOW_FOLD)) {
  test(`${route} ships its below-the-fold headings in the document itself`, async ({ request }) => {
    const { doc } = await raw(request, route)
    const seen = [...doc.querySelectorAll('h2')].map((h) => h.textContent?.trim())
    for (const heading of headings) expect(seen, route).toContain(heading)
  })
}

// Every kind of URL that is not prerendered: a buyer deep link, the developer area, admin, and an
// address that is no page at all (the soft 404).
for (const path of ['/app/studies/00000000-0000-0000-0000-000000000000', '/dev', '/dev/earnings', '/admin', '/no-such-page']) {
  test(`${path} gets the unrendered shell, marked noindex`, async ({ request }) => {
    const { doc } = await raw(request, path)
    expect(doc.querySelector('tk-root')?.children.length, path).toBe(0)
    expect(doc.querySelector('meta[name="robots"]')?.getAttribute('content'), path).toBe('noindex')
  })
}

test('no public route is noindex', async ({ request }) => {
  for (const route of Object.keys(PAGE_META)) {
    const { doc } = await raw(request, route)
    expect(doc.querySelector('meta[name="robots"]'), route).toBeNull()
  }
})

test('the app shell boots with no hydration error in the console', async ({ page }) => {
  // /app/login asks for the buyer principal at boot; unanswered, that is a console error that
  // has nothing to do with hydration.
  await mockApi(page, { signedIn: false })
  const errors: string[] = []
  page.on('console', (m) => { if (m.type() === 'error' || /NG05\d\d/.test(m.text())) errors.push(m.text()) })
  await page.goto('/app/login')
  await expect(page.locator('h1')).toBeVisible()
  expect(errors).toEqual([])
})

test('a prerendered page carries hydration annotations', async ({ request }) => {
  // `ngh` attributes are written by the server render only when hydration is provided; captured at
  // 0 in the throwaway build that lacked it.
  const { html } = await raw(request, '/')
  expect(html).toMatch(/\bngh="/)
})

test('a prerendered page hydrates with no console error', async ({ page }) => {
  const errors: string[] = []
  page.on('console', (m) => { if (m.type() === 'error' || /NG05\d\d/.test(m.text())) errors.push(m.text()) })
  await page.goto('/')
  await expect(page.locator('h1')).toHaveText('This line is the product.')
  await page.waitForLoadState('networkidle')
  expect(errors).toEqual([])
})

// R400: /data used to fetch in its constructor, which runs during prerender too, and baked
// "Couldn't load the latest numbers" into the static HTML — captured on the throwaway build. These
// watch that the build never touches the network and that the reserved frame keeps the page from
// jumping once the browser's own fetch lands (spike measured CLS 0.604 on a Lighthouse mobile run).
test('/data is built with placeholders, not with a failure it met at build time', async ({ request }) => {
  const { doc, html } = await raw(request, '/data')
  // Five, the number of questions production serves: fewer reserves too little space and the data
  // still shifts the page when it arrives.
  expect(doc.querySelectorAll('[data-aggregates-placeholder] > *')).toHaveLength(5)
  expect(html).not.toContain("Couldn't load the latest numbers")
  expect(html).not.toContain('No data yet.')
})

// Whole-branch review: the placeholder cards are aria-hidden and carry no text, so a slow first
// load or a hung API told nobody -- sighted or not -- that anything was happening at all. This has
// to be prerendered too, since the build-time HTML (asserted through `request`, never `page`, for
// the same reason as every other test in this file) is the loading state every crawler and every
// cold visitor's first paint sees, before the browser's own fetch has even started.
test('/data is built announcing the loading state, not just five silent boxes', async ({ request }) => {
  const { doc } = await raw(request, '/data')
  const status = doc.querySelector('[role="status"]')
  expect(status?.textContent).toContain('Loading the latest numbers')
  // Outside the placeholder element, so the test above's `[data-aggregates-placeholder] > *`
  // count -- exactly five, the with-data e2e's own contract for "the real rows arrived" -- still
  // counts only the reserved cards, not the announcement alongside them.
  expect(doc.querySelectorAll('[data-aggregates-placeholder] > *')).toHaveLength(5)
})

test('/data with the API down says so after hydration, without shifting the page', async ({ page }) => {
  await page.route('**/api/public/aggregates', (r) => r.fulfill({ status: 502, body: '' }))
  await page.goto('/data')
  await expect(page.getByText("Couldn't load the latest numbers. Try again shortly.")).toBeVisible()
  const cls = await page.evaluate(() => new Promise<number>((ok) => {
    let sum = 0
    new PerformanceObserver((l) => { for (const e of l.getEntries() as unknown as { value: number; hadRecentInput: boolean }[]) if (!e.hadRecentInput) sum += e.value })
      .observe({ type: 'layout-shift', buffered: true })
    setTimeout(() => ok(sum), 500)
  }))
  expect(cls).toBeLessThanOrEqual(0.1)
})

for (const viewport of [{ width: 375, height: 667 }, { width: 1280, height: 720 }]) {
  test(`/data with data keeps CLS within 0.1 at ${viewport.width}px`, async ({ page }) => {
    await page.setViewportSize(viewport)
    await page.route('**/api/public/aggregates', (r) => r.fulfill({ json: AGGREGATES_FIXTURE }))
    await page.goto('/data')
    await expect(page.locator('section[tk-card]')).toHaveCount(5)
    const cls = await page.evaluate(() => new Promise<number>((ok) => {
      let sum = 0
      new PerformanceObserver((l) => { for (const e of l.getEntries() as unknown as { value: number; hadRecentInput: boolean }[]) if (!e.hadRecentInput) sum += e.value })
        .observe({ type: 'layout-shift', buffered: true })
      setTimeout(() => ok(sum), 500)
    }))
    expect(cls).toBeLessThanOrEqual(0.1)
  })
}

// The browser-side half of the announcement test above: present while the fetch is genuinely
// pending, gone once the real cards land. The route is held for a beat so there is a real window
// to observe "present", rather than asserting a state that a same-tick mock could race past.
test('the loading announcement is read out while pending and clears once the numbers arrive', async ({ page }) => {
  await page.route('**/api/public/aggregates', async (r) => {
    await new Promise((ok) => setTimeout(ok, 300))
    await r.fulfill({ json: AGGREGATES_FIXTURE })
  })
  await page.goto('/data')
  await expect(page.getByRole('status')).toHaveText(/Loading the latest numbers/)
  await expect(page.locator('section[tk-card]')).toHaveCount(5)
  await expect(page.getByRole('status')).toHaveCount(0)
})

// Watches the handover itself: the server sends the placeholder, the browser's own fetch replaces
// it, and a mismatch between the two would surface as a hydration error rather than as a layout
// number. `section[tk-card]` (not the placeholder's own divs, which never carry that selector) is
// how this tells "the real rows arrived" from "the reserved frame is still up".
test('/data with data hydrates with no console error and no NG05xx message', async ({ page }) => {
  const errors: string[] = []
  page.on('console', (m) => { if (m.type() === 'error' || /NG05\d\d/.test(m.text())) errors.push(m.text()) })
  await page.route('**/api/public/aggregates', (r) => r.fulfill({ json: AGGREGATES_FIXTURE }))
  await page.goto('/data')
  await expect(page.locator('section[tk-card]')).toHaveCount(5)
  expect(errors).toEqual([])
})

// Spec §2: one Seo service writes the head, in the build-time render and on every navigation.

// Written out, not imported: an expectation built from SITE_URL moves with the build it is checking,
// so pointing SITE_URL at the wrong origin changes both sides and stays green (found in review).
const ORIGIN = 'https://tickover.dev'

test('every public route names itself canonical, in the bytes a crawler reads', async ({ request }) => {
  for (const [route, m] of Object.entries(PAGE_META)) {
    const { doc } = await raw(request, route)
    const want = `${ORIGIN}${route === '/' ? '/' : route}`
    expect(doc.querySelectorAll('link[rel="canonical"]'), route).toHaveLength(1)
    expect(doc.querySelector('link[rel="canonical"]')?.getAttribute('href'), route).toBe(want)
    expect(doc.querySelector('meta[property="og:image"]')?.getAttribute('content'), route).toBe(`${ORIGIN}/og.png`)
    expect(doc.querySelector('meta[name="twitter:card"]')?.getAttribute('content'), route).toBe('summary_large_image')
    expect(doc.title, route).toBe(m.title)
    expect(doc.querySelector('meta[name="description"]')?.getAttribute('content'), route).toBe(m.description)
    expect(doc.querySelectorAll('script[type="application/ld+json"]').length, route).toBe(route === '/' ? 1 : 0)
  }
})

/**
 * A marker on `window` survives a client-side navigation and is gone after a document load. Without
 * it, both navigation tests below could pass on a full page load: the server-rendered /buyers head is
 * already right, and shell.html already carries noindex and no canonical. A Seo service that never
 * ran in the browser would then stay green (review finding I5).
 */
async function hydrated(page: import('@playwright/test').Page, path: string) {
  await page.goto(path)
  await page.waitForLoadState('networkidle')
  await page.evaluate(() => { (window as unknown as { __spa: number }).__spa = 1 })
}
const stillSameDocument = (page: import('@playwright/test').Page) =>
  page.evaluate(() => (window as unknown as { __spa?: number }).__spa === 1)

test('client navigation from / to /buyers carries the head with it', async ({ page }) => {
  await hydrated(page, '/')
  await page.getByRole('link', { name: 'For buyers' }).first().click()
  await expect(page).toHaveURL(/\/buyers$/)
  expect(await stillSameDocument(page), 'the click loaded a new document; nothing was tested').toBe(true)
  const m = PAGE_META['/buyers']!
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', `${ORIGIN}/buyers`)
  await expect(page.locator('meta[property="og:url"]')).toHaveAttribute('content', `${ORIGIN}/buyers`)
  await expect(page.locator('meta[property="og:title"]')).toHaveAttribute('content', m.title)
  await expect(page.locator('meta[name="description"]')).toHaveAttribute('content', m.description)
  await expect(page.locator('script[type="application/ld+json"]')).toHaveCount(0)
})

test('navigating into the app marks the screen noindex', async ({ page }) => {
  await hydrated(page, '/')
  // The landing page's own link (index.page.ts:70); copy its accessible name from the source.
  await page.getByRole('link', { name: 'Buyer sign in' }).first().click()
  await expect(page).toHaveURL(/\/app\/login$/)
  expect(await stillSameDocument(page), 'the click loaded shell.html, which is noindex already').toBe(true)
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', 'noindex')
  await expect(page.locator('link[rel="canonical"]')).toHaveCount(0)
})

// Task 8, Review Focus 2: the document revalidates on every request, so a redeploy is seen
// immediately, while the hashed script it names is cached for a year because its name changes
// whenever its content does. Reads the script's own URL out of the served document rather than
// guessing a filename, so a hash change in a future build does not make this pass by accident.
test('/ revalidates and the hashed script it names is cached immutably', async ({ request }) => {
  const { headers, doc } = await raw(request, '/')
  expect(headers['cache-control']).toBe('no-cache')
  const src = doc.querySelector('script[type="module"]')?.getAttribute('src')
  expect(src, 'no <script type="module" src> in the served document').toBeTruthy()
  const script = await raw(request, src!)
  expect(script.headers['cache-control']).toBe('public, max-age=31536000, immutable')
})

// Task 7: og.png, logo-512.png, robots.txt, the sitemap and llms.txt. Static files, so the
// channel that matters is the one a crawler actually uses -- the bytes and headers this
// server answers with -- not the source tree `public-files.spec.ts` reads directly.

test('robots.txt is served as a text file, not the app shell', async ({ request }) => {
  const res = await request.get('/robots.txt')
  expect(res.headers()['content-type']).toMatch(/^text\/plain/)
  expect(await res.text()).not.toContain('<tk-root')
})

test('the sitemap lists exactly the prerendered routes, at the canonical origin', async ({ request }) => {
  const res = await request.get('/sitemap.xml')
  expect(res.status()).toBe(200)
  expect(res.headers()['content-type']).toMatch(/^application\/xml/)
  const xml = await res.text()
  // The protocol namespace is http://, and Analog's generator writes https:// (review M3).
  expect(xml).toContain('xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"')
  // Exact strings, no slash normalisation: each <loc> must be byte-identical to that page's canonical.
  const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]!).sort()
  const want = Object.keys(PAGE_META).map((r) => `${ORIGIN}${r === '/' ? '/' : r}`).sort()
  expect(locs).toEqual(want)
})

test('og.png and logo-512.png are served as images', async ({ request }) => {
  for (const f of ['/og.png', '/logo-512.png']) {
    const res = await request.get(f)
    expect(res.headers()['content-type'], f).toBe('image/png')
  }
})

test('llms.txt is served as a text file and names every public route at the canonical origin', async ({ request }) => {
  const res = await request.get('/llms.txt')
  expect(res.headers()['content-type']).toMatch(/^text\/plain/)
  const text = await res.text()
  for (const route of Object.keys(PAGE_META)) {
    expect(text, route).toContain(`${ORIGIN}${route === '/' ? '/' : route}`)
  }
})

// Task 9: an axe scan of the rendered, hydrated document for every public route. wcag22aa is the
// widest tag set axe-core 4.10 ships, so this is the floor the accessibility skill describes, not a
// substitute for the keyboard pass done by hand (recorded in the task report).
//
// Fix round 1: `page.locator('h1').waitFor()` was the wait here, and an h1 is in the prerendered
// bytes -- present before a single line of client script has run, per the raw-bytes tests above --
// so that wait let the scan start on the pre-hydration document, the same channel gap the plan's
// review focus keeps naming. `hydrated()` (below) is this file's own post-hydration signal
// (`networkidle`), reused rather than re-invented. `/data` additionally never had its one API call
// mocked, so its scan ran against whatever the loading or failure rung happened to be when the
// network settled -- never against the five real cards a visitor reaches. It is mocked and waited
// for here exactly as `/data with data hydrates...` above does, so this scans the state a visitor
// actually meets.
for (const route of Object.keys(PAGE_META)) {
  test(`${route} has no axe violations`, async ({ page }) => {
    if (route === '/data') await page.route('**/api/public/aggregates', (r) => r.fulfill({ json: AGGREGATES_FIXTURE }))
    await hydrated(page, route)
    if (route === '/data') await expect(page.locator('section[tk-card]')).toHaveCount(5)
    const { violations } = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze()
    expect(violations.map((v) => `${v.id}: ${v.nodes.length}`)).toEqual([])
  })
}
