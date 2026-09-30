import { TestBed, type ComponentFixture } from '@angular/core/testing'
import { provideHttpClient } from '@angular/common/http'
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing'
import { provideRouter } from '@angular/router'
import { describe, it, expect } from 'vitest'
import ReviewPage, { routeMeta } from './index.page'
import { adminGuard } from '../../lib/auth'

const IN_REVIEW = '/api/admin/studies?state=in_review'
const LIVE = '/api/admin/studies?state=live'
const AWAITING = '/api/admin/studies?state=awaiting_payment'
const ONE = '8f0b0f2e-6f6a-4a3a-9c1f-0f1e2d3c4b5a'
const TWO = '22222222-2222-4222-8222-222222222222'

const study = (over: Record<string, unknown>) => ({
  id: ONE, kind: 'paid', state: 'in_review', title: 'Tagline test', sponsor: 'Acme', price_cents: 100, developer_cents: 50, at_cost: false,
  target_count: 100, respondents_completed: 0, hold_cents: 10000, charged_cents: 0, refunded_cents: 0, targeting: { languages: ['typescript'] },
  questions: [{ id: '11111111-1111-4111-8111-111111111111', position: 0, text: 'Which tagline?', options: ['A', 'B'], context: null }],
  review_note: null, created_at: '2026-09-10T10:00:00.000Z', live_at: null, closed_at: null, ...over,
})

/** One macrotask drains every pending microtask; `whenStable()` alone does not. */
async function settle(fixture: ComponentFixture<unknown>) {
  await fixture.whenStable()
  await new Promise((ok) => setTimeout(ok, 0))
  fixture.detectChanges()
}

/** Lets a promise chain run without touching change detection. */
const drain = () => new Promise((ok) => setTimeout(ok, 0))

const squish = (s: string | null) => (s ?? '').replace(/\s+/g, ' ').trim()

/**
 * Renders the page and answers its three opening requests (in_review, live,
 * awaiting_payment — Task 10 adds the third). Note what is *not* here:
 * `<tk-shell>`. Twice on this branch a page test asserted on a string the layout
 * supplied, so the page could render nothing and stay green. Everything below is
 * asserted against a bare page, so only the page can have produced it.
 */
async function mount(queue: unknown[] | { status: number } = [study({})], live: unknown[] = [], awaiting: unknown[] = []) {
  TestBed.resetTestingModule()
  TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])] })
  const fixture = TestBed.createComponent(ReviewPage)
  fixture.detectChanges()
  const http = TestBed.inject(HttpTestingController)
  const q = http.expectOne(IN_REVIEW)
  const l = http.expectOne(LIVE)
  const w = http.expectOne(AWAITING)
  if (Array.isArray(queue)) { q.flush(queue); l.flush(live); w.flush(awaiting) } else {
    q.flush({ error: 'internal' }, { status: queue.status, statusText: 'Server Error' })
    l.flush({ error: 'internal' }, { status: queue.status, statusText: 'Server Error' })
    w.flush({ error: 'internal' }, { status: queue.status, statusText: 'Server Error' })
  }
  await settle(fixture)
  const el = fixture.nativeElement as HTMLElement
  return {
    fixture, http, el, page: fixture.componentInstance,
    text: () => squish(el.textContent),
    click: (selector: string) => {
      const b = el.querySelector(selector) as HTMLButtonElement | null
      if (!b) throw new Error(`no ${selector} on the page`)
      if (b.disabled) throw new Error(`${selector} is disabled`)
      b.click()
    },
    /** The confirmation panel's text, and only its text. */
    panel: () => squish((el.querySelector('[data-confirm]') as HTMLElement | null)?.textContent ?? null),
    /** Answers the refresh both decisions trigger. */
    reload: (nextQueue: unknown[], nextLive: unknown[], nextAwaiting: unknown[] = []) => {
      http.expectOne(IN_REVIEW).flush(nextQueue)
      http.expectOne(LIVE).flush(nextLive)
      http.expectOne(AWAITING).flush(nextAwaiting)
    },
  }
}

/**
 * The refresh `markPaid` reissues after every outcome (Task 10): all three lists
 * come back empty, since none of the tests that use this care what the queue and
 * live lists hold afterwards -- only the notice `markPaid` set is being asserted.
 */
