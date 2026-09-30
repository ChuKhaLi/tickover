import { Component } from '@angular/core'
import { TestBed } from '@angular/core/testing'
import { provideHttpClient } from '@angular/common/http'
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing'
import { provideLocationMocks } from '@angular/common/testing'
import { provideRouter } from '@angular/router'
import { describe, it, expect } from 'vitest'
import { HistoryRow, RULES, type DeveloperSelf, type HistoryResponse } from '@tickover/contract'
import EarningsPage from './index.page'
import { AuthState } from '../../lib/auth'
import { formatCents } from '../../lib/money'

const DEV: DeveloperSelf = {
  id: '8f0b0f2e-6f6a-4a3a-9c1f-0f1e2d3c4b5a',
  github_login: 'octo',
  balance_pending_cents: 250,
  balance_available_cents: 1200,
  today_paid_answers: 3,
  activity_tier: 'regular',
  can_cash_out: true,
  payout_method: null,
  payout_method_needs_confirm: false,
  unclaimed_cents: 0,
  unclaimed_email: null,
}

/**
 * The shape the server actually mints (R36): an ISO instant, a pipe, and the id of
 * the last answer on the page. Nothing on this page may read any of that — it goes
 * back exactly as it arrived — so these tests carry the real shape rather than the
 * brief's bare timestamp, and one below sends a cursor that is not a date at all.
 */
const CURSOR = '2026-09-10T10:00:00.000Z|4d0a1b2c-3e4f-4a5b-8c9d-0e1f2a3b4c5d'
const CURSOR_URL = '/api/dev/web/history?cursor=2026-09-10T10%3A00%3A00.000Z%7C4d0a1b2c-3e4f-4a5b-8c9d-0e1f2a3b4c5d'

const row = (over: Partial<HistoryRow> = {}): HistoryRow => ({
  answered_at: '2026-09-10T10:00:00.000Z',
  sponsor: 'Acme',
  study_title: 'Tagline',
  kind: 'choice',
  cents: 50,
  status: 'pending',
  source: 'pane',
  ...over,
})

@Component({ template: 'somewhere else' })
class Elsewhere {}

/** One macrotask drains every pending microtask; `whenStable()` alone does not. */
async function settle(fixture: { whenStable(): Promise<unknown>; detectChanges(): void }) {
  await fixture.whenStable()
  await new Promise((ok) => setTimeout(ok, 0))
  fixture.detectChanges()
}

function mount(over: Partial<DeveloperSelf> = {}) {
  TestBed.resetTestingModule()
  TestBed.configureTestingModule({
    providers: [
      provideHttpClient(), provideHttpClientTesting(), provideLocationMocks(),
      provideRouter([{ path: 'dev/settings', component: Elsewhere }]),
    ],
  })
  TestBed.inject(AuthState).developer.set({ ...DEV, ...over })
  const fixture = TestBed.createComponent(EarningsPage)
  fixture.detectChanges()
  return { fixture, http: TestBed.inject(HttpTestingController), el: fixture.nativeElement as HTMLElement }
}

/** Renders the page and answers the first history request with `body`, or a failure. */
async function withHistory(body: HistoryResponse | { status: number }, over: Partial<DeveloperSelf> = {}) {
  const out = mount(over)
  const req = out.http.expectOne('/api/dev/web/history')
  if ('status' in body) req.flush({ error: 'internal' }, { status: body.status, statusText: 'Server Error' })
  else req.flush(body)
  await settle(out.fixture)
  return { ...out, text: (out.el.textContent ?? '').replace(/\s+/g, ' ') }
}

const moreButton = (el: HTMLElement) => el.querySelector('button[data-more]') as HTMLButtonElement | null
const flat = (el: HTMLElement) => (el.textContent ?? '').replace(/\s+/g, ' ')

