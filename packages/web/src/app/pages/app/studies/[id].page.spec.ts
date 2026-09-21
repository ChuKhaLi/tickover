import { TestBed } from '@angular/core/testing'
import { provideHttpClient } from '@angular/common/http'
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing'
import { provideLocationMocks } from '@angular/common/testing'
import { ActivatedRoute, provideRouter } from '@angular/router'
import { BehaviorSubject, of, type Observable } from 'rxjs'
import { afterEach, describe, it, expect, vi } from 'vitest'
import { AuthState, buyerGuard } from '../../../lib/auth'
import { SITE_NAME } from '../../../lib/page-meta'
import StudyPage, { POLL_INTERVAL_MS, routeMeta } from './[id].page'

const ID = '8f0b0f2e-6f6a-4a3a-9c1f-0f1e2d3c4b5a'
const Q = '11111111-1111-4111-8111-111111111111'
const Q2 = '44444444-4444-4444-8444-444444444444'
const OTHER = '33333333-3333-4333-8333-333333333333'
const STUDY_URL = `/api/buyer/studies/${ID}`
const RESULTS_URL = `${STUDY_URL}/results`
const CSV_URL = `${STUDY_URL}/results.csv`
const OTHER_URL = `/api/buyer/studies/${OTHER}`

const params = (id: string) => new Map([['id', id]])

/** What a withheld breakdown looks like on the wire: four segments, all empty. */
const EMPTY_BREAKDOWN = { primary_language: {}, country: {}, activity_tier: {}, os: {} }

const study = (over: Record<string, unknown> = {}) => ({
  id: ID, kind: 'paid', state: 'settled', title: 'Tagline test', sponsor: 'Acme', price_cents: 100, developer_cents: 50, at_cost: false,
  target_count: 100, respondents_completed: 100, hold_cents: 0, charged_cents: 9800, refunded_cents: 200, targeting: null,
  questions: [{ id: Q, position: 0, text: 'Which tagline?', options: ['Fast', 'Cached'], context: null }],
  review_note: null, created_at: '2026-09-10T10:00:00.000Z', live_at: '2026-09-10T11:00:00.000Z', closed_at: '2026-09-12T11:00:00.000Z', ...over,
})

const results = (over: Record<string, unknown> = {}) => ({
  study_id: ID, respondents_completed: 100, valid_responses: 98, breakdown_state: 'available',
  questions: [{
    question_id: Q, position: 0, text: 'Which tagline?', options: ['Fast', 'Cached'], counts: [60, 38],
    breakdown: { primary_language: { typescript: [40, 20], python: [20, 18] }, country: {}, activity_tier: {}, os: {} },
  }], ...over,
})

/** A study still running: totals live, breakdown withheld, exactly as the server sends it. */
const liveResults = (completed: number, counts: number[]) => ({
  study_id: ID, respondents_completed: completed, valid_responses: completed, breakdown_state: 'withheld_until_settled',
  questions: [{ question_id: Q, position: 0, text: 'Which tagline?', options: ['Fast', 'Cached'], counts, breakdown: EMPTY_BREAKDOWN }],
})

const BUYER = { id: '22222222-2222-4222-8222-222222222222', email: 'pm@acme.test', org: null, credit_cents: 5000, first_study_used: false }

/** One macrotask drains every pending microtask; `whenStable()` alone does not. */
async function settle(fixture: { whenStable(): Promise<unknown>; detectChanges(): void }) {
  await fixture.whenStable()
  await new Promise((ok) => setTimeout(ok, 0))
  fixture.detectChanges()
}

/** The same drain, for a fixture that has already been destroyed and cannot be repainted. */
const drain = () => new Promise((ok) => setTimeout(ok, 0))

/**
 * Only `setInterval` is faked. `settle` above waits on a real `setTimeout` and so
 * does Angular's zoneless scheduler; faking those too leaves the fixture waiting
 * on a clock the test is the only thing that can advance.
 */
function fakeInterval(): void {
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
}

function mount(paramMap: Observable<Map<string, string>> = of(params(ID))) {
  TestBed.resetTestingModule()
  TestBed.configureTestingModule({
    providers: [
      provideHttpClient(), provideHttpClientTesting(), provideLocationMocks(), provideRouter([]),
      // `paramMap` is a `Map`, so the page has to read the id with `get('id')` —
      // the one method `ParamMap` and `Map` share.
      { provide: ActivatedRoute, useValue: { paramMap } },
    ],
  })
  const auth = TestBed.inject(AuthState)
  auth.buyer.set(BUYER)
  const fixture = TestBed.createComponent(StudyPage)
  fixture.detectChanges()
  const el = fixture.nativeElement as HTMLElement
  return { fixture, auth, el, http: TestBed.inject(HttpTestingController), text: () => el.textContent ?? '' }
}

/** Mounts and answers the opening pair. `r` of `null` is a study that asks for no results. */
async function open(s: Record<string, unknown> = study(), r: Record<string, unknown> | null = results()) {
  const m = mount()
  m.http.expectOne(STUDY_URL).flush(s)
  await settle(m.fixture)
  if (r !== null) {
    m.http.expectOne(RESULTS_URL).flush(r)
    await settle(m.fixture)
  }
  return m
}

