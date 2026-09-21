import { TestBed, type ComponentFixture } from '@angular/core/testing'
import { provideHttpClient } from '@angular/common/http'
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing'
import { provideRouter } from '@angular/router'
import { describe, it, expect } from 'vitest'
import { RULES } from '@tickover/contract'
import PayoutsPage, { routeMeta } from './payouts.page'
import { adminGuard } from '../../lib/auth'
import { formatCents } from '../../lib/money'

const BATCHES = '/api/admin/payouts/batches'
const ID = 'batch_2026-09-10_abc'
const CSV = 'payout_id,developer_id,paypal_email,amount_usd\n1,2,octo@pp.test,25.00\n'

const batch = { batch_id: ID, adapter: 'manual-csv', count: 2, total_cents: 3500, artifact: CSV, created_at: '2026-09-10T10:00:00.000Z', paid_at: null, failed_at: null }

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
 * Renders the page with the file-saving seam replaced and answers the opening
 * request. No `<mw-shell>` here: everything asserted below has to be something
 * this page produced, not something the layout supplied.
 */
async function mount(rows: unknown[] | { status: number } = []) {
  TestBed.resetTestingModule()
  TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])] })
  const fixture = TestBed.createComponent(PayoutsPage)
  const page = fixture.componentInstance
  const saved: Array<{ name: string; csv: string }> = []
  // jsdom has no `createObjectURL`, and an anchor click is not the thing worth
  // asserting anyway: the bytes and the filename are what an operator pays from.
  page.saveAs = (name, csv) => { saved.push({ name, csv }) }
  fixture.detectChanges()
  const http = TestBed.inject(HttpTestingController)
  const req = http.expectOne(BATCHES)
  if (Array.isArray(rows)) req.flush(rows)
  else req.flush({ error: 'internal' }, { status: rows.status, statusText: 'Server Error' })
  await settle(fixture)
  const el = fixture.nativeElement as HTMLElement
  return {
    fixture, http, el, page, saved,
    text: () => squish(el.textContent),
    click: (selector: string) => {
      const b = el.querySelector(selector) as HTMLButtonElement | null
      if (!b) throw new Error(`no ${selector} on the page`)
      if (b.disabled) throw new Error(`${selector} is disabled`)
      b.click()
    },
    panel: () => squish((el.querySelector('[data-confirm]') as HTMLElement | null)?.textContent ?? null),
  }
}

