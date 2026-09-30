/**
 * Every screen behind a session, swept for measure — the gap R369 wrote down.
 *
 * R369 moved the 68ch claim off source and into the browser, and covered the eight
 * pages a signed-out visitor can reach. The other fourteen were checked by hand
 * against a live stack, which found the `/admin` policy line and `tk-empty`'s
 * sentence and then stopped being a check at all: a hand sweep is not run again.
 *
 * So the mock answers for all three principals at once. No route redirects a
 * signed-in principal away from anything — `auth.ts`'s guards redirect on a 401 and
 * nothing else, and neither login page carries a guard — so one session set reaches
 * every screen, login forms included.
 *
 * **What makes this a sweep rather than a green light** is the second half of each
 * visit. The measure check passes by finding nothing, so a screen that rendered its
 * failure rung, or nothing at all, passes it loudly. Three things are therefore
 * asserted per screen: no `tk-async` is showing `data-load-failed`, none is still on
 * `data-loading`, and the mock was never asked for a path it has no answer for. A
 * fixture this file gets wrong shows up as a failed rung on the screen that reads it,
 * not as a clean sweep.
 */
import { expect, test, type Page } from '@playwright/test'
import { LIVE_STUDY, STUDY_ID, mockApi } from './mock-api'
import { longProseCount, proseOverMeasure } from './measure'

/**
 * A failed load, however the screen chose to say so.
 *
 * The first version of this read two data attributes, `data-load-failed` and
 * `data-loading`, which is what `tk-async` emits — and three of the fourteen screens
 * say it some other way and keep their heading, so all three guards passed on a
 * screen that had rendered nothing it was swept for: `/admin/invariants` marks its
 * own banner `data-check-failed`, and `/dev/settings` and `/app/studies/new` mark
 * theirs with nothing at all. The vacuity count did not save it either — the static
 * prose above each banner still renders, so the screen never looked silent.
 *
 * What all three do have in common is the thing a person actually sees: a banner in
 * the error tone. So the detector reads the tone, which also means a screen written
 * next year is covered without anyone adding it to a list.
 *
 * Keyed on the fill `ui/banner.ts` paints for `tone="error"`. That is a class name
 * and class names get renamed, which would leave this matching nothing and saying so
 * cheerfully — which is why `the failure detector fires` below is a test and not a
 * comment.
 */
const ERROR_TONE = 'tk-banner.bg-rejected-bg'

/**
 * The one banner in that tone which is not a failure, and the direction of this list
 * is the decision worth recording.
 *
 * `/admin/invariants` paints its problem list in the error tone because a ledger that
 * does not add up is the most urgent thing this product can say — and it is *news*,
 * not a broken page. The sweep's fixture makes the ledger report a problem on purpose,
 * so that the problem list renders and the cap on it is actually measured.
 *
 * So the exceptions are the content, not the failures. A screen added next year that
 * fails is caught with nobody adding it to anything; a screen that paints content in
 * this tone shows up here and has to be named out loud. Only one of those two
 * directions can go quietly wrong, and it is not this one.
 */
const CONTENT_IN_THE_ERROR_TONE = '[data-problems]'

/** Still loading, in either of the two vocabularies the screens use. */
const LOADING = '[data-loading],[data-checking]'

function errorBanners(page: Page): Promise<string[]> {
  return page.$$eval(
    ERROR_TONE,
    (els, content) =>
      els.filter((e) => !e.matches(content as string)).map((e) => (e.textContent ?? '').trim().slice(0, 60)),
    CONTENT_IN_THE_ERROR_TONE,
  )
}

/**
 * The fourteen. `/app/login` and `/admin/login` are here although no session is
 * needed to see them: they are screens in the product, and the sweep is of screens.
 */
const SCREENS = [
  '/app/login',
  '/app',
  '/app/studies/new',
  `/app/studies/${STUDY_ID}`,
  '/app/credits',
  '/dev',
  '/dev/settings',
  '/admin/login',
  '/admin',
  '/admin/developers',
  '/admin/payouts',
  '/admin/system-studies',
  '/admin/invariants',
  '/error',
]

