import { Component } from '@angular/core'
import { TestBed } from '@angular/core/testing'
import { provideHttpClient } from '@angular/common/http'
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing'
import { provideLocationMocks } from '@angular/common/testing'
import { Router, provideRouter } from '@angular/router'
import { describe, it, expect } from 'vitest'
import { StudyState } from '@tickover/contract'
import StudiesPage from './index.page'

const study = (over: Record<string, unknown>) => ({
  id: '8f0b0f2e-6f6a-4a3a-9c1f-0f1e2d3c4b5a', kind: 'paid', state: 'live', title: 'Tagline test', sponsor: 'Acme', price_cents: 100, developer_cents: 50, at_cost: false,
  target_count: 100, respondents_completed: 12, hold_cents: 10000, charged_cents: 0, refunded_cents: 0, targeting: null,
  questions: [{ id: '11111111-1111-4111-8111-111111111111', position: 0, text: 'Which tagline?', options: ['A', 'B'], context: null }],
  review_note: null, created_at: '2026-09-10T10:00:00.000Z', live_at: '2026-09-10T11:00:00.000Z', closed_at: null, ...over,
})

@Component({ template: 'stub' })
class Stub {}

const ROUTES = [
  { path: 'app/studies/new', component: Stub },
  { path: 'app/studies/:id', component: Stub },
]

/** One macrotask drains every pending microtask; `whenStable()` alone does not. */
async function settle(fixture: { whenStable(): Promise<unknown>; detectChanges(): void }) {
  await fixture.whenStable()
  await new Promise((ok) => setTimeout(ok, 0))
  fixture.detectChanges()
}

/** Renders the page and answers `/api/buyer/studies` with `rows`, or with a failure. */
async function withStudies(rows: unknown[] | { status: number }) {
  // Reset first: two arrangements inside one test is the only way to show that
  // the selector the brief's empty-state test uses does not discriminate.
  TestBed.resetTestingModule()
  TestBed.configureTestingModule({
    providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter(ROUTES), provideLocationMocks()],
  })
  const fixture = TestBed.createComponent(StudiesPage)
  fixture.detectChanges()
  const req = TestBed.inject(HttpTestingController).expectOne('/api/buyer/studies')
  if (Array.isArray(rows)) req.flush(rows)
  else req.flush({ error: 'internal' }, { status: rows.status, statusText: 'Server Error' })
  await settle(fixture)
  const el = fixture.nativeElement as HTMLElement
  return { fixture, el, text: el.textContent ?? '' }
}

const EMPTY_STATE = 'No studies yet.'

