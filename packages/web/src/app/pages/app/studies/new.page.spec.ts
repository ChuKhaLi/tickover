import { Component } from '@angular/core'
import { TestBed, type ComponentFixture } from '@angular/core/testing'
import { provideHttpClient } from '@angular/common/http'
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing'
import { provideLocationMocks } from '@angular/common/testing'
import { Router, provideRouter } from '@angular/router'
import { describe, it, expect } from 'vitest'
import { LANGUAGES, LANGUAGE_LABELS, PRICING, RULES, Targeting } from '@tickover/contract'
import NewStudyPage, { ESTIMATE_DEBOUNCE_MS, routeMeta } from './new.page'
import { AuthState, buyerGuard } from '../../../lib/auth'
import { SITE_NAME } from '../../../lib/page-meta'
import { TARGETING_CAPS } from '../../../lib/study-form'
import { previewQuestion, statusLinePreview } from '../../../lib/question-preview'

const BUYER = { id: '8f0b0f2e-6f6a-4a3a-9c1f-0f1e2d3c4b5a', email: 'pm@acme.test', org: null, credit_cents: 10000, first_study_used: false }
const STUDY_ID = '22222222-2222-4222-8222-222222222222'

// What `studyView` actually returns: the stored size and the stored questions.
// A fixture with `questions: []` would have hidden C2 -- the quote reads both.
const question = (i = 0) => ({ id: `1111111${i}-1111-4111-8111-111111111111`, position: i, text: 'Which tagline?', options: ['A', 'B'], context: null })
const createdStudy = (over: Record<string, unknown> = {}) => ({
  id: STUDY_ID, kind: 'paid', state: 'draft', title: 'Tagline test', sponsor: 'Acme DB', price_cents: 56, developer_cents: 50,
  at_cost: true, target_count: 50, respondents_completed: 0, hold_cents: 0, charged_cents: 0, refunded_cents: 0, targeting: null,
  questions: [question()], review_note: null, created_at: '2026-09-10T10:00:00.000Z', live_at: null, closed_at: null, ...over,
})

@Component({ template: 'stub' })
class Stub {}

const ROUTES = [
  { path: 'app/studies/:id', component: Stub },
  { path: 'app/credits', component: Stub },
]

/** One macrotask drains every pending microtask; `whenStable()` alone does not. */
async function settle(fixture: ComponentFixture<unknown>) {
  await fixture.whenStable()
  await new Promise((ok) => setTimeout(ok, 0))
  fixture.detectChanges()
}

/** Lets a promise chain run without touching change detection. */
const drain = () => new Promise((ok) => setTimeout(ok, 0))
/** Past the debounce window, using the page's own figure rather than a copy of it. */
const pastDebounce = () => new Promise((ok) => setTimeout(ok, ESTIMATE_DEBOUNCE_MS + 80))

/** Collapses the whitespace an inline template leaves between elements. */
const squish = (s: string) => s.replace(/\s+/g, ' ').trim()

/**
 * Every edit below goes through a real DOM event rather than through the
 * component's fields, and it has to. **Measured on this stack:** the draft is a
 * plain object, and with no zone.js this package renders zonelessly, so
 * `page.draft.title = 'x'; fixture.detectChanges()` leaves the previous render on
 * screen — no signal changed, the view is never marked dirty, and `detectChanges()`
 * has nothing to do. (`fixture.changeDetectorRef.markForCheck()` does not help
 * either: that is the host view, not the component's.) A probe measured all four
 * cases; only a DOM event and the component's own `ChangeDetectorRef` repaint.
 *
 * So a test that sets fields and reads markup reads the *previous* render and
 * silently asserts against stale numbers. Typing is also the honest arrangement:
 * it is what a buyer does, and it exercises the two-way bindings — including the
 * keyed write into `q.options[oi]` — that setting fields skips entirely.
 */
function typeInto(root: HTMLElement, selector: string, value: string): HTMLInputElement | HTMLTextAreaElement {
  const field = root.querySelector(selector) as HTMLInputElement | HTMLTextAreaElement
  if (!field) throw new Error(`no field matched ${selector}`)
  field.value = value
  field.dispatchEvent(new Event('input'))
  return field
}

const button = (root: HTMLElement, label: string) =>
  Array.from(root.querySelectorAll('button')).find((b) => b.textContent?.trim() === label)!

/** The page asks for the audience on load (spec 6.7); most tests are about what happens next. */
const flushLoadEstimate = (http: HttpTestingController) =>
  http.expectOne('/api/buyer/studies/estimate').flush({ reachable_developers: 4210, estimated_fill_hours: 6 })

async function mount(buyer: Partial<typeof BUYER> = {}, routes = ROUTES) {
  // Fixtures are attached so focus can be asserted; clear the last one's DOM.
  document.body.replaceChildren()
  TestBed.resetTestingModule()
  TestBed.configureTestingModule({
    providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter(routes), provideLocationMocks()],
  })
  TestBed.inject(AuthState).buyer.set({ ...BUYER, ...buyer })
  const fixture = TestBed.createComponent(NewStudyPage)
  document.body.appendChild(fixture.nativeElement)
  const page = fixture.componentInstance
  fixture.detectChanges()
  // NgForm wires each NgModel a microtask after the first render; typing before
  // that lands on a value accessor with no listener behind it.
  await settle(fixture)
  const el = fixture.nativeElement as HTMLElement
  return {
    fixture, page, el,
    http: TestBed.inject(HttpTestingController),
    router: TestBed.inject(Router),
    text: () => squish(el.textContent ?? ''),
  }
}

/** Picks countries the way a buyer does: focus, type, Enter. The picker takes no Enter without a query. */
async function pickCountries(fixture: ComponentFixture<NewStudyPage>, el: HTMLElement, queries: string[]) {
  const input = el.querySelector('tk-country-picker input[role=combobox]') as HTMLInputElement
  input.dispatchEvent(new Event('focus'))
  for (const q of queries) {
    typeInto(el, 'tk-country-picker input[role=combobox]', q)
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))
    await settle(fixture)
  }
}

/** Ticks the review policy box, or leaves it ticked. Clicking twice unticks it. */
function acceptPolicy(el: HTMLElement) {
  const box = el.querySelector('input[name=policy]') as HTMLInputElement
  if (!box.checked) box.click()
  return box
}

/** The smallest study the contract accepts, typed in, so a test can vary one thing. */
async function fillValid(fixture: ComponentFixture<NewStudyPage>, el: HTMLElement) {
  typeInto(el, 'input[name=title]', 'Tagline test')
  typeInto(el, 'input[name=sponsor]', 'Acme DB')
  typeInto(el, 'input[name=q0]', 'Which tagline?')
  typeInto(el, 'input[name=q0o0]', 'A')
  typeInto(el, 'input[name=q0o1]', 'B')
  typeInto(el, 'input[name=target]', '50')
  acceptPolicy(el)
  await settle(fixture)
}