async function answerRefresh(m: Awaited<ReturnType<typeof mount>>): Promise<void> {
  await drain() // the reload is issued from inside the flushed response's own promise chain
  m.http.expectOne(IN_REVIEW).flush([])
  m.http.expectOne(LIVE).flush([])
  m.http.expectOne(AWAITING).flush([])
  await settle(m.fixture)
}

describe('admin ReviewPage', () => {
  it('is behind the admin guard', () => {
    expect(routeMeta.canActivate).toEqual([adminGuard])
  })

  /**
   * The brief's test, with three repairs, each measured before it was made.
   *
   * 1. `await fixture.whenStable()` after a flush lands before the response has
   *    rendered — measured: the page still read "Nothing waiting for review." at
   *    the first assertion. It goes through `settle`, as every other page spec on
   *    this branch does.
   * 2. `await page.decide(...)` on the line *before* the `expectOne` that answers
   *    its request cannot resolve — the flush is on the next line and the test is
   *    suspended. Measured on the brief's own version of the payouts test: "Test
   *    timed out in 5000ms". The promise is started, answered, then awaited.
   * 3. The decisions run through the DOM and the confirmation panel rather than by
   *    calling the method, because the panel is the feature: a test that calls
   *    `decide` directly is green on a page where the button fires it unguarded.
   */
  it('lists the queue, approves, and rejects with a note', async () => {
    const m = await mount([study({}), study({ id: TWO, title: 'Second' })], [])
    expect(m.text()).toContain('Tagline test')
    expect(m.text()).toContain('Which tagline?')
    expect(m.text()).toContain('typescript')
    expect(m.text()).toContain('Second')

    m.click(`[data-approve="${ONE}"]`)
    await settle(m.fixture)
    m.http.expectNone(`/api/admin/studies/${ONE}/review`)
    m.click('[data-confirm] [data-go]')
    await drain()
    const approve = m.http.expectOne(`/api/admin/studies/${ONE}/review`)
    expect(approve.request.body).toEqual({ decision: 'approve', note: undefined })
    approve.flush(study({ state: 'live' }))
    await drain()
    m.reload([study({ id: TWO, title: 'Second' })], [study({ state: 'live' })])
    await settle(m.fixture)
    expect(m.text()).toContain('Close and settle')

    const note = m.el.querySelector(`[data-note="${TWO}"]`) as HTMLInputElement
    note.value = 'Harvests emails'
    note.dispatchEvent(new Event('input'))
    await settle(m.fixture)
    m.click(`[data-reject="${TWO}"]`)
    await settle(m.fixture)
    m.click('[data-confirm] [data-go]')
    await drain()
    const reject = m.http.expectOne(`/api/admin/studies/${TWO}/review`)
    expect(reject.request.body).toEqual({ decision: 'reject', note: 'Harvests emails' })
    reject.flush(study({ id: TWO, state: 'rejected' }))
    await drain()
    m.reload([], [study({ state: 'live' })])
    await settle(m.fixture)
    expect(m.text()).toContain('Nothing waiting for review.')
  })

  // Spec §4.7 is the whole of the policy this screen applies, and the reviewer
  // reads it here or nowhere. Written out rather than imported from the page: a
  // test that compares the page's constant to itself cannot fail.
  it('states the five grounds for refusing a study', async () => {
    const m = await mount()
    for (const clause of [
      'harvesting personal data',
      'political or adult content',
      'deceptive framing',
      'questions phrased as feedback about Claude Code or Anthropic',
      'a hidden sponsor',
    ]) expect(m.text()).toContain(clause)
  })

  // §4.7 again, from the other side: the reviewer cannot judge a study they cannot
  // read. Every question, option and context line has to be on the page.
  it('shows the whole study, not a summary of it', async () => {
    const m = await mount([study({
      questions: [
        { id: 'aaaaaaaa-1111-4111-8111-111111111111', position: 0, text: 'Which tagline?', options: ['Ship it', 'Hold it'], context: 'For a launch post.' },
        { id: 'bbbbbbbb-1111-4111-8111-111111111111', position: 1, text: 'Which editor?', options: ['vim', 'emacs', 'nano'], context: null },
      ],
      targeting: { languages: ['typescript'], countries: ['US'], activity_tiers: ['heavy'], os: ['linux'] },
    })])
    const t = m.text()
    for (const s of ['Which tagline?', 'Ship it | Hold it', 'For a launch post.', 'Which editor?', 'vim | emacs | nano']) expect(t).toContain(s)
    // Spaced, not joined by the mark: design system 7 keeps the middle dot for the
    // status line. Each facet is asserted on its own, which is also what the page
    // renders now -- one span each, joined by the layout.
    for (const f of ['languages typescript', 'countries US', 'tiers heavy', 'os linux']) expect(t).toContain(f)
    expect(t, 'the replica lent its mark to the targeting line again').not.toContain('·')
    expect(t).toContain('sponsor Acme')
  })

  it('says so when a study has no targeting, rather than leaving the line off', async () => {
    const m = await mount([study({ targeting: null })])
    expect(m.text()).toContain('Targeting: none.')
  })

  /**
   * The confirmations, which are the reason this page is not the brief's. Every
   * amount in them is the server's number for *this* study — two studies with
   * different holds are rendered here so a hardcoded figure fails, which is the
   * shape the money-copy defect has taken five times on this branch.
   */
  it('says what approving will do, in this study\'s own figures', async () => {
    const m = await mount([study({}), study({ id: TWO, title: 'Second', hold_cents: 2500, developer_cents: 80 })])
    m.click(`[data-approve="${ONE}"]`)
    await settle(m.fixture)
    expect(m.panel()).toContain('this sends the study to developers now')
    expect(m.panel()).toContain('paid $0.50 for each answer')
    expect(m.panel()).toContain("The buyer's $100.00 hold stays held")
    expect(m.panel()).toContain('There is no un-approve')

    m.click('[data-confirm] [data-cancel]')
    await settle(m.fixture)
    expect(m.el.querySelector('[data-confirm]')).toBeNull()

    m.click(`[data-approve="${TWO}"]`)
    await settle(m.fixture)
    expect(m.panel()).toContain('paid $0.80 for each answer')
    expect(m.panel()).toContain("The buyer's $25.00 hold stays held")
  })

  it('says what rejecting refunds, and names the at-cost entitlement only when there is one', async () => {
    const m = await mount([study({ hold_cents: 5500, at_cost: true }), study({ id: TWO, title: 'Second', hold_cents: 300 })])
    const type = (id: string, value: string) => {
      const box = m.el.querySelector(`[data-note="${id}"]`) as HTMLInputElement
      box.value = value
      box.dispatchEvent(new Event('input'))
    }
    type(ONE, 'Harvests emails')
    await settle(m.fixture)
    m.click(`[data-reject="${ONE}"]`)
    await settle(m.fixture)
    expect(m.panel()).toContain('The buyer gets $55.00 back as credit, and reads this note: Harvests emails')
    expect(m.panel()).toContain('one at-cost study; rejecting hands that entitlement back')

    m.click('[data-confirm] [data-cancel]')
    await settle(m.fixture)
    type(TWO, 'Political')
    await settle(m.fixture)
    m.click(`[data-reject="${TWO}"]`)
    await settle(m.fixture)
    expect(m.panel()).toContain('The buyer gets $3.00 back')
    expect(m.panel()).not.toContain('at-cost study')
  })

  it('will not reject without a note, from the button or from the method', async () => {
    const m = await mount([study({})])
    expect((m.el.querySelector(`[data-reject="${ONE}"]`) as HTMLButtonElement).disabled).toBe(true)
    expect(m.text()).toContain('A rejection needs a note')

    // The guard is in the method too, not only in the disabled attribute: a
    // disabled button is a picture, and the confirmation panel is what calls this.
    await m.page.decide(ONE, 'reject')
    m.http.expectNone(`/api/admin/studies/${ONE}/review`)

    const box = m.el.querySelector(`[data-note="${ONE}"]`) as HTMLInputElement
    box.value = '   '
    box.dispatchEvent(new Event('input'))
    await settle(m.fixture)
    expect((m.el.querySelector(`[data-reject="${ONE}"]`) as HTMLButtonElement).disabled).toBe(true)
  })

  it('says what closing a live study settles, and only closes on the confirmation', async () => {
    const m = await mount([], [study({ state: 'live', hold_cents: 4000, developer_cents: 50, respondents_completed: 12 })])
    expect(m.text()).toContain('12 / 100 respondents')
    m.click(`[data-close="${ONE}"]`)
    await settle(m.fixture)
    m.http.expectNone(`/api/admin/studies/${ONE}/close`)
    expect(m.panel()).toContain('valid ones release $0.50 each to the developer')
    expect(m.panel()).toContain('out of the $40.00 held')
    expect(m.panel()).toContain('A settled study cannot be reopened')

    m.click('[data-confirm] [data-go]')
    await drain()
    const close = m.http.expectOne(`/api/admin/studies/${ONE}/close`)
    expect(close.request.body).toEqual({})
    close.flush(study({ state: 'settled' }))
    await drain()
    m.reload([], [])
    await settle(m.fixture)
    expect(m.text()).toContain('No live studies.')
  })

  // The empty state and the broken state are the same picture unless something
  // says otherwise, and here one of them means a study is sitting unreviewed.
  it('tells the operator when the queue did not load, instead of reading as empty', async () => {
    const m = await mount({ status: 500 })
    expect(m.el.querySelector('[data-load-failed]')).not.toBeNull()
    expect(m.text()).toContain('a study may be waiting that is not shown')
  })

  // The refresh after a decision can fail on its own. Emptying the lists then
  // would report "nothing waiting for review" on the strength of a request that
  // did not answer — the exact confusion the notice exists to prevent.
  it('keeps the queue on screen when the refresh after a decision fails', async () => {
    const m = await mount([study({}), study({ id: TWO, title: 'Second' })])
    m.click(`[data-approve="${ONE}"]`)
    await settle(m.fixture)
    m.click('[data-confirm] [data-go]')
    await drain()
    m.http.expectOne(`/api/admin/studies/${ONE}/review`).flush(study({ state: 'live' }))
    await drain()
    m.http.expectOne(IN_REVIEW).flush({ error: 'internal' }, { status: 500, statusText: 'Server Error' })
    m.http.expectOne(LIVE).flush({ error: 'internal' }, { status: 500, statusText: 'Server Error' })
    await settle(m.fixture)
    expect(m.el.querySelector('[data-load-failed]')).not.toBeNull()
    expect(m.text(), 'the queue was emptied by a refresh that failed').toContain('Second')
    expect(m.text()).not.toContain('Nothing waiting for review.')
  })

  it('does not claim a decision went through when it failed', async () => {
    const m = await mount([study({})])
    m.click(`[data-approve="${ONE}"]`)
    await settle(m.fixture)
    m.click('[data-confirm] [data-go]')
    await drain()
    m.http.expectOne(`/api/admin/studies/${ONE}/review`).flush({ error: 'internal' }, { status: 500, statusText: 'Server Error' })
    await settle(m.fixture)
    // No refresh on a failure whose cause is unknown: the operator is told, and
    // the row stays where it was so the retry is against what they were looking at.
    m.http.expectNone(IN_REVIEW)
    expect(squish(m.el.querySelector('[data-failed]')?.textContent ?? null)).toContain('Nothing was changed')
    expect(m.text()).toContain('Tagline test')
  })

  /**
   * A 409 is not a failed request. The server's review claim is conditional on
   * `in_review`, so it is the answer when someone else already decided the study —
   * a completely different situation, with a different next action: re-read the
   * queue rather than retry. Reported as a generic failure it sent an operator to
   * retry a decision that had already been made.
   */
  it('says when someone else already decided a study, and reloads instead of offering a retry', async () => {
    const m = await mount([study({}), study({ id: TWO, title: 'Second' })])
    m.click(`[data-approve="${ONE}"]`)
    await settle(m.fixture)
    m.click('[data-confirm] [data-go]')
    await drain()
    m.http.expectOne(`/api/admin/studies/${ONE}/review`).flush({ error: 'not_in_review' }, { status: 409, statusText: 'Conflict' })
    await drain()
    // The reload is the point: the queue is known to be wrong, so it is corrected
    // rather than left up under a message saying it is out of date.
    m.reload([study({ id: TWO, title: 'Second' })], [])
    await settle(m.fixture)
    const said = squish(m.el.querySelector('[data-failed]')?.textContent ?? null)
    expect(said).toContain('Someone else already decided that study')
    expect(said).toContain('nothing you did changed it')
    expect(said, 'a stale-state answer was reported as a request that failed').not.toContain('try again')
    expect(m.text(), 'the queue was not reloaded').not.toContain('Tagline test')
  })

  it('says when a study has gone rather than reporting a failed request', async () => {
    const m = await mount([study({})])
    m.click(`[data-approve="${ONE}"]`)
    await settle(m.fixture)
    m.click('[data-confirm] [data-go]')
    await drain()
    m.http.expectOne(`/api/admin/studies/${ONE}/review`).flush({ error: 'not_found' }, { status: 404, statusText: 'Not Found' })
    await drain()
    m.reload([], [])
    await settle(m.fixture)
    expect(squish(m.el.querySelector('[data-failed]')?.textContent ?? null)).toContain('That study no longer exists')
  })

  it('says when a live study was already closed and settled', async () => {
    const m = await mount([], [study({ state: 'live' })])
    m.click(`[data-close="${ONE}"]`)
    await settle(m.fixture)
    m.click('[data-confirm] [data-go]')
    await drain()
    m.http.expectOne(`/api/admin/studies/${ONE}/close`).flush({ error: 'not_closable' }, { status: 409, statusText: 'Conflict' })
    await drain()
    m.reload([], [])
    await settle(m.fixture)
    const said = squish(m.el.querySelector('[data-failed]')?.textContent ?? null)
    expect(said).toContain('already closed and settled')
    expect(said).not.toContain('Check whether it settled before trying again')
  })

  describe('awaiting payment (R503)', () => {
    const WAITING = {
      ...study({}), id: '55555555-5555-4555-8555-555555555555', state: 'awaiting_payment',
      amount_due_cents: 2750, payment_reference: 'TKO-55555555', buyer_email: 'pm@acme.test',
    }

    it('lists studies awaiting payment with amount, reference and buyer', async () => {
      const m = await mount([], [], [WAITING])
      const row = m.el.querySelector(`[data-awaiting-row="${WAITING.id}"]`)!
      expect(row.textContent).toContain('$27.50')
      expect(row.textContent).toContain('TKO-55555555')
      expect(row.textContent).toContain('pm@acme.test')
    })

    // I-1: the owner has to be able to apply §4.7 to a study before invoicing it, which means
    // reading the whole thing here rather than following a link — the same requirement the
    // in_review queue below already meets. Asserted against the row alone (not `m.text()`), the
    // smallest element that carries the claim.
    it('shows the whole study on the awaiting row, not just the invoice line', async () => {
      const m = await mount([], [], [WAITING])
      const row = m.el.querySelector(`[data-awaiting-row="${WAITING.id}"]`)!
      expect(row.textContent).toContain('sponsor Acme')
      expect(row.textContent).toContain('100 respondents')
      expect(row.textContent).toContain('languages typescript')
      expect(row.textContent).toContain('Which tagline?')
      expect(row.textContent).toContain('A | B')
    })

    it('marks a study paid with the amount prefilled, and reports that it was submitted', async () => {
      const m = await mount([], [], [WAITING])
      const ref = m.el.querySelector(`[data-paid-reference="${WAITING.id}"]`) as HTMLInputElement
      ref.value = 'VCB-9'; ref.dispatchEvent(new Event('input'))
      await settle(m.fixture)
      ;(m.el.querySelector(`[data-mark-paid="${WAITING.id}"]`) as HTMLButtonElement).click()
      const req = m.http.expectOne({ method: 'POST', url: `/api/admin/studies/${WAITING.id}/mark-paid` })
      expect(req.request.body).toEqual({ cents: 2750, method: 'bank_transfer', reference: 'VCB-9' })
      req.flush({ study: { ...WAITING, state: 'in_review', amount_due_cents: 0 }, submitted: true, amount_due_cents: 0 })
      await answerRefresh(m) // the three list requests the page re-issues
      expect(m.text()).toContain('Payment recorded. The study is now in review.')
    })

    it('says how much is still due after a short payment', async () => {
      const m = await mount([], [], [WAITING])
      const ref = m.el.querySelector(`[data-paid-reference="${WAITING.id}"]`) as HTMLInputElement
      ref.value = 'W-1'; ref.dispatchEvent(new Event('input'))
      await settle(m.fixture)
      ;(m.el.querySelector(`[data-mark-paid="${WAITING.id}"]`) as HTMLButtonElement).click()
      m.http.expectOne({ method: 'POST', url: `/api/admin/studies/${WAITING.id}/mark-paid` })
        .flush({ study: { ...WAITING, amount_due_cents: 50 }, submitted: false, amount_due_cents: 50 })
      await answerRefresh(m)
      expect(m.text()).toContain('Payment recorded, but $0.50 is still due.')
    })

    it('explains a transfer that was already recorded', async () => {
      const m = await mount([], [], [WAITING])
      const ref = m.el.querySelector(`[data-paid-reference="${WAITING.id}"]`) as HTMLInputElement
      ref.value = 'W-1'; ref.dispatchEvent(new Event('input'))
      await settle(m.fixture)
      ;(m.el.querySelector(`[data-mark-paid="${WAITING.id}"]`) as HTMLButtonElement).click()
      m.http.expectOne({ method: 'POST', url: `/api/admin/studies/${WAITING.id}/mark-paid` })
        .flush({ error: 'payment_already_recorded' }, { status: 409, statusText: 'Conflict' })
      await settle(m.fixture)
      expect(m.text()).toContain('That payment reference is already recorded')
    })

    // M-2: a mark-paid that loses to a reject or a withdraw answers 409 too, but with
    // a different error body than `payment_already_recorded`. Falling through to
    // STALE[409] told the operator the study was "no longer in review" -- the wording
    // for the review queue's own 409, not this endpoint's -- about a study that was
    // never in review at all.
    it('says the study is no longer awaiting payment on any other mark-paid conflict', async () => {
      const m = await mount([], [], [WAITING])
      const ref = m.el.querySelector(`[data-paid-reference="${WAITING.id}"]`) as HTMLInputElement
      ref.value = 'W-1'; ref.dispatchEvent(new Event('input'))
      await settle(m.fixture)
      ;(m.el.querySelector(`[data-mark-paid="${WAITING.id}"]`) as HTMLButtonElement).click()
      m.http.expectOne({ method: 'POST', url: `/api/admin/studies/${WAITING.id}/mark-paid` })
        .flush({ error: 'not_awaiting_payment' }, { status: 409, statusText: 'Conflict' })
      await settle(m.fixture)
      const said = squish(m.el.querySelector('[data-failed]')?.textContent ?? null)
      expect(said).toContain('no longer awaiting payment')
      expect(said, 'nothing was recorded, so the reference message is wrong here').not.toContain('nothing you did')
      expect(said, 'the review queue\'s own 409 wording leaked into mark-paid').not.toContain('no longer in review')
    })

    it('disables mark paid until a reference is typed', async () => {
      const m = await mount([], [], [WAITING])
      expect((m.el.querySelector(`[data-mark-paid="${WAITING.id}"]`) as HTMLButtonElement).disabled).toBe(true)
    })

    // M-1: the input is prefilled with cents and "cents" previously lived only in the
    // aria-label, which a sighted operator typing dollars never reads. The unit has to
    // be visible text next to the input, not only in the accessible name.
    it('shows the amount unit visibly next to the mark-paid input', async () => {
      const m = await mount([], [], [WAITING])
      const row = m.el.querySelector(`[data-awaiting-row="${WAITING.id}"]`)!
      expect(row.textContent).toContain('cents')
    })

    // Task 5 lets a waiting study be refused; the wording is the only thing this
    // adds, because nothing was ever taken from the buyer to give back.
    it('says nothing was taken when rejecting a study that is still awaiting payment', async () => {
      const m = await mount([], [], [WAITING])
      const note = m.el.querySelector(`[data-note="${WAITING.id}"]`) as HTMLInputElement
      note.value = 'Wrong buyer'; note.dispatchEvent(new Event('input'))
      await settle(m.fixture)
      m.click(`[data-reject="${WAITING.id}"]`)
      await settle(m.fixture)
      expect(m.panel()).toContain('No payment was taken, so nothing is refunded.')
      expect(m.panel()).not.toContain('refunds the buyer')
    })
  })
})