/**
 * All four legend notes, quoted from `index.page.ts`. Golden strings, in this repo's
 * older sense: this legend is where a developer reads whether they have been paid, it
 * has produced one Critical and been reworded twice, and both times the wrongness was
 * a single clause that every substring assertion still matched.
 *
 * All four rather than only `released`, because a false payment claim is false on
 * whichever row it lands: pinning one note leaves the other three free to make it.
 * Measured — appending "This money has already been paid into your PayPal account."
 * to the `pending` note passed 11 of 11 while only `released` was pinned.
 *
 * Byte equality subsumes the two structural checks this replaced (all notes distinct,
 * no note borrowing another's clause): four different constants cannot be satisfied by
 * a shared or copied sentence. Those two assertions were dropped rather than kept as
 * lines nothing can turn red (R57).
 */
const STATUS_NOTES: Record<HistoryRow['status'], string> = {
  pending: 'credited when you answered, and held until that study closes.',
  released: 'cleared out of pending when that study closed. The row goes on saying released once that money is in a payout run, so this column cannot tell you whether you have been paid — and nor can the Available balance above, which drops to zero as soon as a run is exported, days before the money is sent. This page does not show payout runs yet.',
  reversed: 'taken back when the study closed, because the answer did not pass its quality checks.',
  unpaid: 'nothing was owed: an unpaid profile question, or an answer with no entry against it yet.',
}

/**
 * One legend row's note, read from the definition beside its term.
 *
 * The legend is a record now, so the term and the note are two elements rather than
 * one string with an em dash in the middle of it. That is the point of the change --
 * a joining mark was doing the work a column should -- and it is why this no longer
 * strips a prefix: there is no prefix, and the term is asserted on its own.
 */
function noteFor(el: HTMLElement, status: string): string {
  const term = el.querySelector(`[data-statuses] [data-status="${status}"]`)
  expect(term?.textContent?.trim(), `the ${status} row is not labelled with its own status`).toBe(status)
  const note = term?.nextElementSibling
  expect(note?.tagName, `the ${status} term has no definition beside it`).toBe('DD')
  return (note?.textContent ?? '').replace(/\s+/g, ' ').trim()
}