test('no prose on any screen behind a session runs past the measure', async ({ page }) => {
  const api = await mockApi(page, {
    signedIn: true,
    devSignedIn: true,
    adminSignedIn: true,
    studies: [LIVE_STUDY],
  })

  const over: string[] = []
  const prose: Array<[string, number]> = []
  for (const path of SCREENS) {
    await page.goto(path)
    await page.waitForSelector('h1')
    // The data rung, polled: these screens fetch after they mount, and reading
    // straight after `goto` measures the loading state — which is one short line and
    // sweeps clean. R369's own vacuity check raced hydration the same way.
    await expect
      .poll(() => page.locator(LOADING).count(), { message: `${path} never left the loading rung` })
      .toBe(0)
    expect(await errorBanners(page), `${path} says a load failed, so nothing on it was really swept`).toEqual([])

    over.push(...(await proseOverMeasure(page, path)))
    prose.push([path, await longProseCount(page)])
  }

  expect(over.sort(), 'prose past the measure, measured where it renders').toEqual([])

  // Every request these fourteen screens made was answered. A page that asked for
  // something this mock has no branch for renders an error instead of a screen, and
  // an error page has no prose to be over the measure.
  expect(api.unhandled.sort(), 'a screen asked for something the mock has no answer for').toEqual([])

  // And prose was actually found. Not a total across the sweep, which one wordy
  // admin page would satisfy on its own: the screens that carry a paragraph have to
  // each carry one, so a screen going blank is a failure here rather than a silence.
  const silent = prose.filter(([, n]) => n === 0).map(([path]) => path)
  expect(silent, 'these screens rendered no prose at all, so the sweep proved nothing about them').toEqual([
    // Filled in from the first run, not guessed: a screen with no run of prose over
    // 70 characters is a legitimate screen, and naming them is what keeps the list
    // from quietly growing.
  ])
})

/**
 * The detector's own test, and it exists because the detector is one class name.
 *
 * A guard that passes by finding nothing has to be shown finding something, or a
 * renamed token turns it off silently and every sweep above goes on reporting clean
 * (R99). One endpoint is failed per *way a screen says it failed*, because that is
 * the axis the first version of this guard got wrong — not per screen.
 */
test('the failure detector fires on each of the three ways a screen says a load failed', async ({ page }) => {
  const styles: Array<[string, string, string]> = [
    // tk-async's own rung, which is what the first version read and the only one it read.
    ['/admin/payouts', '/api/admin/payouts/batches', 'data-load-failed'],
    // A page that marks its banner with its own name instead.
    ['/admin/invariants', '/api/admin/invariants', 'data-check-failed'],
    // And a banner with no attribute on it at all.
    ['/dev/settings', '/api/dev/web/data', 'no attribute'],
  ]
  for (const [path, endpoint, how] of styles) {
    await page.unrouteAll()
    await mockApi(page, {
      signedIn: true,
      devSignedIn: true,
      adminSignedIn: true,
      studies: [LIVE_STUDY],
      failing: [endpoint],
    })
    await page.goto(path)
    await page.waitForSelector('h1')
    await expect
      .poll(() => errorBanners(page), { message: `${path} failed as "${how}" and the detector did not see it` })
      .not.toEqual([])
  }
})

test('the buyer empty state is swept too, and it is where tk-empty speaks', async ({ page }) => {
  // The third of R369's violations was `tk-empty`'s sentence, which exists only when
  // there is nothing to show — so a sweep of populated screens is exactly the sweep
  // that cannot see it. `state.studies` is the array the handler reads, so emptying
  // it here is the same server answering differently.
  const api = await mockApi(page, { signedIn: true, studies: [LIVE_STUDY] })
  api.studies.length = 0
  await page.goto('/app')
  await page.waitForSelector('h1')
  await expect(page.locator('[data-empty]')).toBeVisible()

  expect(await proseOverMeasure(page, '/app (empty)'), 'the empty state says a sentence too').toEqual([])
  expect(await longProseCount(page), 'no prose in the empty state, so this proved nothing').toBeGreaterThan(0)
})