describe('NewStudyPage', () => {
  // The brief's test, with the deadlock taken out: `submitForReview()` awaits the
  // POST it just made, so awaiting it before flushing the create waits for a
  // response only the line after it can send. The promise is held instead and
  // awaited once every request it makes has been answered.
  //
  // R501: submit is a 200 whether or not the study needs payment -- there is no
  // more 402 branch, so a study that cannot be covered by credit lands in
  // `awaiting_payment` and the buyer is sent to the study page like any other
  // successful submit, which is where the payment panel now lives.
  it('shows the at-cost quote for a first study and submits create then submit', async () => {
    const { fixture, page, el, http, router, text } = await mount({ first_study_used: false })
    await fillValid(fixture, el)

    expect(text()).toContain('$0.56')
    expect(text()).toContain('at cost')
    expect(text()).toContain('$28.00')

    const done = page.submitForReview()
    await drain()
    const create = http.expectOne('/api/buyer/studies')
    expect(create.request.body.title).toBe('Tagline test')
    create.flush(createdStudy())
    await drain()

    http.expectOne(`/api/buyer/studies/${STUDY_ID}/submit`).flush({ ...createdStudy(), state: 'awaiting_payment', amount_due_cents: 2800, payment_reference: 'TKO-AAAAAAAA' })
    await done
    await settle(fixture)

    expect(router.url).toBe(`/app/studies/${STUDY_ID}`)
  })

  // What the server receives, not what the component holds: the draft carries
  // untrimmed whitespace, a blank option row and junk in the country field, and
  // none of that may reach the wire.
  it('sends the contract input the draft converts to, not the draft', async () => {
    const { fixture, page, el, http } = await mount()
    button(el, '+ Add option').click()
    await settle(fixture)

    typeInto(el, 'input[name=title]', '  Tagline test  ')
    typeInto(el, 'input[name=sponsor]', ' Acme DB ')
    typeInto(el, 'input[name=q0]', ' Which tagline? ')
    typeInto(el, 'input[name=q0o0]', '  Postgres, but faster')
    typeInto(el, 'input[name=q0o2]', 'Your DB, cached  ')
    typeInto(el, 'textarea[name=c0]', '  Pick the clearer one ')
    await pickCountries(fixture, el, ['uk', 'us'])
    typeInto(el, 'input[name=target]', '50')
    button(el, 'TypeScript').click()
    acceptPolicy(el)
    await settle(fixture)

    const done = page.submitForReview()
    await drain()
    const create = http.expectOne('/api/buyer/studies')
    expect(create.request.body).toEqual({
      title: 'Tagline test',
      sponsor: 'Acme DB',
      target_count: 50,
      questions: [{ text: 'Which tagline?', options: ['Postgres, but faster', 'Your DB, cached'], context: 'Pick the clearer one' }],
      targeting: { languages: ['typescript'], countries: ['GB', 'US'] },
    })
    create.flush(createdStudy())
    await drain()
    http.expectOne(`/api/buyer/studies/${STUDY_ID}/submit`).flush(createdStudy({ state: 'in_review' }))
    await done
  })

  // The quote is the number the buyer commits money against, so it has to follow
  // the form. A `computed` over `auth.buyer()` does not: the draft is a plain
  // object and no signal it reads changes when the size does, so the panel goes on
  // showing the hold for a study the buyer has stopped describing.
  it('re-quotes as the form is edited, not only when the buyer changes', async () => {
    const { fixture, el, text } = await mount({ first_study_used: false })
    await fillValid(fixture, el)
    expect(text()).toContain('$28.00')

    typeInto(el, 'input[name=target]', '100')
    await settle(fixture)
    expect(text()).toContain('$56.00')
    expect(text()).not.toContain('$28.00')

    // A second question doubles the hold again: the server multiplies by the
    // question count, and a form that ignores it under-quotes by a factor.
    button(el, '+ Add question').click()
    await settle(fixture)
    expect(text()).toContain('$112.00')

    // And targeting re-prices the response itself, at cost included.
    button(el, 'TypeScript').click()
    await settle(fixture)
    expect(text()).toContain('$0.81')
    expect(text()).toContain('$162.00')
  })

  // R49. At cost the price is the developer share plus a flat fee, so half the
  // targeting surcharge is never billed: a first-study buyer pays 25c more for
  // targeting, not the 50c `PRICING.TARGETING_CENTS` names. The buyers page prices
  // both branches; this form quotes the branch in front of it.
  it('names the targeting surcharge the buyer in front of it would pay', async () => {
    expect((await mount({ first_study_used: false })).text()).toContain('Targeting (+$0.25 per answer)')
    expect((await mount({ first_study_used: true })).text()).toContain('Targeting (+$0.50 per answer)')
  })

  // R907. The panel showed the right total under "Hold at submit", beside a unit price labelled
  // "Per valid response" -- so a buyer with two questions read $1.00 a respondent and a total
  // twice what that implies. Each row is read on its own: the label beside the unit price, the
  // multiplier, and the total labelled as what the study costs.
  it('labels the running total as the study total, with the multiplication that makes it', async () => {
    const { fixture, el } = await mount({ first_study_used: true })
    await fillValid(fixture, el)
    button(el, '+ Add question').click()
    typeInto(el, 'input[name=target]', '100')
    await settle(fixture)
    const row = (label: string) => {
      const dt = Array.from(el.querySelectorAll('aside dt')).find((d) => d.textContent?.trim() === label)
      expect(dt, `no quote row labelled "${label}"`).toBeTruthy()
      return dt!.nextElementSibling!.textContent!.replace(/\s+/g, ' ').trim()
    }
    expect(row('Per valid answer, each question')).toBe('$1.00')
    expect(row('Questions × respondents')).toBe('2 × 100')
    expect(row('Study total, held at submit')).toBe('$200.00')
  })

  it('shows the review policy the study will be judged against', async () => {
    const policy = (await mount()).text()
    expect(policy).toContain('does not harvest personal data')
    expect(policy).toContain('not political or adult content')
    expect(policy).toContain('not deceptively framed')
    expect(policy).toContain('a person reviews it before it goes live')
    expect(policy).toContain('the sponsor name is always shown')
  })

  // The tick is a claim the buyer makes about the study, and a person reviews it
  // against exactly that claim. Both branches, so the refusal is the policy gate
  // and not an unrelated failure.
  it('will not submit a study whose review policy has not been accepted', async () => {
    const { fixture, page, el, http, text } = await mount()
    typeInto(el, 'input[name=title]', 'Tagline test')
    typeInto(el, 'input[name=sponsor]', 'Acme DB')
    typeInto(el, 'input[name=q0]', 'Which tagline?')
    typeInto(el, 'input[name=q0o0]', 'A')
    typeInto(el, 'input[name=q0o1]', 'B')
    typeInto(el, 'input[name=target]', '50')
    await settle(fixture)

    expect((el.querySelector('button[type=submit]') as HTMLButtonElement).disabled).toBe(true)
    // Not awaited: a gate that has been removed sends the create and then waits
    // for a response, so awaiting here would report a timeout instead of the
    // request that should never have been made.
    const refused = page.submitForReview()
    await drain()
    http.expectNone('/api/buyer/studies')
    await refused
    await settle(fixture)
    expect(text()).toContain('Accept the review policy before submitting.')

    // Non-vacuous: the same study goes out the moment the box is ticked.
    acceptPolicy(el)
    await settle(fixture)
    expect((el.querySelector('button[type=submit]') as HTMLButtonElement).disabled).toBe(false)
    const done = page.submitForReview()
    await drain()
    http.expectOne('/api/buyer/studies').flush(createdStudy())
    await drain()
    http.expectOne(`/api/buyer/studies/${STUDY_ID}/submit`).flush(createdStudy({ state: 'in_review' }))
    await done
  })

  // The form itself has to reach `submitForReview`, not only the tests.
  it('submits the form the button belongs to', async () => {
    const { fixture, el, http } = await mount()
    await fillValid(fixture, el)
    ;(el.querySelector('button[type=submit]') as HTMLButtonElement).click()
    await drain()
    http.expectOne('/api/buyer/studies').flush(createdStudy())
    await drain()
    http.expectOne(`/api/buyer/studies/${STUDY_ID}/submit`).flush(createdStudy({ state: 'in_review' }))
    await settle(fixture)
  })

  // The contract is the authority on the limits, and it is consulted before
  // anything is sent — an incomplete draft must not reach the server to be told
  // what a local parse already knows.
  it('says what is wrong and sends nothing when the draft does not validate', async () => {
    const { fixture, page, el, http, text } = await mount()
    typeInto(el, 'input[name=title]', 'x')
    acceptPolicy(el)
    await settle(fixture)

    await page.submitForReview()
    http.expectNone('/api/buyer/studies')
    await settle(fixture)
    expect(text()).toContain('Title must be at least 3 characters.')
    expect(text()).toContain('Question 1 must be at least 5 characters.')
    expect(text(), 'a schema path reached the buyer').not.toContain('questions.0')

    // Non-vacuous: the same page sends the same study once it validates.
    await fillValid(fixture, el)
    const done = page.submitForReview()
    await drain()
    http.expectOne('/api/buyer/studies').flush(createdStudy())
    await drain()
    http.expectOne(`/api/buyer/studies/${STUDY_ID}/submit`).flush(createdStudy({ state: 'in_review' }))
    await done
    await settle(fixture)
    expect(text()).not.toContain('Question 1 must be at least 5 characters.')
  })

  // Spec 6.7: the buyer sees the reachable audience and the fill time *before*
  // paying. A panel that stays blank until someone happens to click a chip does
  // not satisfy that, and the default study — targeting nobody, the widest
  // audience there is — is exactly the one that would never ask.
  it('asks for the reachable audience on load, before any targeting is chosen', async () => {
    const { fixture, http, text } = await mount()
    const initial = http.expectOne('/api/buyer/studies/estimate')
    expect(initial.request.body).toEqual({ targeting: undefined, target_count: 100 })
    initial.flush({ reachable_developers: 4210, estimated_fill_hours: 6 })
    await settle(fixture)
    expect(text()).toContain('4210 reachable developers')
    expect(text()).toContain('about 6 hours to fill')
  })

  // The estimate answers "who would see this", which is what a buyer consults
  // while choosing targeting — before the title and the question exist. Deriving
  // the targeting from a whole-study parse sends `undefined` until the rest of the
  // form is filled in, so the panel reports the entire population and silently
  // ignores every chip that was just clicked.
  it('asks about the targeting alone, once, after the debounce', async () => {
    const { fixture, el, http, text } = await mount()
    // The load-time call (below) has already gone out; this test is about what
    // the clicks after it do.
    http.expectOne('/api/buyer/studies/estimate').flush({ reachable_developers: 4210, estimated_fill_hours: 6 })
    await settle(fixture)
    button(el, 'TypeScript').click()
    button(el, 'Python').click()
    button(el, 'Heavy (over 20 turns a week)').click()
    await settle(fixture)

    // Coalesced: three clicks inside the window are one question, not three.
    expect(http.match('/api/buyer/studies/estimate')).toHaveLength(0)
    await pastDebounce()
    const requests = http.match('/api/buyer/studies/estimate')
    expect(requests).toHaveLength(1)
    expect(requests[0]!.request.body).toEqual({
      targeting: { languages: ['typescript', 'python'], activity_tiers: ['heavy'] },
      target_count: 100,
    })

    requests[0]!.flush({ reachable_developers: 812, estimated_fill_hours: 30 })
    await settle(fixture)
    expect(text()).toContain('812 reachable developers')
    expect(text()).toContain('about 30 hours to fill')
  })

  it('copes with an audience it cannot put a fill time on', async () => {
    const { fixture, el, http, text } = await mount()
    http.expectOne('/api/buyer/studies/estimate').flush({ reachable_developers: 4210, estimated_fill_hours: 6 })
    button(el, 'Rust').click()
    await pastDebounce()
    http.expectOne('/api/buyer/studies/estimate').flush({ reachable_developers: 3, estimated_fill_hours: null })
    await settle(fixture)
    expect(text()).toContain('3 reachable developers')
    expect(text()).toContain('no estimate yet')
  })

  it('targets the countries picked by name, and asks for the audience with their codes', async () => {
    const { fixture, page, el, http } = await mount()
    flushLoadEstimate(http)
    await pickCountries(fixture, el, ['uk'])
    expect(page.draft.targeting.countries).toEqual(['GB'])
    await pastDebounce()
    expect(http.expectOne('/api/buyer/studies/estimate').request.body).toMatchObject({ targeting: { countries: ['GB'] } })
  })

  it('locks the picker with the rest of the form once a draft is saved', async () => {
    const { fixture, page, el, http } = await mount()
    flushLoadEstimate(http)
    await fillValid(fixture, el)
    const input = () => el.querySelector('tk-country-picker input[role=combobox]') as HTMLInputElement
    expect(input().disabled, 'not locked before a draft exists').toBe(false)
    const done = page.saveDraft()
    await drain()
    http.expectOne('/api/buyer/studies').flush(createdStudy())
    await done
    await settle(fixture)
    expect(input().disabled).toBe(true)
  })

  it('saves a draft without submitting it, and opens the study', async () => {
    const { fixture, page, el, http, router } = await mount()
    await fillValid(fixture, el)

    const done = page.saveDraft()
    await drain()
    http.expectOne('/api/buyer/studies').flush(createdStudy())
    await drain()
    // A draft is created and left in `draft`: nothing is held and nothing is sent
    // for review, which is the whole difference between the two buttons. Checked
    // before `done` is awaited, so a save that also submits is reported as the
    // request it made rather than as a timeout waiting for its response.
    http.expectNone(`/api/buyer/studies/${STUDY_ID}/submit`)
    await done
    await settle(fixture)
    expect(router.url).toBe(`/app/studies/${STUDY_ID}`)
  })

  // R501: the "Buy credits" banner is gone with the 402 branch it explained. A
  // buyer with too little credit still lands on the study page -- there is no
  // client-side gate left to explain, and no link to click through.
  it('lands on the study page rather than a credits banner when payment is due', async () => {
    const { fixture, page, el, http, router, text } = await mount({ credit_cents: 100 })
    await fillValid(fixture, el)
    const done = page.submitForReview()
    await drain()
    http.expectOne('/api/buyer/studies').flush(createdStudy())
    await drain()
    http.expectOne(`/api/buyer/studies/${STUDY_ID}/submit`).flush({ ...createdStudy(), state: 'awaiting_payment', amount_due_cents: 2800, payment_reference: 'TKO-AAAAAAAA' })
    await done
    await settle(fixture)

    expect(text()).not.toContain('You need')
    expect(Array.from(el.querySelectorAll('a')).some((a) => a.textContent?.includes('Buy credits'))).toBe(false)
    expect(router.url).toBe(`/app/studies/${STUDY_ID}`)
  })

  // The fields carry the contract's limits, not numbers retyped in the template.
  it('limits each field to what the contract accepts', async () => {
    const { el } = await mount()
    const field = (selector: string) => el.querySelector(selector) as HTMLInputElement | HTMLTextAreaElement
    expect(field('input[name=q0]').maxLength).toBe(RULES.QUESTION_TEXT_MAX)
    expect(field('input[name=q0o0]').maxLength).toBe(RULES.OPTION_TEXT_MAX)
    expect(field('textarea[name=c0]').maxLength).toBe(RULES.CONTEXT_MAX)
    expect(field('input[name=title]').maxLength).toBe(80)
    expect(field('input[name=sponsor]').maxLength).toBe(30)

    const slider = field('input[name=target]') as HTMLInputElement
    expect(slider.min).toBe(String(PRICING.MIN_RESPONDENTS))
    expect(slider.max).toBe(String(PRICING.MAX_RESPONDENTS))
  })

  // Five questions of five options each is the contract's ceiling, and the buttons
  // that add them have to stop there rather than mint a study the server rejects.
  // Options first, on a page with a single question, because with five questions
  // on screen there are five "+ option" buttons and only the first one runs out.
  it('stops adding options at the contract ceiling', async () => {
    const { fixture, el } = await mount()
    expect(el.querySelectorAll('input[name^=q0o]')).toHaveLength(2)
    for (let i = 0; i < 8 && button(el, '+ Add option'); i++) {
      button(el, '+ Add option').click()
      await settle(fixture)
    }
    expect(el.querySelectorAll('input[name^=q0o]')).toHaveLength(5)
    expect(button(el, '+ Add option')).toBeUndefined()
  })

  it('stops adding questions at the contract ceiling', async () => {
    const { fixture, el } = await mount()
    expect(el.querySelectorAll('textarea')).toHaveLength(1)
    for (let i = 0; i < 8 && button(el, '+ Add question'); i++) {
      button(el, '+ Add question').click()
      await settle(fixture)
    }
    // One context textarea per question, so this counts the questions.
    expect(el.querySelectorAll('textarea')).toHaveLength(5)
    expect(button(el, '+ Add question')).toBeUndefined()
  })

  // C1. The reviewer measured this: a non-402 submit failure showed "Couldn't
  // save the study" *after* the study was saved, and the retry that message
  // invites minted a second study and submitted that one. Submit is where credits
  // are held, so two studies are two holds against one intended purchase.
  it('does not create a second study when a submit fails and the buyer retries', async () => {
    const { fixture, page, el, http, text } = await mount()
    flushLoadEstimate(http)
    await fillValid(fixture, el)

    const first = page.submitForReview()
    await drain()
    http.expectOne('/api/buyer/studies').flush(createdStudy())
    await drain()
    http.expectOne(`/api/buyer/studies/${STUDY_ID}/submit`).flush({ error: 'internal' }, { status: 500, statusText: 'Server Error' })
    await first
    await settle(fixture)

    // The message says what actually happened, and does not claim nothing was saved.
    expect(text()).toContain("Saved as a draft, but it couldn't be sent for review.")
    expect(text()).not.toContain('nothing was created')

    const retry = page.submitForReview()
    await drain()
    // The whole point: no second study. Checked before the retry is awaited, so a
    // regression is reported as the request it made rather than as a timeout.
    http.expectNone('/api/buyer/studies')
    const resubmit = http.expectOne(`/api/buyer/studies/${STUDY_ID}/submit`)
    resubmit.flush(createdStudy({ state: 'in_review' }))
    await retry
    await settle(fixture)
  })

  // There is no more retry-after-topping-up flow: submit is a single 200 whether
  // or not the balance covers it, so the old 402 branch's re-read of
  // `/api/buyer/me` has nothing left to trigger it. This is the regression that
  // branch's removal could leave behind -- a request nobody flushes -- so it is
  // asserted directly rather than merely not appearing in the DOM.
  it('does not re-fetch the balance when the study lands in awaiting_payment', async () => {
    const { fixture, page, el, http, router } = await mount({ credit_cents: 100 })
    flushLoadEstimate(http)
    await fillValid(fixture, el)

    const done = page.submitForReview()
    await drain()
    http.expectOne('/api/buyer/studies').flush(createdStudy())
    await drain()
    http.expectOne(`/api/buyer/studies/${STUDY_ID}/submit`).flush({ ...createdStudy(), state: 'awaiting_payment', amount_due_cents: 2800, payment_reference: 'TKO-AAAAAAAA' })
    http.expectNone('/api/buyer/me')
    await done
    await settle(fixture)
    expect(router.url).toBe(`/app/studies/${STUDY_ID}`)
  })

  // The other half of the split: when the create is what failed, nothing exists,
  // and the retry *must* create. Without this the fix above would be a page that
  // can never recover from a failed create.
  it('says nothing was created when the create fails, and retries by creating', async () => {
    const { fixture, page, el, http, text } = await mount()
    flushLoadEstimate(http)
    await fillValid(fixture, el)

    const first = page.submitForReview()
    await drain()
    http.expectOne('/api/buyer/studies').flush({ error: 'internal' }, { status: 500, statusText: 'Server Error' })
    await first
    await settle(fixture)
    expect(text()).toContain("Couldn't save the study, and nothing was created.")
    expect(text()).not.toContain("couldn't be sent for review")

    const retry = page.submitForReview()
    await drain()
    http.expectOne('/api/buyer/studies').flush(createdStudy())
    await drain()
    http.expectOne(`/api/buyer/studies/${STUDY_ID}/submit`).flush(createdStudy({ state: 'in_review' }))
    await retry
    await settle(fixture)
  })

  // Two clicks inside one request window are one study, not a race for two.
  it('creates one study for two overlapping submits', async () => {
    const { fixture, page, el, http } = await mount()
    flushLoadEstimate(http)
    await fillValid(fixture, el)

    const a = page.submitForReview()
    const b = page.submitForReview()
    await drain()
    const creates = http.match('/api/buyer/studies')
    expect(creates, 'a double click minted two studies').toHaveLength(1)
    creates[0]!.flush(createdStudy())
    await drain()
    for (const r of http.match(`/api/buyer/studies/${STUDY_ID}/submit`)) r.flush(createdStudy({ state: 'in_review' }))
    await Promise.all([a, b])
  })

  it('groups targeting under four headings and labels chips in plain words', async () => {
    const { el, text } = await mount()
    const groups = Array.from(el.querySelectorAll('[role=group][aria-labelledby]')).map((g) => el.querySelector(`#${g.getAttribute('aria-labelledby')}`)!.textContent!.trim())
    expect(groups).toEqual(['Languages', 'Countries', 'Activity', 'Operating system'])
    expect(button(el, 'C#')).toBeTruthy()
    expect(button(el, 'macOS')).toBeTruthy()
    expect(button(el, 'Heavy (over 20 turns a week)')).toBeTruthy()
    expect(text()).toContain('Within a group a developer matches any choice; across groups they must match every group.')
    expect(Array.from(el.querySelectorAll('button')).some((b) => b.textContent!.trim() === 'csharp'), 'a raw id reached a chip').toBe(false)
  })

  it('sends the ids behind the labels', async () => {
    const { fixture, el, http } = await mount()
    flushLoadEstimate(http)
    button(el, 'C#').click(); button(el, 'macOS').click()
    await settle(fixture)
    await pastDebounce()
    expect(http.expectOne('/api/buyer/studies/estimate').request.body).toMatchObject({ targeting: { languages: ['csharp'], os: ['darwin'] } })
  })

  it('warns when nobody matches, and only then', async () => {
    const { fixture, el, http } = await mount()
    http.expectOne('/api/buyer/studies/estimate').flush({ reachable_developers: 0, estimated_fill_hours: null })
    await settle(fixture)
    const warn = () => el.querySelector('[data-zero-audience]')
    // R814: with no targeting there is no "this targeting" to blame.
    expect(warn()?.textContent).toContain('No developers are active on Tickover yet, so the study would not fill.')
    expect(warn()!.getAttribute('role')).toBeNull()
    button(el, 'Rust').click()
    await pastDebounce()
    http.expectOne('/api/buyer/studies/estimate').flush({ reachable_developers: 0, estimated_fill_hours: null })
    await settle(fixture)
    expect(warn()?.textContent).toContain('No developer matches this targeting right now, so the study would not fill.')
    button(el, 'C#').click()
    await pastDebounce()
    // One developer is an audience, however thin; the boundary is exactly zero.
    http.expectOne('/api/buyer/studies/estimate').flush({ reachable_developers: 1, estimated_fill_hours: null })
    await settle(fixture)
    expect(warn()).toBeNull()
  })

  // I1. 23 chips for a field the contract takes 10 of. The eleventh click used to
  // send a body the server answers with a 400, which the panel could not explain.
  it('stops selecting languages at the contract cap, and says so', async () => {
    const { fixture, el, http, page, text } = await mount()
    flushLoadEstimate(http)
    for (const l of LANGUAGES.slice(0, TARGETING_CAPS.languages)) button(el, LANGUAGE_LABELS[l]!).click()
    await settle(fixture)
    // Non-vacuous: everything up to the cap is accepted.
    expect(page.draft.targeting.languages).toHaveLength(10)
    expect(text()).toContain('10 of 10 languages selected.')
    expect(text()).toContain('You can target at most 10 languages')

    const eleventh = LANGUAGES[TARGETING_CAPS.languages]!
    expect(button(el, LANGUAGE_LABELS[eleventh]!).disabled, 'the chip past the cap is still clickable').toBe(true)
    // The defensive half, reached past the disabled attribute.
    page.toggleLanguage(eleventh)
    await settle(fixture)
    expect(page.draft.targeting.languages).toHaveLength(10)
    expect(page.draft.targeting.languages).not.toContain(eleventh)

    // And the body that goes out is one the contract accepts.
    await pastDebounce()
    const body = http.match('/api/buyer/studies/estimate').pop()!.request.body as { targeting?: unknown }
    expect(Targeting.safeParse(body.targeting).success, 'the server would reject this estimate').toBe(true)
  })

  // Spec 6.7's figure disappearing without a word is indistinguishable from the
  // feature not existing — the silent failure this branch keeps rediscovering.
  it('says the audience could not be estimated rather than blanking the panel', async () => {
    const { fixture, http, text } = await mount()
    http.expectOne('/api/buyer/studies/estimate').flush({ error: 'internal' }, { status: 500, statusText: 'Server Error' })
    await settle(fixture)
    expect(text()).toContain("Couldn't work out the reachable audience for this targeting.")
    expect(text()).not.toContain('reachable developers')
  })

  // C2. The invariant: the hold on screen is the hold the server will take. The
  // server multiplies `price x questions x target_count` off the **stored** study
  // (`domain/study-view.ts` holdFor), and submit sends that study — so once one
  // exists, quoting the form on screen is quoting a study that will not be sent.
  //
  // Measured before the fix: save at 500, drag the size back to 50, panel reads
  // $28.00, server holds $280.00. Ten times, with no confirmation step.
  it('shows the hold the server will take, not the hold for a form the buyer kept editing', async () => {
    const { fixture, page, el, http, text } = await mount({ first_study_used: false })
    flushLoadEstimate(http)
    await fillValid(fixture, el)
    typeInto(el, 'input[name=target]', '500')
    await settle(fixture)
    // At cost, one question, 500 respondents: 56c x 1 x 500.
    expect(text()).toContain('$280.00')
    // Non-vacuous baseline for the lock assertion below: editable before a study exists.
    expect((el.querySelector('input[name=target]') as HTMLInputElement).matches(':disabled')).toBe(false)

    const first = page.submitForReview()
    await drain()
    const create = http.expectOne('/api/buyer/studies')
    expect(create.request.body.target_count).toBe(500)
    create.flush(createdStudy({ target_count: 500 }))
    await drain()
    http.expectOne(`/api/buyer/studies/${STUDY_ID}/submit`).flush({ error: 'internal' }, { status: 500, statusText: 'Server Error' })
    await first
    await settle(fixture)

    // The form is locked, because nothing typed into it can reach the server.
    // `:disabled`, not `.disabled`: the lock is a `<fieldset>`, and the property
    // reflects only an element's own attribute, while the pseudo-class is the
    // effective state the browser uses to decide interactivity. Measured — with
    // the fieldset disabled, `input.disabled` is false and `matches(':disabled')`
    // is true.
    const slider = el.querySelector('input[name=target]') as HTMLInputElement
    expect(slider.matches(':disabled'), 'the form is still editable after the study was created').toBe(true)
    expect(el.querySelector('input[name=title]')!.matches(':disabled')).toBe(true)

    // And even when the model is driven past the lock, the panel keeps quoting
    // the saved study. This is the half that has to hold: the lock is a native
    // fieldset, and a lost fieldset would otherwise be a silent 10x.
    typeInto(el, 'input[name=target]', '50')
    await settle(fixture)
    expect(page.draft.targetCount, 'the probe did not actually change the form').toBe(50)
    expect(text(), 'the panel quoted the edited form, not the saved study').toContain('$280.00')
    expect(text()).not.toContain('$28.00')
    expect(text()).toContain('for 500 respondents')

    // The retry sends that same 500-respondent study, which is what was quoted.
    const retry = page.submitForReview()
    await drain()
    http.expectNone('/api/buyer/studies')
    http.expectOne(`/api/buyer/studies/${STUDY_ID}/submit`).flush(createdStudy({ target_count: 500, state: 'in_review' }))
    await retry
    await settle(fixture)
  })

  // The other direction of the same divergence, and the one that makes it a
  // two-sided defect rather than a rounding worry.
  it('quotes the saved question count, not the questions still on the form', async () => {
    const { fixture, page, el, http, text } = await mount({ first_study_used: false })
    flushLoadEstimate(http)
    await fillValid(fixture, el)

    const first = page.submitForReview()
    await drain()
    // The server stored two questions; the form on screen has one.
    http.expectOne('/api/buyer/studies').flush(createdStudy({ questions: [question(0), question(1)] }))
    await drain()
    http.expectOne(`/api/buyer/studies/${STUDY_ID}/submit`).flush({ error: 'internal' }, { status: 500, statusText: 'Server Error' })
    await first
    await settle(fixture)

    // 56c x 2 questions x 50 respondents, not the 1 question the form shows.
    expect(text()).toContain('$56.00')
    expect(text()).not.toContain('$28.00')
    expect(page.draft.questions, 'the form still holds one question').toHaveLength(1)
  })

  // Save draft creates without the policy gate, and only the navigation carries
  // the buyer off this page. If that navigation fails they are left on a locked
  // form — so the review-policy tick has to survive the lock, or the submit button
  // can never be enabled and there is nothing on screen to say why.
  //
  // `provideRouter([])` is what makes the navigation return false: no route
  // matches `/app/studies/:id`, which is the same outcome as a guard rejecting.
  it('leaves the review policy tickable when a saved draft could not be navigated away from', async () => {
    const { fixture, page, el, http } = await mount({}, [])
    flushLoadEstimate(http)
    typeInto(el, 'input[name=title]', 'Tagline test')
    typeInto(el, 'input[name=sponsor]', 'Acme DB')
    typeInto(el, 'input[name=q0]', 'Which tagline?')
    typeInto(el, 'input[name=q0o0]', 'A')
    typeInto(el, 'input[name=q0o1]', 'B')
    typeInto(el, 'input[name=target]', '50')
    await settle(fixture)

    const saving = page.saveDraft()
    await drain()
    http.expectOne('/api/buyer/studies').flush(createdStudy())
    await saving
    await settle(fixture)

    // The form locked, and the buyer is still on it.
    expect(el.querySelector('input[name=title]')!.matches(':disabled')).toBe(true)
    const policy = el.querySelector('input[name=policy]') as HTMLInputElement
    expect(policy.matches(':disabled'), 'the buyer can never accept the policy from here').toBe(false)

    // And ticking it is enough to get the saved draft sent — no second study.
    policy.click()
    await settle(fixture)
    expect((el.querySelector('button[type=submit]') as HTMLButtonElement).disabled).toBe(false)
    const sending = page.submitForReview()
    await drain()
    http.expectNone('/api/buyer/studies')
    http.expectOne(`/api/buyer/studies/${STUDY_ID}/submit`).flush(createdStudy({ state: 'in_review' }))
    await sending
    await settle(fixture)
  })

  it('is behind the buyer guard and names itself', () => {
    // `expect(undefined).toContain(fn)` passes in this vitest, so the array check
    // is what makes the line after it mean anything.
    expect(Array.isArray(routeMeta.canActivate)).toBe(true)
    expect(routeMeta.canActivate).toContain(buyerGuard)
    expect(routeMeta.title).toBe(`${SITE_NAME} — New study`)
  })
  /**
   * The server requires `Idempotency-Key` on create now, and the point of the header
   * is the one thing this page could never close on its own: a create whose response
   * was lost after the server committed. The page's own guard (`createInFlight` plus
   * `savedStudy`) never sees that response, so the retry is a second POST -- and
   * without a key on it, a second study.
   *
   * The key is regenerated when the draft changes between attempts. A retry of the
   * same study is a replay and must dedupe; a retry of an *edited* study is a
   * different study and must not come back as the one typed a minute ago. The server
   * answers 409 for a used key carrying a new body, so this is also what keeps that
   * status off this page's screen.
   */
  it('sends an idempotency key, reuses it for a retry, and mints a new one after an edit', async () => {
    const { fixture, page, el, http } = await mount()
    await fillValid(fixture, el)

    void page.saveDraft()
    await drain()
    const first = http.expectOne('/api/buyer/studies')
    const key = first.request.headers.get('Idempotency-Key')
    expect(key, 'no idempotency key on create').toBeTruthy()
    first.flush({ error: 'gateway' }, { status: 502, statusText: 'Bad Gateway' })
    await settle(fixture)

    // Same draft, second attempt: a replay, so the same key.
    void page.saveDraft()
    await drain()
    const retry = http.expectOne('/api/buyer/studies')
    expect(retry.request.headers.get('Idempotency-Key')).toBe(key)
    retry.flush({ error: 'gateway' }, { status: 502, statusText: 'Bad Gateway' })
    await settle(fixture)

    // Edited draft: a different study, so a different key.
    typeInto(el, 'input[name=title]', 'A different question entirely')
    await settle(fixture)
    void page.saveDraft()
    await drain()
    const edited = http.expectOne('/api/buyer/studies')
    expect(edited.request.headers.get('Idempotency-Key'), 'an edited draft replayed the previous key').not.toBe(key)
    edited.flush(createdStudy())
    await drain()
    await settle(fixture)
  })

  it('shows each validation failure at its field, and moves focus to the first', async () => {
    const { fixture, page, el, http } = await mount()
    flushLoadEstimate(http)
    typeInto(el, 'input[name=title]', 'x')
    acceptPolicy(el)
    await settle(fixture)
    // Nothing is shown before an attempt; a blank form is not an error.
    expect(el.querySelector('input[name=title]')!.getAttribute('aria-invalid')).toBeNull()

    await page.submitForReview()
    await settle(fixture)
    const title = el.querySelector('input[name=title]') as HTMLInputElement
    expect(title.getAttribute('aria-invalid')).toBe('true')
    const describedBy = title.getAttribute('aria-describedby')!
    expect(el.querySelector(`#${describedBy}`)!.textContent).toContain('Title must be at least 3 characters.')
    const q0 = el.querySelector('input[name=q0]') as HTMLInputElement
    expect(el.querySelector(`#${q0.getAttribute('aria-describedby')}`)!.textContent).toContain('Question 1 must be at least 5 characters.')
    expect(el.querySelector('[data-options-error="0"]')!.textContent).toContain('Question 1 must have at least 2 options.')
    expect(document.activeElement).toBe(title)

    // R810: fixing the field clears its error as soon as it is fixed, with no second attempt.
    typeInto(el, 'input[name=title]', 'x')
    await settle(fixture)
    expect(title.getAttribute('aria-invalid')).toBe('true')
    typeInto(el, 'input[name=title]', 'A proper title')
    await settle(fixture)
    expect(title.getAttribute('aria-invalid')).toBeNull()
    expect(el.querySelector('aside')!.textContent).not.toContain('Title must be')
    // The other fields are still wrong, and still say so.
    expect((el.querySelector('input[name=q0]') as HTMLInputElement).getAttribute('aria-invalid')).toBe('true')
  })

  // R810: errors are derived from the draft, not filed by position at the last attempt.
  it('keeps an error on the question that caused it when another question is removed', async () => {
    const { fixture, page, el, http } = await mount()
    flushLoadEstimate(http)
    typeInto(el, 'input[name=title]', 'Tagline test'); typeInto(el, 'input[name=sponsor]', 'Acme DB')
    button(el, '+ Add question').click()
    await settle(fixture)
    typeInto(el, 'input[name=q1]', 'Which runtime?'); typeInto(el, 'input[name=q1o0]', 'Node'); typeInto(el, 'input[name=q1o1]', 'Bun')
    acceptPolicy(el)
    await settle(fixture)
    await page.submitForReview()
    await settle(fixture)
    const input = (n: number) => el.querySelector('input[name=q' + n + ']') as HTMLInputElement
    expect(input(0).getAttribute('aria-invalid'), 'question 1 is empty').toBe('true')
    expect(input(1).getAttribute('aria-invalid'), 'question 2 is complete').toBeNull()
    button(el, 'Remove question').click()
    await settle(fixture)
    // The complete question is now the only one, at index 0; the error left with its owner.
    expect(input(0).value).toBe('Which runtime?')
    expect(input(0).getAttribute('aria-invalid'), 'the removed question error moved onto this one').toBeNull()
    expect(el.querySelector('aside')!.textContent).not.toContain('Question 1 must')
  })

  // The first test cannot tell a gate from an empty list: before any attempt the
  // issues are empty anyway. Put an issue there without an attempt.
  it('holds back field errors until the buyer has attempted, even when an issue exists', async () => {
    const { fixture, page, el, http } = await mount()
    flushLoadEstimate(http)
    typeInto(el, 'input[name=title]', 'x')
    await settle(fixture)
    const title = el.querySelector('input[name=title]') as HTMLInputElement
    expect(title.getAttribute('aria-invalid')).toBeNull()
    page.attempted.set(true)
    await settle(fixture)
    expect(title.getAttribute('aria-invalid')).toBe('true')
  })

  it('takes an exact respondent count and only estimates in range', async () => {
    const { fixture, page, el, http } = await mount()
    flushLoadEstimate(http)
    const n = typeInto(el, 'input[name=targetCount]', '3') as HTMLInputElement
    await settle(fixture)
    await pastDebounce()
    // D5: 3 is a keystroke on the way to 300; the server would 400 it.
    http.expectNone('/api/buyer/studies/estimate')
    typeInto(el, 'input[name=targetCount]', '317')
    await pastDebounce()
    expect(http.expectOne('/api/buyer/studies/estimate').request.body).toMatchObject({ target_count: 317 })
    expect(page.draft.targetCount).toBe(317)

    // R813: leaving the field changes nothing. The count stays as typed and asks for no estimate.
    typeInto(el, 'input[name=targetCount]', '9000')
    n.dispatchEvent(new Event('blur'))
    await settle(fixture)
    expect(page.draft.targetCount).toBe(9000)
    expect(n.value).toBe('9000')
    await pastDebounce()
    http.expectNone('/api/buyer/studies/estimate')
  })

  // R813: pressing Submit blurs the field first, so a blur clamp changed the count and the
  // hold was placed on a number the buyer never saw.
  it('does not send a study whose typed count is out of range, and says why at the field', async () => {
    const { fixture, page, el, http } = await mount()
    flushLoadEstimate(http)
    await fillValid(fixture, el)
    const n = typeInto(el, 'input[name=targetCount]', '30') as HTMLInputElement
    acceptPolicy(el)
    await settle(fixture)
    n.dispatchEvent(new Event('blur'))
    ;(el.querySelector('button[type=submit]') as HTMLButtonElement).click()
    await drain()
    await settle(fixture)
    expect(page.draft.targetCount, 'the count was rewritten').toBe(30)
    http.expectNone('/api/buyer/studies')
    expect(n.getAttribute('aria-invalid')).toBe('true')
    expect(el.querySelector('#' + n.getAttribute('aria-describedby'))!.textContent).toContain('Respondents must be at least 50.')
  })

  // R813: the early return on a non-integer left the field showing 75.5 while the draft kept 100,
  // so the hold was placed on a number the buyer did not see.
  it('does not send a study whose typed count is not a whole number, and says why at the field', async () => {
    const { fixture, page, el, http } = await mount()
    flushLoadEstimate(http)
    await fillValid(fixture, el)
    const n = typeInto(el, 'input[name=targetCount]', '75.5') as HTMLInputElement
    acceptPolicy(el)
    await settle(fixture)
    ;(el.querySelector('button[type=submit]') as HTMLButtonElement).click()
    await drain()
    await settle(fixture)
    expect(page.draft.targetCount, 'the draft kept a number the buyer did not type').toBe(75.5)
    http.expectNone('/api/buyer/studies')
    await pastDebounce()
    http.expectNone('/api/buyer/studies/estimate')
    expect(n.getAttribute('aria-invalid')).toBe('true')
    expect(el.querySelector('#' + n.getAttribute('aria-describedby'))!.textContent).toContain('Respondents must be a whole number.')
  })

  it('never sends an out-of-range count when an in-range one is still waiting on the debounce', async () => {
    const { fixture, el, http } = await mount()
    flushLoadEstimate(http)
    typeInto(el, 'input[name=targetCount]', '317')
    typeInto(el, 'input[name=targetCount]', '3170')
    await settle(fixture)
    await pastDebounce()
    http.expectNone('/api/buyer/studies/estimate')
  })

  it('does not ask for an audience while the typed count is out of range, whatever prompts the ask', async () => {
    const { fixture, page, el, http } = await mount()
    flushLoadEstimate(http)
    typeInto(el, 'input[name=targetCount]', '3170')
    button(el, LANGUAGE_LABELS[LANGUAGES[0]!]!).click()
    await settle(fixture)
    expect(page.draft.targeting.languages).toHaveLength(1)
    await pastDebounce()
    http.expectNone('/api/buyer/studies/estimate')
    expect(page.estimateFailed()).toBe(false)
  })

  // The count used to run on as the end of the sentence. Both stay the field's one description, as the Question field's count does.
  it('puts the context character count on its own line, inside the same description', async () => {
    const { el } = await mount()
    const ta = el.querySelector('textarea[name="c0"]') as HTMLTextAreaElement
    const desc = el.querySelector('#' + ta.getAttribute('aria-describedby')) as HTMLElement
    const lines = () => Array.from(desc.querySelectorAll('span')).map((s) => s.textContent!.trim())
    expect(lines()).toEqual(['Shown in the Tickover pane and the VS Code extension, not in the status line or the band.', '0 of ' + RULES.CONTEXT_MAX + ' characters'])
    const q = el.querySelector('input[name="q0"]') as HTMLInputElement
    const qDesc = el.querySelector('#' + q.getAttribute('aria-describedby')) as HTMLElement
    expect(qDesc.textContent!.trim()).toBe('0 of ' + RULES.QUESTION_TEXT_MAX + ' characters')
  })

  it('names the controls in words a buyer uses', async () => {
    const { text, el } = await mount()
    expect(text()).toContain('Context (optional)')
    expect(text()).toContain('Shown in the Tickover pane and the VS Code extension, not in the status line or the band.')
    expect(button(el, '+ Add option')).toBeTruthy()
    expect(button(el, '+ Add question')).toBeTruthy()
    expect(text()).not.toContain('rich surfaces')
  })

  it('says at the respondents field that the count is out of range', async () => {
    const { fixture, page, el, http } = await mount()
    flushLoadEstimate(http)
    const n = typeInto(el, 'input[name=targetCount]', '9000') as HTMLInputElement
    acceptPolicy(el)
    await settle(fixture)
    expect(n.getAttribute('aria-invalid')).toBeNull()
    await page.submitForReview()
    await settle(fixture)
    expect(n.getAttribute('aria-invalid')).toBe('true')
    expect(el.querySelector('#' + n.getAttribute('aria-describedby'))!.textContent).toContain('Respondents must be 500 or fewer.')
  })

  it('flags the option row that is wrong, and announces the options error', async () => {
    const { fixture, page, el, http } = await mount()
    flushLoadEstimate(http)
    typeInto(el, 'input[name=q0o0]', 'A')
    typeInto(el, 'input[name=q0o1]', 'x'.repeat(RULES.OPTION_TEXT_MAX + 1))
    acceptPolicy(el)
    await settle(fixture)
    await page.submitForReview()
    await settle(fixture)
    const o0 = el.querySelector('input[name=q0o0]') as HTMLInputElement
    const o1 = el.querySelector('input[name=q0o1]') as HTMLInputElement
    expect(o1.getAttribute('aria-invalid')).toBe('true')
    expect(o0.getAttribute('aria-invalid')).toBeNull()
    expect(el.querySelector('#' + o1.getAttribute('aria-describedby'))!.hasAttribute('data-options-error')).toBe(true)
  })

  it('keeps the flag on the first option when the list itself is too short', async () => {
    const { fixture, page, el, http } = await mount()
    flushLoadEstimate(http)
    typeInto(el, 'input[name=q0o0]', 'A')
    acceptPolicy(el)
    await settle(fixture)
    await page.submitForReview()
    await settle(fixture)
    const o0 = el.querySelector('input[name=q0o0]') as HTMLInputElement
    expect(o0.getAttribute('aria-invalid')).toBe('true')
    expect(el.querySelector('#' + o0.getAttribute('aria-describedby'))!.hasAttribute('data-options-error')).toBe(true)
    expect((el.querySelector('input[name=q0o1]') as HTMLInputElement).getAttribute('aria-invalid')).toBeNull()
  })

  // R814: the preview shows the developer's share and the quote shows the buyer's price, side by side.
  it('says the amount in the preview is what the developer earns per answer', async () => {
    const { fixture, el, http } = await mount()
    flushLoadEstimate(http)
    await fillValid(fixture, el)
    expect(el.querySelector('[data-preview-caption]')!.textContent).toContain('The amount shown is what the developer earns per answer.')
  })

  it('previews each question as the developer will be served it', async () => {
    const { fixture, page, el, http } = await mount({ first_study_used: false })
    flushLoadEstimate(http)
    await fillValid(fixture, el)
    const q = previewQuestion(page.draft.questions[0]!, 'Acme DB', page.quote().developerCents)!.question
    expect(el.querySelector('[data-preview-line]')!.textContent).toBe(statusLinePreview(q, 80).line)
    // The developer's share, never the buyer's price.
    expect(el.querySelector('[data-preview-line]')!.textContent).toContain(`$${(page.quote().developerCents / 100).toFixed(2)}`)
    expect(el.querySelector('[data-preview-line]')!.textContent).not.toContain(`$${(page.quote().priceCents / 100).toFixed(2)} `)
  })

  it('switches every card together', async () => {
    const { fixture, el, http } = await mount()
    flushLoadEstimate(http)
    await fillValid(fixture, el)
    button(el, '+ Add question').click()
    await settle(fixture)
    typeInto(el, 'input[name=q1]', 'Which runtime?'); typeInto(el, 'input[name=q1o0]', 'Node'); typeInto(el, 'input[name=q1o1]', 'Bun')
    await settle(fixture)
    Array.from(el.querySelectorAll('button')).filter((b) => b.textContent!.trim() === '120')[0]!.click()
    await settle(fixture)
    const pressed = Array.from(el.querySelectorAll('button')).filter((b) => b.textContent!.trim() === '120').map((b) => b.getAttribute('aria-pressed'))
    expect(pressed).toEqual(['true', 'true'])
  })
})