describe('buyer StudiesPage', () => {
  // The two tests below are the brief's, with two changes. `await fixture.whenStable()`
  // alone lands while the page is still on "Loading…", so both use the `settle`
  // above — measured, the first failed with `expected 'StudiesNew studyLoading…'
  // to contain 'Tagline test'`.
  //
  // And the empty-state selector is scoped to the paragraph. As the brief wrote it,
  // `a[href="/app/studies/new"]` also matches the "New study" button in the header,
  // so the assertion passed with the whole empty branch deleted: a test that cannot
  // fail, which is the one thing CLAUDE.md rules out. Measured both ways — the test
  // after these two is the record of it.
  it('lists studies with state, price, and progress', async () => {
    TestBed.resetTestingModule()
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])] })
    const fixture = TestBed.createComponent(StudiesPage)
    fixture.detectChanges()
    TestBed.inject(HttpTestingController).expectOne('/api/buyer/studies').flush([study({}), study({ id: '22222222-2222-4222-8222-222222222222', title: 'Draft one', state: 'draft', respondents_completed: 0 })])
    await settle(fixture)
    const text = (fixture.nativeElement as HTMLElement).textContent!
    expect(text).toContain('Tagline test')
    expect(text).toContain('live')
    expect(text).toContain('$1.00')
    expect(text).toContain('12 / 100')
    expect(text).toContain('Draft one')
    // R907: the price column is per answer to each question, which is what price_cents is.
    const heads = Array.from((fixture.nativeElement as HTMLElement).querySelectorAll('th'), (th) => th.textContent?.trim())
    expect(heads).toContain('Per answer')
    expect(heads).not.toContain('Per response')
  })

  it('shows the empty state with a link to create a study', async () => {
    TestBed.resetTestingModule()
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])] })
    const fixture = TestBed.createComponent(StudiesPage)
    fixture.detectChanges()
    TestBed.inject(HttpTestingController).expectOne('/api/buyer/studies').flush([])
    await settle(fixture)
    expect((fixture.nativeElement as HTMLElement).querySelector('p a[href="/app/studies/new"]')).not.toBeNull()
  })

  // The record of why the selector above is scoped to a paragraph: unscoped, it
  // matched the header button and passed with the empty branch deleted. This one
  // identifies the empty state by its own copy and counts the links both ways, so
  // the confound is visible rather than merely avoided.
  it('says so when there are no studies, and says nothing of the sort when there are', async () => {
    const empty = await withStudies([])
    expect(empty.text).toContain(EMPTY_STATE)
    expect(empty.el.querySelectorAll('a[href="/app/studies/new"]').length).toBeGreaterThanOrEqual(2)

    const full = await withStudies([study({})])
    expect(full.text).not.toContain(EMPTY_STATE)
    expect(full.el.querySelectorAll('a[href="/app/studies/new"]'), 'the header button is what makes the selector above undiscriminating').toHaveLength(1)
  })

  // Newest first is the stated order, and the server sends it that way today. A
  // fixture in server order proves nothing about the page, so this one arrives
  // oldest-first: the page has to put it right.
  it('lists newest first, whatever order the rows arrive in', async () => {
    const { el } = await withStudies([
      study({ id: '11111111-1111-4111-8111-111111111111', title: 'Oldest', created_at: '2026-09-01T10:00:00.000Z' }),
      study({ id: '33333333-3333-4333-8333-333333333333', title: 'Newest', created_at: '2026-09-20T10:00:00.000Z' }),
      study({ id: '22222222-2222-4222-8222-222222222222', title: 'Middle', created_at: '2026-09-10T10:00:00.000Z' }),
    ])
    // `Array.from`, not a spread: this package's `lib` has no `dom.iterable`.
    const titles = Array.from(el.querySelectorAll('tbody tr td:first-child'), (td) => td.textContent?.trim())
    expect(titles).toEqual(['Newest', 'Middle', 'Oldest'])
  })

  // Where the click lands, not what the attribute says: an `href` reads back the
  // string that was authored, and three defects on these pages came from tests
  // that stopped there.
  it('opens the study the row names', async () => {
    const { fixture, el } = await withStudies([study({ id: '44444444-4444-4444-8444-444444444444' })])
    const link = el.querySelector('tbody a') as HTMLAnchorElement
    expect(link.textContent).toContain('Tagline test')
    link.click()
    await settle(fixture)
    expect(TestBed.inject(Router).url).toBe('/app/studies/44444444-4444-4444-8444-444444444444')
  })

  // Every state the contract can send has to read as words. `in_review` rendered
  // raw is the one that shows: it is the state a buyer sees for as long as review
  // takes, and the underscore is the only visible sign the map missed a case.
  it('renders every study state the contract defines', async () => {
    const states = StudyState.options
    // Titles carry no state name: with `Study in_review` on the row, the raw-form
    // assertion below reads the title and never sees the chip.
    const { text } = await withStudies(states.map((state, i) => study({ id: `5555555${i}-5555-4555-8555-555555555555`, state, title: `Row ${i}` })))
    for (const state of states) expect(text, `state "${state}" is not shown`).toContain(state.replace('_', ' '))
    expect(text, 'a state reached the page in its wire form').not.toContain('in_review')
  })

  // A failed load left the page on "Loading…" for ever, with the rejection going
  // nowhere. The spinner is the part that lies: it says the answer is coming.
  it('says the list could not be loaded, rather than loading for ever', async () => {
    const { text } = await withStudies({ status: 500 })
    expect(text).not.toContain('Loading')
    expect(text).toContain("Couldn't load your studies")
  })
})
