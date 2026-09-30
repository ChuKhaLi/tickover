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

// `status_counts.exported` matches `count`: this batch is freshly created, so
// every payout in it is still awaiting either Send via PayPal or a CSV mark
// (R518). A batch this branch's earlier tests built before PayPal Payouts
// existed had no such field; the default the contract applies for an older
// server's answer is `exported: 0`, which would hide Mark paid and Mark failed
// on every one of them (ruling: those buttons claim only rows still exported).
const batch = {
  batch_id: ID, adapter: 'manual-csv', count: 2, total_cents: 3500, artifact: CSV, created_at: '2026-09-10T10:00:00.000Z', paid_at: null, failed_at: null,
  status_counts: { exported: 2, sent: 0, unclaimed: 0, paid: 0, failed: 0, reversed: 0 },
}

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
 * request. No `<tk-shell>` here: everything asserted below has to be something
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
    expect(m.panel()).toContain('Nothing is sent yet')
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

describe('PayoutsPage — PayPal Payouts', () => {
  const sendable = { ...batch, sendable: true }
  const sentBatch = { ...batch, sent_at: '2026-09-10T11:00:00.000Z', provider_batch_id: 'PB-1', confirmed: true, sendable: false, refreshable: true, fees_cents: 70, status_counts: { exported: 0, sent: 1, unclaimed: 0, paid: 1, failed: 0, reversed: 0 } }
  const unconfirmedSent = { ...batch, sent_at: '2026-09-10T11:00:00.000Z', confirmed: false, sendable: true, status_counts: { exported: 0, sent: 2, unclaimed: 0, paid: 0, failed: 0, reversed: 0 } }

  it('offers Send via PayPal only on a batch the server calls sendable, behind a confirmation naming the total and the fee', async () => {
    const m = await mount([sendable])
    expect(m.el.querySelector(`[data-send-for="${ID}"]`)).not.toBeNull()
    m.click(`[data-send-for="${ID}"]`)
    m.fixture.detectChanges()
    expect(m.panel()).toContain(formatCents(3500))
    expect(m.panel()).toContain('2 developers')
    expect(m.panel()).toContain('2%')
    const m2 = await mount([batch])
    expect(m2.el.querySelector(`[data-send-for="${ID}"]`)).toBeNull()
  })

  // A resend's confirmation must not repeat the first-send claim that the whole batch total goes
  // out now -- an earlier send may already have paid some or all of it, and PayPal is not about to
  // pay any of it a second time regardless of what this dialog says. The 2%-on-top line is first-
  // send-only too: it was true of the money moving now, not of a batch already (partly) sent.
  it('says a resend goes to PayPal again, not that the whole total goes out now, and drops the first-send fee line', async () => {
    const m = await mount([unconfirmedSent])
    m.click(`[data-send-for="${ID}"]`)
    m.fixture.detectChanges()
    expect(m.panel()).toContain('sent again')
    expect(m.panel()).toContain('not pay')
    expect(m.panel()).not.toContain('2%')
    expect(m.panel()).not.toContain(formatCents(unconfirmedSent.total_cents))
  })

  it('sends, then reloads the list', async () => {
    const m = await mount([sendable])
    m.click(`[data-send-for="${ID}"]`)
    m.fixture.detectChanges()
    m.click('[data-confirm] [data-go]')
    m.http.expectOne(`${BATCHES}/${ID}/send`).flush(sentBatch)
    await drain()
    m.http.expectOne(BATCHES).flush([sentBatch])
    await settle(m.fixture)
    expect(m.el.querySelector(`[data-refresh-for="${ID}"]`)).not.toBeNull()
    expect(m.el.querySelector(`[data-paid-for="${ID}"]`)).toBeNull()
  })

  it('says a send PayPal did not confirm, and offers Send again', async () => {
    const m = await mount([unconfirmedSent])
    expect(m.el.querySelector(`[data-unconfirmed="${ID}"]`)?.textContent).toContain('not confirmed by PayPal')
    expect(m.el.querySelector(`[data-send-for="${ID}"]`)?.textContent).toContain('Send again')
  })

  it('refreshes a sent batch', async () => {
    const m = await mount([sentBatch])
    m.click(`[data-refresh-for="${ID}"]`)
    m.http.expectOne(`${BATCHES}/${ID}/refresh`).flush(sentBatch)
    await drain()
    m.http.expectOne(BATCHES).flush([sentBatch])
    await settle(m.fixture)
  })

  it('lists failed and reversed payouts with the reason', async () => {
    const m = await mount([{ ...sentBatch, problems: [{ payout_id: 'p1', github_login: 'octo', cents: 2500, status: 'failed', reason: 'RECEIVER_UNREGISTERED' }] }])
    const p = m.el.querySelector(`[data-problems="${ID}"]`)
    expect(p?.textContent).toContain('octo')
    expect(p?.textContent).toContain('RECEIVER_UNREGISTERED')
    expect(p?.textContent).toContain(formatCents(2500))
  })

  it('shows the error PayPal gave when a send fails', async () => {
    const m = await mount([sendable])
    m.click(`[data-send-for="${ID}"]`)
    m.fixture.detectChanges()
    m.click('[data-confirm] [data-go]')
    m.http.expectOne(`${BATCHES}/${ID}/send`).flush({ error: 'paypal_rejected', message: 'PayPal refused the batch: AUTHORIZATION_ERROR. It is unsent again; the CSV still works.' }, { status: 502, statusText: 'Bad Gateway' })
    await settle(m.fixture)
    expect(m.el.querySelector('[data-failed]')?.textContent).toContain('AUTHORIZATION_ERROR')
  })

  /**
   * Controller ruling 1: the gate on Mark paid / Mark failed is
   * `status_counts.exported > 0`, not merely the absence of `sent_at`. A batch
   * fully sent (nothing left exported) offers neither button, whether or not it
   * is also offering Refresh.
   */
  it('does not offer Mark paid or Mark failed on a sent batch with nothing left exported', async () => {
    const m = await mount([sentBatch])
    expect(m.el.querySelector(`[data-paid-for="${ID}"]`)).toBeNull()
    expect(m.el.querySelector(`[data-failed-for="${ID}"]`)).toBeNull()
  })

  /**
   * Controller ruling 2: any failed action shows the server's own `message`
   * when the error body carries one, not just the two actions Step 5 names by
   * example (`paypal_rejected` on send). `send_in_progress` is the case a
   * concurrent operator hits, and its message is the one line that tells them
   * what to do instead of retrying blind.
   */
  it('shows the server message on a 409 send-in-progress rather than the fixed fallback', async () => {
    const m = await mount([sendable])
    m.click(`[data-send-for="${ID}"]`)
    m.fixture.detectChanges()
    m.click('[data-confirm] [data-go]')
    m.http.expectOne(`${BATCHES}/${ID}/send`).flush({ error: 'send_in_progress', message: 'A send of this batch is already in progress. Wait a minute and reload.' }, { status: 409, statusText: 'Conflict' })
    await settle(m.fixture)
    expect(m.el.querySelector('[data-failed]')?.textContent).toContain('already in progress')
  })

  /**
   * Fix round 1 (review finding, extends R520). Paying the CSV after a PayPal
   * send may have gone through is a double payment, so the CSV button has to
   * disappear the moment a batch is sent -- confirmed or not, since an
   * unconfirmed send may still land. `[data-csv]` on an unsent batch is
   * already covered by "hands over the artifact bytes" and "draws a failed
   * batch as failed" above -- both fixtures have `sent_at` unset (spec (c)).
   */
  it('offers no CSV on a batch sent to PayPal but not yet confirmed', async () => {
    const m = await mount([unconfirmedSent])
    expect(m.el.querySelector(`[data-csv="${ID}"]`)).toBeNull()
  })

  it('offers no CSV on a batch PayPal has confirmed', async () => {
    const m = await mount([sentBatch])
    expect(m.el.querySelector(`[data-csv="${ID}"]`)).toBeNull()
  })
})