describe('admin PayoutsPage', () => {
  it('is behind the admin guard', () => {
    expect(routeMeta.canActivate).toEqual([adminGuard])
  })

  /**
   * The brief's test, with two repairs.
   *
   * 1. `await page.create()` cannot resolve: the request it makes is only answered
   *    on the next line, which the suspended test never reaches. Measured against
   *    the brief's own implementation: "Test timed out in 5000ms". The promise is
   *    started by a click, answered, and only then awaited.
   * 2. It goes through the DOM and the confirmation panel. Creating a batch debits
   *    developers, so the confirmation is the feature; a test that calls `create()`
   *    is green on a page whose button fires it unguarded.
   */
  it('creates a batch, lists it, and marks it paid', async () => {
    const m = await mount([])
    expect(m.text()).toContain('No batches yet.')

    m.click('[data-create]')
    await settle(m.fixture)
    m.http.expectNone(BATCHES)
    m.click('[data-confirm] [data-go]')
    await drain()
    const created = m.http.expectOne(BATCHES)
    expect(created.request.method).toBe('POST')
    created.flush(batch)
    await drain()
    m.http.expectOne(BATCHES).flush([batch])
    await settle(m.fixture)
    expect(m.text()).toContain(ID)
    expect(m.text()).toContain('$35.00')

    m.click(`[data-paid-for="${ID}"]`)
    await settle(m.fixture)
    m.http.expectNone(`${BATCHES}/${ID}/paid`)
    m.click('[data-confirm] [data-go]')
    await drain()
    m.http.expectOne(`${BATCHES}/${ID}/paid`).flush({ ...batch, paid_at: '2026-09-11T10:00:00.000Z' })
    await drain()
    m.http.expectOne(BATCHES).flush([{ ...batch, paid_at: '2026-09-11T10:00:00.000Z' }])
    await settle(m.fixture)
    expect(m.el.querySelector('button[data-paid]')).toBeNull()
    expect(squish(m.el.querySelector(`[data-paid-at="${ID}"]`)?.textContent ?? null)).toContain('Sep 11, 2026')
  })

  /**
   * R49, the defect this branch has now shipped five times. The brief's copy read
   * "a GitHub account at least 6 months old, and at least $10 available" — both
   * literals, and both the exact numbers `createPayoutBatch` filters on, so a
   * change to either would have left the operator reading a rule the server no
   * longer applies.
   *
   * Both halves are read out of `RULES` here, which is what makes a contract-only
   * change move the assertion and the page together. That is the property every
   * R49 pin on this branch has: the mutant that kills it moves the constant *and*
   * writes today's figure into the page, because neither half alone can tell a
   * literal from a value read out of the contract.
   */
  it('quotes the batch rules from the contract, not from copy', async () => {
    const m = await mount([])
    expect(m.text()).toContain(`at least ${formatCents(RULES.PAYOUT_MIN_CENTS)} available`)
    expect(m.text()).toContain(`at least ${RULES.GITHUB_MIN_AGE_MONTHS} months old`)
    // The other half of who is left out, which is what the Flag button on the
    // developers page silently does.
    expect(m.text()).toContain('Flagged and banned developers are left out')
  })

  it('says what creating a batch does to developers before any money moves', async () => {
    const m = await mount([])
    m.click('[data-create]')
    await settle(m.fixture)
    expect(m.panel()).toContain('this debits developers before any money moves')
    expect(m.panel()).toContain('available balance debited now, days before you pay it')
    expect(m.panel()).toContain('reads $0.00 available from this moment')
    expect(m.panel()).toContain('Nothing is sent by us')
  })

  /**
   * Both panels, on both batches. One batch is not enough: with only the $35.00
   * row opened, the mark-paid panel passed with its total and its count written in
   * as literals — measured, the mutant survived until the second row was added.
   * Two configurations is the only shape that tells a figure from a constant.
   */
  it('says what marking paid and marking failed each mean, in each batch\'s own figures', async () => {
    const OTHER = 'batch_2026-09-11_def'
    const m = await mount([batch, { ...batch, batch_id: OTHER, count: 1, total_cents: 1200 }])
    const open = async (selector: string) => {
      const open = m.el.querySelector('[data-confirm] [data-cancel]') as HTMLButtonElement | null
      if (open) { open.click(); await settle(m.fixture) }
      m.click(selector)
      await settle(m.fixture)
      return m.panel()
    }

    expect(await open(`[data-paid-for="${ID}"]`)).toContain('$35.00 has actually gone out to 2 developers')
    expect(m.panel()).toContain('It moves no money')
    expect(await open(`[data-paid-for="${OTHER}"]`)).toContain('$12.00 has actually gone out to 1 developers')

    expect(await open(`[data-failed-for="${ID}"]`)).toContain('Every payout in this batch is credited back')
    expect(m.panel()).toContain('totals $35.00 across 2 developers')
    expect(m.panel()).toContain('this gives the money back to the developers')
    expect(m.panel()).toContain('paying the CSV afterwards would pay them twice')
    m.http.expectNone(`${BATCHES}/${ID}/failed`)
    expect(await open(`[data-failed-for="${OTHER}"]`)).toContain('totals $12.00 across 1 developers')
  })

  it('hands over the artifact bytes under the batch id, unchanged', async () => {
    const m = await mount([batch])
    m.click(`[data-csv="${ID}"]`)
    expect(m.saved).toEqual([{ name: `${ID}.csv`, csv: CSV }])
  })

  it('marks a batch with no artifact rather than offering an empty download', async () => {
    const m = await mount([{ ...batch, artifact: null }])
    expect(m.el.querySelector(`[data-csv="${ID}"]`)).toBeNull()
    expect(m.text()).toContain('no CSV')
  })

  /**
   * A batch ends one of two ways, and until `PayoutBatchView` carried `failed_at`
   * this page could not tell them apart: a batch whose money had already been
   * credited back was drawn exactly like one nobody had touched, with both buttons
   * still offered, and marking it paid was a silent no-op on the server. The date
   * is on the view now, so the row says so and the two claims that can no longer
   * do anything are not offered.
   */
  it('draws a failed batch as failed and stops offering the two buttons that would do nothing', async () => {
    const failed = { ...batch, failed_at: '2026-09-11T09:00:00.000Z' }
    const m = await mount([failed])
    expect(squish(m.el.querySelector(`[data-failed-at="${ID}"]`)?.textContent ?? null)).toContain('Sep 11, 2026')
    expect(squish(m.el.querySelector(`[data-paid-at="${ID}"]`)?.textContent ?? null)).toBe('—')
    expect(m.el.querySelector(`[data-paid-for="${ID}"]`), 'a failed batch still offered Mark paid').toBeNull()
    expect(m.el.querySelector(`[data-failed-for="${ID}"]`), 'a failed batch still offered Mark failed').toBeNull()
    // The CSV stays: the artifact is the record of what was exported, whatever
    // happened to the payment afterwards.
    expect(m.el.querySelector(`[data-csv="${ID}"]`)).not.toBeNull()
  })

  it('leaves the failed column empty on a batch that has not failed, without reading null', async () => {
    const m = await mount([batch, { ...batch, batch_id: 'batch_2026-09-11_def', paid_at: '2026-09-11T10:00:00.000Z' }])
    expect(squish(m.el.querySelector(`[data-failed-at="${ID}"]`)?.textContent ?? null)).toBe('—')
    expect(squish(m.el.querySelector('[data-failed-at="batch_2026-09-11_def"]')?.textContent ?? null)).toBe('—')
    expect(m.el.querySelector(`[data-paid-for="${ID}"]`), 'an open batch was not offered Mark paid').not.toBeNull()
    expect(m.el.querySelector('[data-paid-for="batch_2026-09-11_def"]'), 'a paid batch still offered Mark paid').toBeNull()
  })

  it('shows a batch marked failed the moment the response says so', async () => {
    const m = await mount([batch])
    m.click(`[data-failed-for="${ID}"]`)
    await settle(m.fixture)
    m.click('[data-confirm] [data-go]')
    await drain()
    m.http.expectOne(`${BATCHES}/${ID}/failed`).flush({ ...batch, failed_at: '2026-09-11T09:00:00.000Z' })
    await drain()
    m.http.expectOne(BATCHES).flush([{ ...batch, failed_at: '2026-09-11T09:00:00.000Z' }])
    await settle(m.fixture)
    expect(squish(m.el.querySelector(`[data-failed-at="${ID}"]`)?.textContent ?? null)).toContain('Sep 11, 2026')
    expect(m.el.querySelector(`[data-failed-for="${ID}"]`)).toBeNull()
  })

  it('tells the operator when the list did not load, and warns off a second batch', async () => {
    const m = await mount({ status: 500 })
    expect(m.text()).toContain('Do not create another batch until it loads')
  })

  it('does not claim a batch was created when the request failed', async () => {
    const m = await mount([])
    m.click('[data-create]')
    await settle(m.fixture)
    m.click('[data-confirm] [data-go]')
    await drain()
    m.http.expectOne(BATCHES).flush({ error: 'internal' }, { status: 500, statusText: 'Server Error' })
    await settle(m.fixture)
    m.http.expectNone(BATCHES)
    expect(squish(m.el.querySelector('[data-failed]')?.textContent ?? null))
      .toContain('a batch may have been created and debited')
  })
})