describe('developer EarningsPage', () => {
  // The brief's test, with two changes. `whenStable()` on its own lands before the
  // flushed response has been rendered, so it goes through `settle`; and the cursor
  // sent back carries R36's real `<iso>|<uuid>` shape, so the round trip is proved
  // on a string a page tempted to read a date out of would choke on.
  it('shows balances, the payout hint, and paginated history', async () => {
    const { fixture, http, el, text } = await withHistory({ rows: [row()], next_cursor: CURSOR })
    expect(text).toContain('$2.50')
    expect(text).toContain('$12.00')
    expect(text).toContain('3 / 10')
    expect(text).toContain('Set your PayPal email in Settings')
    expect(text).toContain('Acme')

    moreButton(el)!.click()
    http.expectOne(CURSOR_URL).flush({ rows: [], next_cursor: null })
    await settle(fixture)
    expect(moreButton(el)).toBeNull()
  })

  // R36 in one assertion. The cursor below is not a timestamp, cannot be parsed as
  // one, and is not the shape the server mints today — which is the point: the only
  // correct thing to do with it is hand it straight back. A page that reformatted a
  // date, or rebuilt a cursor out of the last row's `answered_at`, sends a different
  // string and silently loses whatever sat between the two.
  it('sends the cursor back exactly as the server wrote it', async () => {
    const { fixture, http, el } = await withHistory({ rows: [row()], next_cursor: 'opaque:page-2' })
    moreButton(el)!.click()
    http.expectOne('/api/dev/web/history?cursor=opaque%3Apage-2').flush({ rows: [row({ study_title: 'Second page' })], next_cursor: null })
    await settle(fixture)
    expect(flat(el)).toContain('Second page')
  })

  // Both pages stay on screen. An `update` that replaced rather than appended would
  // pass the assertion above and lose the developer's first fifty answers.
  it('adds the next page to the rows already on screen', async () => {
    const { fixture, http, el } = await withHistory({ rows: [row({ study_title: 'First page' })], next_cursor: CURSOR })
    moreButton(el)!.click()
    http.expectOne(CURSOR_URL).flush({ rows: [row({ study_title: 'Second page' })], next_cursor: null })
    await settle(fixture)
    const rendered = Array.from(el.querySelectorAll('tbody tr'), (tr) => tr.textContent ?? '')
    expect(rendered).toHaveLength(2)
    expect(rendered.join(' ')).toContain('First page')
    expect(rendered.join(' ')).toContain('Second page')
  })

  // Two clicks before the first answer arrives. Without an in-flight guard the same
  // cursor is fetched twice and both answers are appended, so the developer sees
  // those answers — and those 50-cent amounts — listed twice.
  it('does not fetch the same page twice when the button is clicked twice', async () => {
    const { fixture, http, el } = await withHistory({ rows: [row()], next_cursor: CURSOR })
    moreButton(el)!.click()
    moreButton(el)!.click()
    const pending = http.match(CURSOR_URL)
    expect(pending).toHaveLength(1)
    pending[0]!.flush({ rows: [row({ study_title: 'Second page' })], next_cursor: null })
    await settle(fixture)
    expect(el.querySelectorAll('tbody tr')).toHaveLength(2)
  })

  // A rejected first load left the page showing an empty history, which reads as
  // "you have earned nothing" on the one screen where that is a money claim.
  it('says the history could not be loaded, rather than showing an empty one', async () => {
    const { text } = await withHistory({ status: 500 })
    expect(text).toContain("Couldn't load your history")
    expect(text).not.toContain('No answers yet')
    expect(text).not.toContain('Loading')
  })

  // The other half: an empty history really is empty, and says so rather than
  // drawing a header row over nothing.
  it('says so when there is no history yet', async () => {
    const { text } = await withHistory({ rows: [], next_cursor: null })
    expect(text).toContain('No answers yet')
    expect(text).not.toContain("Couldn't load")
  })

  // A failed second page must not look like the end of the history: the button stays,
  // because the cursor is still good and there are older answers behind it.
  it('keeps the button and says so when the next page fails', async () => {
    const { fixture, http, el } = await withHistory({ rows: [row()], next_cursor: CURSOR })
    moreButton(el)!.click()
    http.expectOne(CURSOR_URL).flush({ error: 'internal' }, { status: 500, statusText: 'Server Error' })
    await settle(fixture)
    expect(flat(el)).toContain("Couldn't load the next page")
    expect(moreButton(el), 'the cursor is still good, so the button must stay').not.toBeNull()
  })

  // Every status the contract can send has to mean something to the person reading
  // it, and `released` has to be handled with care in both directions. It is not a
  // synonym for paid — but it is not a synonym for unpaid either, which is the
  // mistake the first version of this test enforced.
  //
  // Read per status, not over the whole legend. A concatenated presence check is
  // satisfied by the right sentence attached to the wrong status, and by a second
  // sentence contradicting the first — both measured on the version this replaced.
  it('gives every status its own note, pinned to the byte', async () => {
    const statuses = HistoryRow.shape.status.options
    // Without this the assertions below could pass by finding nothing.
    expect(statuses.length).toBeGreaterThan(3)
    const { el } = await withHistory({ rows: statuses.map((status) => row({ status, study_title: `Row ${status}` })), next_cursor: null })
    const legend = el.querySelector('[data-statuses]')
    expect(legend, 'no status legend on the page').not.toBeNull()

    // One row per status, and exactly those: a fifth status added to the contract
    // has to arrive here with a note of its own, and `STATUS_NOTES` will not compile
    // without one either.
    const labelled = Array.from(legend!.querySelectorAll('[data-status]'), (n) => n.getAttribute('data-status'))
    expect([...labelled].sort()).toEqual([...statuses].sort())

    for (const status of statuses) {
      expect(noteFor(el, status), `the ${status} note has been reworded`).toBe(STATUS_NOTES[status])
    }
  })

  // Cents, never the integer. 1200 rendered raw reads as twelve hundred dollars on
  // the screen whose whole job is saying what the developer is owed.
  it('renders every amount from cents', async () => {
    const { text } = await withHistory({ rows: [row({ cents: 50 })], next_cursor: null })
    expect(text).toContain('$0.50')
    expect(text).not.toContain('1200')
    expect(text).not.toContain('250')
  })

  // R49: the payout minimum and the account-age rule are configuration, so the copy
  // reads them out of the contract. Mutating `PAYOUT_MIN_CENTS` in `packages/contract`
  // and rebuilding is what proves it — with a literal on the page this test then
  // demands a figure the page does not carry.
  it('quotes the payout minimum and the account age from the contract', async () => {
    const { text } = await withHistory({ rows: [], next_cursor: null }, { can_cash_out: false })
    expect(text).toContain(formatCents(RULES.PAYOUT_MIN_CENTS))
    expect(text).toContain(`${RULES.GITHUB_MIN_AGE_MONTHS} months old`)
    expect(text).toContain(`3 / ${RULES.MAX_PAID_PER_DAY}`)
  })

  // Both hints, both ways round. Each is advice about money that is wrong in the
  // other state: telling a developer with a PayPal address on file to go and set one
  // sends them to a page with nothing to do, and keeping the account-age rule from
  // someone who cannot be paid yet leaves them waiting for a payout that will not come.
  it('shows each payout hint only in the state it applies to', async () => {
    const none = await withHistory({ rows: [], next_cursor: null }, { payout_method: null, can_cash_out: true })
    expect(none.text).toContain('Set your PayPal email in Settings')
    expect(none.text).not.toContain('months old')

    const both = await withHistory({ rows: [], next_cursor: null }, { payout_method: { type: 'paypal', email: 'me@pp.test' }, can_cash_out: false })
    expect(both.text).not.toContain('Set your PayPal email in Settings')
    expect(both.text).toContain(`${RULES.GITHUB_MIN_AGE_MONTHS} months old`)
  })

  // R515: unclaimed money is a state neither balance above can describe — it left
  // pending when the study closed, and left available when the run exported, so it
  // reads zero on both cards unless something says it is sitting at PayPal instead.
  // Both banners render off `auth.developer()` directly, so the history request
  // does not need to be flushed to see them.
  // The address named is `unclaimed_email` -- frozen on the payout row at batch creation -- not
  // `payout_method.email`, which is whatever the developer has saved since. The fixture below gives
  // them different values on purpose: a page that read the wrong one would still pass a fixture
  // where both happened to match.
  it('tells the developer money is waiting for them at PayPal, naming the address it was sent to', () => {
    const { el } = mount({ unclaimed_cents: 2500, unclaimed_email: 'old@pp.test', payout_method: { type: 'paypal', email: 'new@pp.test' } })
    const note = el.querySelector('[data-unclaimed]')
    expect(note?.textContent).toContain('$25.00')
    expect(note?.textContent).toContain('old@pp.test')
    expect(note?.textContent).not.toContain('new@pp.test')
    expect(note?.textContent).toContain('30 days')
  })

  // The address itself is what failed, and Settings is the only page that can fix
  // it, so the notice has to send the developer there.
  it('tells the developer to confirm a PayPal address that could not be paid, linking to Settings', () => {
    const { el } = mount({ payout_method_needs_confirm: true, payout_method: { type: 'paypal', email: 'me@pp.test' } })
    const note = el.querySelector('[data-needs-confirm]')
    expect(note?.textContent).toContain('could not deliver')
    expect(note?.querySelector('a')?.getAttribute('href')).toBe('/dev/settings')
  })

  // Both notices are for a state, not a default: most developers hit neither.
  it('shows neither notice by default', () => {
    const { el } = mount()
    expect(el.querySelector('[data-unclaimed]')).toBeNull()
    expect(el.querySelector('[data-needs-confirm]')).toBeNull()
  })
})