const hrefs = (el: HTMLElement) => Array.from(el.querySelectorAll('a'), (a) => a.getAttribute('href') ?? '')
const submitButton = (el: HTMLElement) => Array.from(el.querySelectorAll('button')).find((b) => b.textContent?.includes('Submit for review'))

describe('StudyPage', () => {
  afterEach(() => { vi.useRealTimers() })

  // The brief's test, with two changes. `breakdown_state` is required by
  // `StudyResults`, and without it `ApiService.results` rejects on the zod parse
  // before the page sees anything; and `settle` replaces the bare `whenStable()`,
  // which lands while the page still says "Loading…".
  it('renders header, progress, results bars, breakdown, and the csv link', async () => {
    const m = await open()
    const text = m.text()
    expect(text).toContain('Tagline test')
    expect(text).toContain('100 / 100')
    expect(text).toContain('Charged $98.00')
    expect(text).toContain('Refunded $2.00')
    expect(text).toContain('61%')
    expect(text).toContain('typescript')
    expect(m.el.querySelector(`a[href="${CSV_URL}"]`)).not.toBeNull()
  })

  // ---------------------------------------------------------------------------
  // The channel. CLAUDE.md records a test on this repo that asserted through a
  // live HTTP GET while the bug lived on the SSE stream, and this is the page
  // whose promise is that responses appear as they land. The figures below are
  // never re-mounted and the route never changes: every request after the first
  // render is issued by the poll, and `expectNone` before each tick is what makes
  // that true rather than assumed.
  // ---------------------------------------------------------------------------
  it('shows responses arriving on the poll itself, with no reload and no second visit', async () => {
    fakeInterval()
    const m = await open(study({ state: 'live', respondents_completed: 12, charged_cents: 0, hold_cents: 10000 }), liveResults(12, [8, 4]))
    expect(m.text()).toContain('12 / 100')
    expect(m.text()).toContain('67%')

    // Nothing is in flight, so whatever the page shows next cannot have come from
    // a request already outstanding when the assertions above were made.
    m.http.expectNone(STUDY_URL)
    m.http.expectNone(RESULTS_URL)
    // One millisecond short of the interval, still nothing: the update below is
    // the timer firing, not some other effect that happened to be pending.
    vi.advanceTimersByTime(POLL_INTERVAL_MS - 1)
    m.http.expectNone(STUDY_URL)

    vi.advanceTimersByTime(1)
    m.http.expectOne(STUDY_URL).flush(study({ state: 'live', respondents_completed: 37, charged_cents: 0, hold_cents: 10000 }))
    await settle(m.fixture)
    m.http.expectOne(RESULTS_URL).flush(liveResults(37, [30, 7]))
    await settle(m.fixture)
    expect(m.text(), 'the progress did not move without a reload').toContain('37 / 100')
    expect(m.text(), 'the option bars did not move without a reload').toContain('81%')

    // A second tick, because a one-shot `setTimeout` passes everything above and
    // then stops for ever — which is a page that updates once and looks live.
    vi.advanceTimersByTime(POLL_INTERVAL_MS)
    m.http.expectOne(STUDY_URL).flush(study({ state: 'live', respondents_completed: 90, charged_cents: 0, hold_cents: 10000 }))
    await settle(m.fixture)
    m.http.expectOne(RESULTS_URL).flush(liveResults(90, [45, 45]))
    await settle(m.fixture)
    expect(m.text()).toContain('90 / 100')
    expect(m.text()).toContain('50%')
  })

  // A finished study cannot gain a respondent, so polling it is a request per ten
  // seconds per open tab that can only ever return the same bytes.
  it('does not poll a study that has finished', async () => {
    fakeInterval()
    const m = await open(study({ state: 'settled' }), results())
    vi.advanceTimersByTime(POLL_INTERVAL_MS * 3)
    m.http.expectNone(STUDY_URL)
    m.http.expectNone(RESULTS_URL)
  })

  // The poll has to stop itself when the study it was watching stops being live,
  // without the buyer touching anything.
  it('stops polling once the study it is watching closes', async () => {
    fakeInterval()
    const m = await open(study({ state: 'live', respondents_completed: 99 }), liveResults(99, [60, 39]))
    vi.advanceTimersByTime(POLL_INTERVAL_MS)
    m.http.expectOne(STUDY_URL).flush(study({ state: 'closed', respondents_completed: 100 }))
    await settle(m.fixture)
    m.http.expectOne(RESULTS_URL).flush(liveResults(100, [61, 39]))
    await settle(m.fixture)
    expect(m.text()).toContain('closed')

    vi.advanceTimersByTime(POLL_INTERVAL_MS * 3)
    m.http.expectNone(STUDY_URL)
  })

  it('stops polling when the buyer leaves the page', async () => {
    fakeInterval()
    const m = await open(study({ state: 'live' }), liveResults(12, [8, 4]))
    m.fixture.destroy()
    vi.advanceTimersByTime(POLL_INTERVAL_MS * 3)
    m.http.expectNone(STUDY_URL)
    m.http.expectNone(RESULTS_URL)
  })

  // The race the teardown alone cannot win: the interval is armed after the awaits,
  // so a page destroyed while its first load is in flight arms a timer *after*
  // `ngOnDestroy` has already run, and then polls for the life of the tab.
  it('arms no poll when the page is left while a load is still in flight', async () => {
    fakeInterval()
    const m = mount()
    const req = m.http.expectOne(STUDY_URL)
    m.fixture.destroy()
    req.flush(study({ state: 'live' }))
    await drain()
    m.http.expectNone(RESULTS_URL)
    vi.advanceTimersByTime(POLL_INTERVAL_MS * 3)
    m.http.expectNone(STUDY_URL)
  })

  // The same race one leg further in: the study has landed and the results have
  // not, which is where a page left mid-load spends most of its time. Both legs
  // are covered because each is guarded separately, and a run with only the first
  // could not tell the second guard from a comment.
  it('arms no poll when the page is left while the results are still in flight', async () => {
    fakeInterval()
    const m = mount()
    m.http.expectOne(STUDY_URL).flush(study({ state: 'live' }))
    await settle(m.fixture)
    const req = m.http.expectOne(RESULTS_URL)
    m.fixture.destroy()
    req.flush(liveResults(12, [8, 4]))
    await drain()
    vi.advanceTimersByTime(POLL_INTERVAL_MS * 3)
    m.http.expectNone(STUDY_URL)
    m.http.expectNone(RESULTS_URL)
  })

  // A poll that fails must not blank the page: the figures on screen are the last
  // the server actually sent, and they stay. But it must not pretend either — a
  // frozen counter that still looks live is the failure this page is worst at.
  it('keeps the last figures and says so when a poll fails, and keeps trying', async () => {
    fakeInterval()
    const m = await open(study({ state: 'live', respondents_completed: 12 }), liveResults(12, [8, 4]))
    vi.advanceTimersByTime(POLL_INTERVAL_MS)
    m.http.expectOne(STUDY_URL).flush({ error: 'internal' }, { status: 500, statusText: 'Server Error' })
    await settle(m.fixture)
    expect(m.text(), 'a failed refresh threw the last good figures away').toContain('12 / 100')
    expect(m.text()).toContain('the server did not answer')

    // Still armed: a 500 is a blip, and the next answer clears the notice.
    vi.advanceTimersByTime(POLL_INTERVAL_MS)
    m.http.expectOne(STUDY_URL).flush(study({ state: 'live', respondents_completed: 40 }))
    await settle(m.fixture)
    m.http.expectOne(RESULTS_URL).flush(liveResults(40, [30, 10]))
    await settle(m.fixture)
    expect(m.text()).toContain('40 / 100')
    expect(m.text()).not.toContain('the server did not answer')
  })

  // A 401 is not a blip. Every later poll would 401 too, so a page that keeps its
  // timer running asks a server that has already refused, six times a minute, for
  // as long as the tab is open — and says nothing about why the numbers stopped.
  it('stops polling when the session ends, and says why the figures stopped', async () => {
    fakeInterval()
    const m = await open(study({ state: 'live', respondents_completed: 12 }), liveResults(12, [8, 4]))
    vi.advanceTimersByTime(POLL_INTERVAL_MS)
    m.http.expectOne(STUDY_URL).flush({ error: 'unauthorized' }, { status: 401, statusText: 'Unauthorized' })
    await settle(m.fixture)
    expect(m.text()).toContain('12 / 100')
    expect(m.text()).toContain('sign-in has ended')
    expect(hrefs(m.el)).toContain('/app/login')

    vi.advanceTimersByTime(POLL_INTERVAL_MS * 3)
    m.http.expectNone(STUDY_URL)
  })

  // The same defect the studies list already fixed: a rejected load left the page
  // saying "Loading…" for as long as the buyer was willing to wait.
  it('says the study could not be loaded, rather than loading for ever', async () => {
    const m = mount()
    m.http.expectOne(STUDY_URL).flush({ error: 'internal' }, { status: 500, statusText: 'Server Error' })
    await settle(m.fixture)
    expect(m.text()).not.toContain('Loading')
    expect(m.text()).toContain("Couldn't load this study")
  })

  // The study lands and the results do not, on a FIRST load. The page used to say
  // it was still trying with nothing armed and no request ever going out again:
  // frozen counters wearing a reassuring label, which is worse than saying
  // nothing. The existing poll-failure test cannot see this — it opens the study
  // successfully first, so a timer is already running before anything fails.
  it('really is still trying when it says so, after a first load whose results fail', async () => {
    fakeInterval()
    const m = mount()
    m.http.expectOne(STUDY_URL).flush(study({ state: 'live', respondents_completed: 12 }))
    await settle(m.fixture)
    m.http.expectOne(RESULTS_URL).flush({ error: 'internal' }, { status: 500, statusText: 'Server Error' })
    await settle(m.fixture)
    expect(m.text()).toContain('12 / 100')
    expect(m.text()).toContain('still trying')

    vi.advanceTimersByTime(POLL_INTERVAL_MS)
    m.http.expectOne(STUDY_URL).flush(study({ state: 'live', respondents_completed: 40 }))
    await settle(m.fixture)
    m.http.expectOne(RESULTS_URL).flush(liveResults(40, [30, 10]))
    await settle(m.fixture)
    expect(m.text()).toContain('40 / 100')
    expect(m.text()).not.toContain('still trying')
  })

  // The other half of the same rule: a study that is not live has no poll to try
  // with, so the page must not claim to be working on it.
  it('does not claim to be trying on a study it cannot poll', async () => {
    fakeInterval()
    const m = mount()
    m.http.expectOne(STUDY_URL).flush(study({ state: 'closed', respondents_completed: 100 }))
    await settle(m.fixture)
    m.http.expectOne(RESULTS_URL).flush({ error: 'internal' }, { status: 500, statusText: 'Server Error' })
    await settle(m.fixture)
    expect(m.text()).toContain('the server did not answer')
    expect(m.text(), 'a page with no timer said it was still trying').not.toContain('still trying')
    expect(m.text()).toContain('reloading the page')

    vi.advanceTimersByTime(POLL_INTERVAL_MS * 3)
    m.http.expectNone(STUDY_URL)
  })

  // N2's scenario, and the reason `open` stops the old timer itself. Leaving a
  // live study for one whose results leg fails used to leave the FIRST study's
  // interval running: a request for a study the buyer had left, and then a gate
  // stuck shut for the life of the page.
  it("drops the old study's timer when the URL changes, not when the new study answers", async () => {
    fakeInterval()
    const route = new BehaviorSubject(params(ID))
    const m = mount(route)
    m.http.expectOne(STUDY_URL).flush(study({ state: 'live', respondents_completed: 12 }))
    await settle(m.fixture)
    m.http.expectOne(RESULTS_URL).flush(liveResults(12, [8, 4]))
    await settle(m.fixture)
    expect(vi.getTimerCount(), 'a live study is not being polled at all').toBe(1)

    // The moment the URL changes, before anything has answered for the new study.
    // `expectOne` removes what it matches, so the request is captured once and
    // flushed below rather than asked for twice.
    route.next(params(OTHER))
    await settle(m.fixture)
    const second = m.http.expectOne(OTHER_URL)
    expect(vi.getTimerCount(), 'the study the buyer left is still on a timer').toBe(0)

    // And with the new study's results failing — the branch that used to reach
    // neither `watch` nor a stop — nothing is ever requested for the old one.
    second.flush(study({ id: OTHER, state: 'closed', title: 'Second study', respondents_completed: 40 }))
    await settle(m.fixture)
    m.http.expectOne(`${OTHER_URL}/results`).flush({ error: 'internal' }, { status: 500, statusText: 'Server Error' })
    await settle(m.fixture)
    vi.advanceTimersByTime(POLL_INTERVAL_MS * 30)
    m.http.expectNone(STUDY_URL)
    m.http.expectNone(RESULTS_URL)
  })

  // The path the results-leg failure created: the page is left while that branch
  // is the one running. `watch` has no destroyed check of its own, and this is
  // the second of its two call sites.
  it('arms no poll when the page is left while the results leg is failing', async () => {
    fakeInterval()
    const m = mount()
    m.http.expectOne(STUDY_URL).flush(study({ state: 'live' }))
    await settle(m.fixture)
    const req = m.http.expectOne(RESULTS_URL)
    m.fixture.destroy()
    req.flush({ error: 'internal' }, { status: 500, statusText: 'Server Error' })
    await drain()
    expect(vi.getTimerCount(), 'a destroyed page armed a poll from the catch').toBe(0)
    vi.advanceTimersByTime(POLL_INTERVAL_MS * 3)
    m.http.expectNone(STUDY_URL)
  })

  // A 404 is the server answering, not failing to: this study is gone, or it was
  // never this buyer's — `ownStudy` gives a stranger the same 404 a missing study
  // gets. "Reload the page to try again" is advice that cannot work.
  it('tells a 404 from a fault, and does not offer a retry that cannot work', async () => {
    const m = mount()
    m.http.expectOne(STUDY_URL).flush({ error: 'not_found' }, { status: 404, statusText: 'Not Found' })
    await settle(m.fixture)
    expect(m.text()).toContain('This study is not available')
    expect(m.text()).not.toContain('Reload the page to try again')
    expect(m.text()).not.toContain('Tagline test')
    expect(hrefs(m.el)).toContain('/app')
  })

  // The same distinction on the poll. A study that starts answering 404 mid-run
  // has been deleted or has left this account, and asking again six times a
  // minute for the life of the tab is the dead-button pattern with a timer on it.
  it('stops polling on a 404, and says the study is gone rather than that the server is quiet', async () => {
    fakeInterval()
    const m = await open(study({ state: 'live', respondents_completed: 12 }), liveResults(12, [8, 4]))
    vi.advanceTimersByTime(POLL_INTERVAL_MS)
    m.http.expectOne(STUDY_URL).flush({ error: 'not_found' }, { status: 404, statusText: 'Not Found' })
    await settle(m.fixture)
    expect(m.text(), 'the last figures the server sent are still the last it sent').toContain('12 / 100')
    expect(m.text()).toContain('no longer available')
    expect(m.text()).not.toContain('the server did not answer')

    vi.advanceTimersByTime(POLL_INTERVAL_MS * 3)
    m.http.expectNone(STUDY_URL)
  })

  // R35/R41 (plan 1): the four segments together identify a person at low volume,
  // so the server withholds them until the study settles and says so through
  // `breakdown_state`. Withheld arrives as four empty maps — the same bytes as a
  // study nobody has answered — so a page that reads the maps renders silence
  // where an explanation belongs.
  it('explains the withheld breakdown instead of rendering nothing, and still shows the totals', async () => {
    const m = await open(study({ state: 'live', respondents_completed: 12 }), liveResults(12, [8, 4]))
    expect(m.text()).toContain('Breakdowns by language')
    expect(m.text(), 'the live totals are not withheld and must still be shown').toContain('67%')
    expect(m.el.querySelector('table'), 'a breakdown table was drawn from withheld data').toBeNull()
  })

  // The brief's wording is that the page must read `breakdown_state` rather than
  // assume the maps are populated, and this is the arrangement that tells the two
  // readings apart: a server that says withheld and sends the segments anyway.
  // Reading the maps renders one respondent's language and country; reading the
  // state does not. Today's server cannot send this, which is exactly why the
  // guard is invisible without a test that supplies it.
  it('draws no breakdown from data the server has marked withheld', async () => {
    const m = await open(study({ state: 'live', respondents_completed: 1 }), {
      study_id: ID, respondents_completed: 1, valid_responses: 1, breakdown_state: 'withheld_until_settled',
      questions: [{
        question_id: Q, position: 0, text: 'Which tagline?', options: ['Fast', 'Cached'], counts: [1, 0],
        breakdown: { primary_language: { rust: [1, 0] }, country: { VN: [1, 0] }, activity_tier: { heavy: [1, 0] }, os: { linux: [1, 0] } },
      }],
    })
    expect(m.el.querySelector('table'), 'the page drew a breakdown the server said to withhold').toBeNull()
    expect(m.text()).not.toContain('rust')
    expect(m.text()).not.toContain('VN')
    expect(m.text()).toContain('Breakdowns by language')
  })

  // A server slower than the interval must not have requests stacked on it, and
  // the second answer to arrive must not be able to overwrite a later first.
  it('keeps one request in flight, however many ticks go by unanswered', async () => {
    fakeInterval()
    const m = await open(study({ state: 'live' }), liveResults(12, [8, 4]))
    vi.advanceTimersByTime(POLL_INTERVAL_MS * 3)
    expect(m.http.match(STUDY_URL), 'a slow server collects one request per tick').toHaveLength(1)
  })

  // Non-vacuous companion: the same probes on a settled study find the tables, so
  // their absence above is the withheld branch and not an empty render.
  it('draws the breakdown tables once the study has settled', async () => {
    const m = await open()
    expect(m.text()).not.toContain('Breakdowns by language')
    expect(m.el.querySelector('table')).not.toBeNull()
    expect(m.text()).toContain('primary language')
    expect(m.text(), 'a segment name reached the page in its wire form').not.toContain('primary_language')
  })

  // Two questions, a hundred respondents, two hundred answers — the shape that
  // makes both defects below visible and that every server results test misses,
  // because they are all single-question.
  const twoQuestions = () => ({
    study_id: ID, respondents_completed: 100, valid_responses: 200, breakdown_state: 'available',
    questions: [
      { question_id: Q, position: 0, text: 'Which tagline?', options: ['Fast', 'Cached'], counts: [60, 38], breakdown: EMPTY_BREAKDOWN },
      { question_id: Q2, position: 1, text: 'Which colour?', options: ['Blue', 'Green'], counts: [50, 48], breakdown: EMPTY_BREAKDOWN },
    ],
  })

  // `valid_responses` is one row per *answer*: the server counts answers, and
  // settlement charges the study's price for each one. Rendered as "responses"
  // beside "Respondents 100 / 100" it said the study had delivered three hundred
  // per cent of what was bought.
  it('reports answers as answers and respondents as respondents', async () => {
    const m = await open(study({ state: 'settled' }), twoQuestions())
    expect(m.text()).toContain('200 valid answers from 100 respondents')
    expect(m.text(), 'the answer count is labelled as if it were people').not.toContain('200 valid responses')
    expect(m.text()).toContain('100 / 100')
  })

  // Positions are zero-based on the wire and one-based to a human. Nothing read a
  // heading until now, so a multi-question study would have shipped as "0." "1.".
  it('numbers the questions from one, the way the buyer wrote them', async () => {
    const m = await open(study({ state: 'settled' }), twoQuestions())
    const headings = Array.from(m.el.querySelectorAll('section h2'), (h) => h.textContent?.trim())
    expect(headings).toEqual(['1. Which tagline?', '2. Which colour?'])
  })

  // The export is the server's file. Building one in the browser from the JSON
  // would ship a different artifact from the one the buyer's colleagues get, and
  // it would sidestep the 409 the server returns before settlement.
  it('links the CSV at the server endpoint, and only once the study has settled', async () => {
    const closed = await open(study({ state: 'closed' }), results({ breakdown_state: 'withheld_until_settled', questions: [{ question_id: Q, position: 0, text: 'Which tagline?', options: ['Fast', 'Cached'], counts: [60, 38], breakdown: EMPTY_BREAKDOWN }] }))
    expect(closed.el.querySelector(`a[href="${CSV_URL}"]`), 'the export is offered before the server will serve it').toBeNull()
    expect(closed.text()).toContain('CSV export opens when the study settles')

    const settled = await open()
    expect(settled.el.querySelector(`a[href="${CSV_URL}"]`)).not.toBeNull()
    // Not a browser-built file: a blob or data URL here is a second CSV nobody
    // reviewed, produced from the JSON the segments are withheld from.
    for (const href of hrefs(settled.el)) expect(href.startsWith('blob:') || href.startsWith('data:'), `${href} is built in the browser`).toBe(false)
  })

  it('draws the progress bar at the ratio the server reports, and never past the end of it', async () => {
    const quarter = await open(study({ state: 'live', respondents_completed: 25 }), liveResults(25, [20, 5]))
    expect((quarter.el.querySelector('[data-progress] [data-bar]') as HTMLElement).style.width).toBe('25%')

    const over = await open(study({ state: 'closed', respondents_completed: 120 }), liveResults(120, [100, 20]))
    expect((over.el.querySelector('[data-progress] [data-bar]') as HTMLElement).style.width).toBe('100%')
  })

  // The money on this page is the server's, in cents. Rendered raw, a 9800-cent
  // charge reads as ninety-eight hundred dollars.
  it('shows the money the server sent, in dollars', async () => {
    const m = await open(study({ hold_cents: 1250 }))
    expect(m.text()).toContain('Held $12.50')
    expect(m.text()).toContain('$1.00 per response')
    expect(m.text()).not.toContain('9800')
    expect(m.text()).not.toContain('1250')
  })

  // A price is a function of the configuration, never a constant (R49, R58): the
  // same at-cost study is 55c untargeted and 80c targeted. This page prints the
  // figure the server quoted it and works nothing out, so both arrive intact and
  // there is no `PRICING` on the page to disagree with the server.
  it('prints the price the server quoted, at cost and targeted alike', async () => {
    const atCost = await open(study({ at_cost: true, price_cents: 55 }))
    expect(atCost.text()).toContain('$0.55 per response')
    expect(atCost.text()).toContain('at cost')

    const targeted = await open(study({ at_cost: true, price_cents: 80, targeting: { languages: ['typescript'] } }))
    expect(targeted.text()).toContain('$0.80 per response')

    const paid = await open(study({ at_cost: false, price_cents: 100 }))
    expect(paid.text()).toContain('$1.00 per response')
    expect(paid.text()).not.toContain('at cost')
  })

  it('shows the reviewer note on a rejected study', async () => {
    const m = await open(study({ state: 'rejected', review_note: 'Question 2 names a competitor.' }), null)
    expect(m.text()).toContain('Question 2 names a competitor.')
    m.http.expectNone(RESULTS_URL)
  })

  // A draft has no results and nothing to poll, and asking for either is a request
  // for a page that shows a form.
  it('offers a draft for review, and asks for no results while it is one', async () => {
    fakeInterval()
    const m = await open(study({ state: 'draft', respondents_completed: 0, hold_cents: 0, charged_cents: 0, refunded_cents: 0, live_at: null, closed_at: null }), null)
    m.http.expectNone(RESULTS_URL)
    vi.advanceTimersByTime(POLL_INTERVAL_MS * 2)
    m.http.expectNone(STUDY_URL)

    submitButton(m.el)!.click()
    await settle(m.fixture)
    m.http.expectOne({ method: 'POST', url: `${STUDY_URL}/submit` }).flush(study({ state: 'in_review', respondents_completed: 0 }))
    await settle(m.fixture)
    // The hold is taken at submit, so the credit figure in the chrome is stale
    // until the principal is read back.
    m.http.expectOne('/api/buyer/me').flush({ ...BUYER, credit_cents: 100, first_study_used: true })
    await settle(m.fixture)
    expect(m.text()).toContain('in review')
    expect(submitButton(m.el), 'a study already in review can be submitted again').toBeUndefined()
    expect(m.auth.buyer()?.credit_cents).toBe(100)
  })

  // 402 is the one submit failure the buyer can act on from here, and the amount
  // comes from the server's body rather than from anything this page worked out.
  it('says how much credit a refused submit needs, from the server', async () => {
    const m = await open(study({ state: 'draft' }), null)
    submitButton(m.el)!.click()
    await settle(m.fixture)
    m.http.expectOne({ method: 'POST', url: `${STUDY_URL}/submit` }).flush({ error: 'insufficient_credit', required_cents: 12345 }, { status: 402, statusText: 'Payment Required' })
    await settle(m.fixture)
    expect(m.text()).toContain('$123.45')
    expect(hrefs(m.el)).toContain('/app/credits')
    expect(submitButton(m.el), 'the buyer cannot retry after topping up').toBeDefined()
  })

  // Everything else is a failure the buyer cannot price, and it must not leave the
  // page claiming the study was sent — nor throw out of the click handler, which
  // reaches the console and nothing else.
  it('says a submit failed for any other reason, and stays retryable', async () => {
    const m = await open(study({ state: 'draft' }), null)
    submitButton(m.el)!.click()
    await settle(m.fixture)
    m.http.expectOne({ method: 'POST', url: `${STUDY_URL}/submit` }).flush({ error: 'internal' }, { status: 500, statusText: 'Server Error' })
    await settle(m.fixture)
    expect(m.text()).toContain("Couldn't send this study for review")
    expect(m.text()).not.toContain('in review')
    const button = submitButton(m.el)!
    expect(button.disabled, 'the only recovery offered is a button that cannot be pressed').toBe(false)
  })

  // The button is closed while the request is out. The server's claim is
  // `WHERE state = 'draft'` and a second submit 409s, so no second hold can be
  // taken; what this stops is the wasted request and the second thing to explain.
  it('closes the submit button while the submit is in flight, and reopens it after', async () => {
    const m = await open(study({ state: 'draft' }), null)
    expect(submitButton(m.el)!.disabled).toBe(false)
    submitButton(m.el)!.click()
    await settle(m.fixture)
    expect(submitButton(m.el)!.disabled, 'a second click can be made while the first is unanswered').toBe(true)
    m.http.expectOne({ method: 'POST', url: `${STUDY_URL}/submit` }).flush({ error: 'internal' }, { status: 500, statusText: 'Server Error' })
    await settle(m.fixture)
    expect(submitButton(m.el)!.disabled).toBe(false)
  })

  // ---------------------------------------------------------------------------
  // Following the URL. The router keeps this component alive when only `:id`
  // changes, which is why the page subscribes to `paramMap` rather than reading a
  // snapshot — and that second emission is the one behaviour the subscription
  // exists for. Nothing in the app links study to study today, so all three of
  // these are latent; Task 4 shipped an identical latent defect that went live one
  // task later, which is why they are closed now.
  // ---------------------------------------------------------------------------
  it('shows nothing of the last study once the URL names another', async () => {
    const route = new BehaviorSubject(params(ID))
    const m = mount(route)
    m.http.expectOne(STUDY_URL).flush(study({ state: 'settled' }))
    await settle(m.fixture)
    m.http.expectOne(RESULTS_URL).flush(results())
    await settle(m.fixture)
    expect(m.text()).toContain('Tagline test')

    route.next(params(OTHER))
    await settle(m.fixture)
    expect(m.text(), "the last study's title is still under the new URL").not.toContain('Tagline test')
    expect(m.text(), 'a settled result set outlived the study it belonged to').not.toContain('typescript')
    expect(m.el.querySelector(`a[href="${CSV_URL}"]`), "the last study's export is still offered").toBeNull()
    expect(m.text()).toContain('Loading')

    // The assertions above are made while `study()` is null, which hides the whole
    // results block whatever `results()` holds — so they cannot see a results set
    // that survived. The ones that matter are these, after the new study lands:
    // a draft has no answers, and anything here belongs to the study just left.
    m.http.expectOne(OTHER_URL).flush(study({ id: OTHER, state: 'draft', title: 'Second study' }))
    await settle(m.fixture)
    expect(m.text()).toContain('Second study')
    expect(m.text(), "another study's answers are rendered under this one's title").not.toContain('typescript')
    expect(m.text()).not.toContain('valid answers')
    expect(m.text()).not.toContain('61%')
    expect(m.text()).not.toContain('CSV export')
    expect(m.el.querySelector('table'), "another study's breakdown is on screen").toBeNull()
    expect(m.el.querySelectorAll('[data-bar]'), 'only the progress bar belongs to a draft').toHaveLength(1)
  })

  // Angular re-emits `paramMap` on a navigation to the same URL. Without the
  // no-op check the page would blank itself and refetch on a click that went
  // nowhere.
  it('does nothing when the URL names the study already on screen', async () => {
    const route = new BehaviorSubject(params(ID))
    const m = mount(route)
    m.http.expectOne(STUDY_URL).flush(study({ state: 'settled' }))
    await settle(m.fixture)
    m.http.expectOne(RESULTS_URL).flush(results())
    await settle(m.fixture)

    route.next(params(ID))
    await settle(m.fixture)
    m.http.expectNone(STUDY_URL)
    m.http.expectNone(RESULTS_URL)
    expect(m.text(), 'a no-op navigation threw the page away and started again').toContain('Tagline test')
    expect(m.text()).toContain('typescript')
  })

  // A → B → A. The first visit and the third name the same study, so an id check
  // calls the first visit's answer current when it lands last — and the page ends
  // up showing the older progress beside the newer results.
  it('does not let the first visit to a study overwrite the third', async () => {
    const route = new BehaviorSubject(params(ID))
    const m = mount(route)
    const firstVisit = m.http.expectOne(STUDY_URL)

    route.next(params(OTHER))
    await settle(m.fixture)
    m.http.expectOne(OTHER_URL)

    route.next(params(ID))
    await settle(m.fixture)
    m.http.expectOne(STUDY_URL).flush(study({ state: 'live', respondents_completed: 44 }))
    await settle(m.fixture)
    m.http.expectOne(RESULTS_URL).flush(liveResults(44, [30, 14]))
    await settle(m.fixture)
    expect(m.text()).toContain('44 / 100')

    firstVisit.flush(study({ state: 'live', respondents_completed: 12 }))
    await settle(m.fixture)
    expect(m.text(), 'the first visit to this study overwrote the third').toContain('44 / 100')
    expect(m.text()).not.toContain('12 / 100')
    m.http.expectNone(RESULTS_URL)
  })

  // The race underneath it: the study just left answers after the switch. Without
  // the id check it wins, and the page renders study A under study B's URL.
  it('discards a response for the study the URL has already left', async () => {
    const route = new BehaviorSubject(params(ID))
    const m = mount(route)
    const first = m.http.expectOne(STUDY_URL)
    route.next(params(OTHER))
    await settle(m.fixture)
    const second = m.http.expectOne(OTHER_URL)

    first.flush(study({ title: 'Tagline test' }))
    await settle(m.fixture)
    expect(m.text(), 'a response for the study just left was rendered under the new URL').not.toContain('Tagline test')
    m.http.expectNone(RESULTS_URL)

    second.flush(study({ id: OTHER, state: 'draft', title: 'Second study' }))
    await settle(m.fixture)
    expect(m.text()).toContain('Second study')
  })

  it('polls the study the URL names, not the one it left', async () => {
    fakeInterval()
    const route = new BehaviorSubject(params(ID))
    const m = mount(route)
    m.http.expectOne(STUDY_URL).flush(study({ state: 'live' }))
    await settle(m.fixture)
    m.http.expectOne(RESULTS_URL).flush(liveResults(12, [8, 4]))
    await settle(m.fixture)

    route.next(params(OTHER))
    await settle(m.fixture)
    m.http.expectOne(OTHER_URL).flush(study({ id: OTHER, state: 'live', title: 'Second study' }))
    await settle(m.fixture)
    m.http.expectOne(`${OTHER_URL}/results`).flush({ ...liveResults(5, [3, 2]), study_id: OTHER })
    await settle(m.fixture)

    vi.advanceTimersByTime(POLL_INTERVAL_MS)
    m.http.expectNone(STUDY_URL)
    m.http.expectOne(OTHER_URL).flush(study({ id: OTHER, state: 'live', title: 'Second study', respondents_completed: 44 }))
    await settle(m.fixture)
    m.http.expectOne(`${OTHER_URL}/results`).flush({ ...liveResults(44, [30, 14]), study_id: OTHER })
    await settle(m.fixture)
    expect(m.text()).toContain('44 / 100')
  })

  // The narrow case that makes the one-request gate id-aware rather than a plain
  // boolean: a response for the study just left arriving while a poll for the
  // study now on screen is still out. Releasing the gate on the stale one lets
  // the next tick stack a second request on the new study.
  it('does not let a response for the study just left open the gate on the one loading now', async () => {
    fakeInterval()
    const route = new BehaviorSubject(params(ID))
    const m = mount(route)
    const stale = m.http.expectOne(STUDY_URL)

    route.next(params(OTHER))
    await settle(m.fixture)
    m.http.expectOne(OTHER_URL).flush(study({ id: OTHER, state: 'live', title: 'Second study' }))
    await settle(m.fixture)
    m.http.expectOne(`${OTHER_URL}/results`).flush({ ...liveResults(5, [3, 2]), study_id: OTHER })
    await settle(m.fixture)

    // A poll for the new study goes out and is left unanswered.
    vi.advanceTimersByTime(POLL_INTERVAL_MS)
    // The old study finally answers. It must change nothing about the new one —
    // not what is on screen, and not whether another request may go out.
    stale.flush(study({ title: 'Tagline test' }))
    await settle(m.fixture)
    expect(m.text()).not.toContain('Tagline test')
    vi.advanceTimersByTime(POLL_INTERVAL_MS)

    // Counted once, at the end: `match` removes what it matches, so asking twice
    // empties the queue and reports a second look as zero either way.
    expect(m.http.match(OTHER_URL), 'a stale answer let a second request stack on the new study').toHaveLength(1)
  })

  // The convention every sibling buyer page keeps, and the one this spec did not:
  // a `canActivate` nothing reads is a security-adjacent line no test can tell
  // from a comment, and the file is the obvious one to copy for the next page.
  it('is behind the buyer guard and names itself', () => {
    // `expect(undefined).toContain(fn)` passes in this vitest, so the array check
    // is what makes the line after it mean anything.
    expect(Array.isArray(routeMeta.canActivate)).toBe(true)
    expect(routeMeta.canActivate).toContain(buyerGuard)
    expect(routeMeta.title).toBe(`${SITE_NAME} — Study`)
  })
})
