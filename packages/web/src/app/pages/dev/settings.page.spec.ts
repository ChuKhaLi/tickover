import { Component } from '@angular/core'
import { TestBed } from '@angular/core/testing'
import { provideHttpClient } from '@angular/common/http'
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing'
import { provideLocationMocks } from '@angular/common/testing'
import { Router, provideRouter } from '@angular/router'
import { describe, it, expect } from 'vitest'
import { RULES, type DataSummary, type DeveloperSelf } from '@tickover/contract'
import SettingsPage from './settings.page'
import DevelopersPage from '../developers.page'
import { AuthState } from '../../lib/auth'
import { formatCents } from '../../lib/money'

const DEV: DeveloperSelf = {
  id: '8f0b0f2e-6f6a-4a3a-9c1f-0f1e2d3c4b5a',
  github_login: 'octo',
  balance_pending_cents: 0,
  balance_available_cents: 0,
  today_paid_answers: 0,
  activity_tier: 'regular',
  can_cash_out: true,
  payout_method: null,
}

const DATA: DataSummary = {
  github_login: 'octo',
  os: 'win32',
  tool_version: '2.1.90',
  country: 'VN',
  language_mix: { python: 3, typescript: 40 },
  turns_recorded: 12,
  answers_recorded: 3,
  first_seen_at: '2026-09-01T00:00:00.000Z',
  last_seen_at: null,
}

/**
 * Spec §5.5: "The consent screen lists exactly these lists. The developer web page
 * mirrors them." Task 3 wrote them on `/developers`, so these three are quoted from
 * that file, and the test near the bottom reads both pages and demands both carry
 * them — the only thing that stops the two drifting apart.
 */
const SENT = 'GitHub id, operating system, Claude Code version, when each turn starts and stops, counts of file extensions in your project directory, and your answers with how long you took and where you answered them (terminal pane, local page, VS Code, or inside Claude Code)'
const DERIVED = 'your country, from the IP address of the request, and an activity tier from how many turns you run a week (light under 5, regular 5 to 20, heavy over 20)'
const NEVER = 'prompts, file contents, file paths, repository names, repository owners, or transcripts'

/**
 * Everything the delete section accounts for: which side of the deletion it falls
 * on, the phrase that says so, and whether the data page above also shows it.
 *
 * `turns_recorded` and `last_seen_at` are cleared under different words than their
 * labels; `answers_recorded` and `first_seen_at` are kept, the first as an accounting
 * record and the second because the anonymised row itself survives.
 *
 * The `shown: false` entries are the reason this map has two jobs rather than one.
 * The first version keyed only on `[data-field]`, which made it structurally blind
 * to anything the data page does not render — and `github_created_at` survived a
 * deletion, unnamed by either bullet, for exactly that reason. Listing them here
 * pins the copy; only `test/api/dev-web.test.ts` can pin that the list is complete,
 * because completeness is a property of the developers table and no test in this
 * package can read it.
 */
const DELETION_SIDE: Record<string, { side: 'removes' | 'keeps'; phrase: string; shown: boolean }> = {
  github_login: { side: 'removes', phrase: 'GitHub login', shown: true },
  os: { side: 'removes', phrase: 'operating system', shown: true },
  tool_version: { side: 'removes', phrase: 'Claude Code version', shown: true },
  country: { side: 'removes', phrase: 'country', shown: true },
  activity_tier: { side: 'removes', phrase: 'activity tier', shown: true },
  language_mix: { side: 'removes', phrase: 'file-extension counts', shown: true },
  turns_recorded: { side: 'removes', phrase: 'every turn we recorded', shown: true },
  last_seen_at: { side: 'removes', phrase: 'last-seen time', shown: true },
  answers_recorded: { side: 'keeps', phrase: 'your answers', shown: true },
  first_seen_at: { side: 'keeps', phrase: 'the date you first signed up', shown: true },
  account_id: { side: 'keeps', phrase: 'an internal id', shown: false },
  github_id: { side: 'keeps', phrase: 'your GitHub id', shown: false },
  // Kept until the column was made nullable. It was `notNull`, so "clear it" meant
  // writing a date that was never true -- the page said so honestly and the outcome
  // was still wrong. Unlike `github_id`, which blocks re-registration, it had no
  // retention purpose, so it is cleared now and named on the other bullet.
  github_created_at: { side: 'removes', phrase: 'the date your GitHub account was created', shown: false },
}

@Component({ template: 'somewhere else' })
class Elsewhere {}

/** One macrotask drains every pending microtask; `whenStable()` alone does not. */
async function settle(fixture: { whenStable(): Promise<unknown>; detectChanges(): void }) {
  await fixture.whenStable()
  await new Promise((ok) => setTimeout(ok, 0))
  fixture.detectChanges()
}

const flat = (el: HTMLElement) => (el.textContent ?? '').replace(/\s+/g, ' ')

function mount(over: Partial<DeveloperSelf> = {}) {
  TestBed.resetTestingModule()
  TestBed.configureTestingModule({
    providers: [
      provideHttpClient(), provideHttpClientTesting(), provideLocationMocks(),
      provideRouter([{ path: 'developers', component: Elsewhere }, { path: 'somewhere', component: Elsewhere }]),
    ],
  })
  const auth = TestBed.inject(AuthState)
  auth.developer.set({ ...DEV, ...over })
  const fixture = TestBed.createComponent(SettingsPage)
  fixture.detectChanges()
  return { fixture, auth, http: TestBed.inject(HttpTestingController), el: fixture.nativeElement as HTMLElement, router: TestBed.inject(Router) }
}

/** Renders the page with the data summary already answered. */
async function withData(data: DataSummary | { status: number } = DATA, over: Partial<DeveloperSelf> = {}) {
  const out = mount(over)
  const req = out.http.expectOne('/api/dev/web/data')
  if ('status' in data) req.flush({ error: 'internal' }, { status: data.status, statusText: 'Server Error' })
  else req.flush(data)
  await settle(out.fixture)
  return { ...out, text: flat(out.el) }
}

function typeInto(input: HTMLInputElement, value: string) {
  input.value = value
  input.dispatchEvent(new Event('input'))
}

const payoutInput = (el: HTMLElement) => el.querySelector('input[name=paypal]') as HTMLInputElement
const confirmInput = (el: HTMLElement) => el.querySelector('input[name=confirm]') as HTMLInputElement
const deleteButton = (el: HTMLElement) => el.querySelector('button[data-delete]') as HTMLButtonElement
const saveButton = (el: HTMLElement) => el.querySelector('button[data-save]') as HTMLButtonElement
const field = (el: HTMLElement, name: string) => ((el.querySelector(`[data-field=${name}]`)?.textContent ?? '').replace(/\s+/g, ' ').trim())

describe('developer SettingsPage', () => {
  // The brief's test, restructured. As written it awaited `savePayout()` before the
  // request that promise waits on had been flushed, which cannot resolve — the test
  // hung until vitest timed it out. The click happens, the request is flushed, and
  // the render is settled afterwards.
  it('saves the payout email, shows the data summary, and requires typing delete', async () => {
    const { fixture, auth, http, el } = await withData()
    expect(flat(el)).toContain('typescript: 40')
    expect(flat(el)).toContain('Never collected')

    typeInto(payoutInput(el), 'me@pp.test')
    await settle(fixture)
    saveButton(el).click()
    const put = http.expectOne('/api/dev/web/payout-method')
    expect(put.request.method).toBe('PUT')
    expect(put.request.body).toEqual({ type: 'paypal', email: 'me@pp.test' })
    put.flush({ ...DEV, payout_method: { type: 'paypal', email: 'me@pp.test' } })
    await settle(fixture)
    expect(auth.developer()!.payout_method).toEqual({ type: 'paypal', email: 'me@pp.test' })
    expect(flat(el)).toContain('Saved')

    expect(deleteButton(el).disabled, 'delete is armed before the word is typed').toBe(true)
    typeInto(confirmInput(el), 'delete')
    await settle(fixture)
    expect(deleteButton(el).disabled).toBe(false)
  })

  // Typed, not assigned. Setting the component field proves the request builder;
  // only an event off the element proves the box the developer types into is the
  // one wired to it.
  it('sends the address that was typed', async () => {
    const { fixture, http, el } = await withData()
    typeInto(payoutInput(el), 'me@pp.test')
    await settle(fixture)
    saveButton(el).click()
    expect(http.expectOne('/api/dev/web/payout-method').request.body).toEqual({ type: 'paypal', email: 'me@pp.test' })
  })

  // The trim cannot be reached from the DOM, and that is a measurement rather than
  // an assumption: `type=email` runs the HTML value-sanitization algorithm, which
  // strips leading and trailing whitespace before `ngModel` ever sees the value, so
  // a mutant dropping `.trim()` survived every element-driven test in this file. It
  // is asserted here instead of deleted — the trim is what makes the page's
  // behaviour its own rather than borrowed from one input type's sanitizer.
  it('trims the address before it goes on the wire', async () => {
    const { fixture, http } = await withData()
    fixture.componentInstance.paypalEmail = '  me@pp.test  '
    const saving = fixture.componentInstance.savePayout()
    const put = http.expectOne('/api/dev/web/payout-method')
    expect(put.request.body).toEqual({ type: 'paypal', email: 'me@pp.test' })
    put.flush({ ...DEV, payout_method: { type: 'paypal', email: 'me@pp.test' } })
    await saving
  })

  // An address already on file belongs in the box, or the developer cannot see what
  // they are about to replace and an empty field reads as "no payout method set".
  it('starts from the address already on file', async () => {
    const { el } = await withData(DATA, { payout_method: { type: 'paypal', email: 'old@pp.test' } })
    expect(payoutInput(el).value).toBe('old@pp.test')
  })

  // Nothing to send, so nothing is sent, and the control says so rather than firing
  // a request the server answers 400.
  it('does not send an empty address', async () => {
    const { fixture, http, el } = await withData()
    expect(saveButton(el).disabled).toBe(true)
    saveButton(el).click()
    http.expectNone('/api/dev/web/payout-method')
    // The disabled control is the first gate and nothing in the DOM gets past it,
    // so the second one is asserted through the instance. Without it a mis-wired
    // binding would put an empty address on the wire, and the server's 400 is the
    // only thing that would say so.
    // Not awaited: the request would be issued before this promise settles, and
    // awaiting a call that never reaches a flush turns a clean assertion failure
    // into a five-second timeout.
    void fixture.componentInstance.savePayout()
    http.expectNone('/api/dev/web/payout-method')
    typeInto(payoutInput(el), 'me@pp.test')
    await settle(fixture)
    expect(saveButton(el).disabled).toBe(false)
  })

  // A rejected save left the page silent, so the developer walked away believing
  // their payout address was on file when the server had never taken it.
  it('says the payout address was not saved, and does not claim it was', async () => {
    const { fixture, http, el } = await withData()
    typeInto(payoutInput(el), 'me@pp.test')
    await settle(fixture)
    saveButton(el).click()
    http.expectOne('/api/dev/web/payout-method').flush({ error: 'invalid' }, { status: 400, statusText: 'Bad Request' })
    await settle(fixture)
    expect(flat(el)).toContain("Couldn't save")
    expect(flat(el)).not.toContain('Saved.')
  })

  // Every field the server says it holds, and nothing left off. `dataSummary` on the
  // server is what `deleteDeveloperAccount` clears, field for field, so a field
  // missing here is a field the delete copy promises to remove without ever
  // admitting it was held.
  it('shows every field in the data summary, plus the tier that is not in it', async () => {
    const { el } = await withData({ ...DATA, last_seen_at: '2026-09-05T08:00:00.000Z' })
    const shown = Array.from(el.querySelectorAll('[data-field]'), (n) => n.getAttribute('data-field'))
    for (const key of Object.keys(DATA)) expect(shown, `${key} is held about the developer but not shown`).toContain(key)
    // Activity tier is not in `DataSummary`; it is on the principal, and spec §5.5
    // names it as one of the two fields derived on the server. Left off, the page
    // discloses a country it derives and stays quiet about a tier buyers target on.
    expect(shown, 'the derived activity tier is not shown').toContain('activity_tier')

    expect(field(el, 'github_login')).toBe('octo')
    expect(field(el, 'os')).toBe('win32')
    expect(field(el, 'tool_version')).toBe('2.1.90')
    expect(field(el, 'country')).toBe('VN')
    expect(field(el, 'activity_tier')).toBe('regular')
    expect(field(el, 'turns_recorded')).toBe('12')
    expect(field(el, 'answers_recorded')).toBe('3')
    expect(field(el, 'language_mix')).toContain('typescript: 40')
    // Read as a date rather than handed over as the wire string.
    expect(field(el, 'last_seen_at')).not.toBe('')
    expect(flat(el)).not.toContain('2026-09-05T08:00:00.000Z')
  })

  // Biggest first: an unordered dump of thirty extensions buries the one the
  // developer would recognise.
  it('orders the language counts by size', async () => {
    const { el } = await withData()
    const mix = field(el, 'language_mix')
    expect(mix.indexOf('typescript: 40')).toBeLessThan(mix.indexOf('python: 3'))
  })

  // A developer who has only just installed the plugin has nulls in most columns.
  // Rendered raw that reads as the literal word "null" against "Operating system".
  it('reads empty fields as blanks, not as nulls', async () => {
    const { el, text } = await withData({ ...DATA, os: null, tool_version: null, language_mix: {}, last_seen_at: null })
    expect(text).not.toContain('null')
    expect(field(el, 'os')).not.toBe('')
    expect(field(el, 'language_mix')).not.toBe('')
  })

  // The load can fail like any other request. Silence here reads as "we hold nothing
  // about you", which is the one wrong answer this section can give.
  it('says the data summary could not be read', async () => {
    const { text } = await withData({ status: 500 })
    expect(text).toContain("Couldn't load")
    // The three lists are the disclosure and do not depend on the request, so they
    // stay on the page whether or not the values arrived.
    expect(text).toContain(NEVER)
  })

  // Spec §5.5: "The consent screen lists exactly these lists. The developer web page
  // mirrors them." This is what stops the two pages disagreeing about what leaves a
  // developer's machine.
  it('mirrors the three lists on the public developers page', async () => {
    const { text } = await withData()
    for (const claim of [SENT, DERIVED, NEVER]) expect(text, 'the settings page is missing one of spec 5.5s lists').toContain(claim)

    TestBed.resetTestingModule()
    TestBed.configureTestingModule({ providers: [provideRouter([])] })
    const publicPage = TestBed.createComponent(DevelopersPage)
    publicPage.detectChanges()
    const publicText = flat(publicPage.nativeElement as HTMLElement)
    for (const claim of [SENT, DERIVED, NEVER]) expect(publicText, 'the public page moved and the settings page did not follow').toContain(claim)
  })

  // The rights-exercising screen. Deletion anonymises: the answers, the ledger
  // entries and the payouts stay, because a buyer has already been charged for them.
  // Saying "deleted" and meaning "most of it" is worse here than saying nothing.
  it('says what deletion actually does, including what it keeps', async () => {
    const { el, text } = await withData()
    // Scoped to the bullet that makes the claim. Unscoped, "answers" is also in
    // the sent-from-your-machine list two sections up, so the assertion passed
    // with the whole "Kept" bullet rewritten — measured.
    const keeps = (el.querySelector('[data-keeps]')?.textContent ?? '').replace(/\s+/g, ' ')
    expect(keeps, 'the developer is not told their answers survive').toContain('answers')
    expect(keeps).toContain('ledger')
    expect(text, 'the bar on coming back is not disclosed').toContain('cannot be used with Tickover again')
    expect(text, 'an unpaid balance is silently forfeited').toContain('not yet paid out')
    expect(text).toContain(formatCents(RULES.PAYOUT_MIN_CENTS))
    // The one promise the server does not keep.
    expect(text).not.toContain('erased')
  })

  // Every field the data page shows has to be accounted for by the delete section, on
  // one side or the other. The map below is that accounting, and the first assertion
  // is that it covers exactly the fields on the page — so adding a field to the data
  // page without saying what deletion does to it fails here. That drift is how the
  // activity tier came to be shown on the page, cleared by the server, and still
  // missing from the Removed list.
  it('accounts for every field it shows on one side of the deletion or the other', async () => {
    const { el } = await withData()
    const shown = Array.from(el.querySelectorAll('[data-field]'), (n) => n.getAttribute('data-field')!)
    expect(shown.length).toBeGreaterThan(0)
    const accountedFor = Object.entries(DELETION_SIDE).filter(([, v]) => v.shown).map(([k]) => k)
    expect(accountedFor.sort(), 'a field on the data page is not accounted for by the delete copy').toEqual([...shown].sort())
    const bullet = (side: string) => (el.querySelector(`[data-${side}]`)?.textContent ?? '').replace(/\s+/g, ' ')
    for (const [field, { side, phrase, shown: isShown }] of Object.entries(DELETION_SIDE)) {
      const where = isShown ? 'is on the data page' : 'survives out of sight'
      expect(bullet(side), `${field} ${where} but the "${side}" bullet does not name it`).toContain(phrase)
    }
  })

  // The word, the request, the principal, and the exit — in that order, because a
  // page that navigates without calling the endpoint deletes nothing, and one that
  // calls it without clearing the principal leaves a deleted developer's login in a
  // root signal for whoever signs in next on this machine.
  it('deletes the account only after the word is typed, then signs out and leaves', async () => {
    const { fixture, auth, http, el, router } = await withData()
    await router.navigateByUrl('/somewhere')
    deleteButton(el).click()
    http.expectNone({ method: 'DELETE', url: '/api/dev/web/me' })

    typeInto(confirmInput(el), 'delete')
    await settle(fixture)
    deleteButton(el).click()
    http.expectOne({ method: 'DELETE', url: '/api/dev/web/me' }).flush(null, { status: 204, statusText: 'No Content' })
    await settle(fixture)
    expect(auth.developer()).toBeNull()
    expect(router.url).toBe('/developers')
  })

  // The button is disabled until the word is typed, so nothing in the DOM can reach
  // this guard. It is asserted through the instance deliberately: it is the second
  // gate on an irreversible action, and a line with nothing watching it is the line
  // the next cleanup deletes.
  it('refuses to delete when the word has not been typed, whatever the control says', async () => {
    const { fixture, http } = await withData()
    // Not awaited, for the reason above: the request is issued before this promise
    // settles, and awaiting one that is never flushed turns a clean assertion
    // failure into a five-second timeout.
    void fixture.componentInstance.remove()
    http.expectNone({ method: 'DELETE', url: '/api/dev/web/me' })
  })

  // The opposite failure: the account is still there, so the page must not behave as
  // though it is gone. Clearing the principal and leaving would show a signed-out
  // page over a live account and hide the fact that nothing was deleted.
  it('keeps the developer signed in and says so when deletion fails', async () => {
    const { fixture, auth, http, el, router } = await withData()
    await router.navigateByUrl('/somewhere')
    typeInto(confirmInput(el), 'delete')
    await settle(fixture)
    deleteButton(el).click()
    http.expectOne({ method: 'DELETE', url: '/api/dev/web/me' }).flush({ error: 'internal' }, { status: 500, statusText: 'Server Error' })
    await settle(fixture)
    expect(auth.developer()).toMatchObject({ id: DEV.id })
    expect(router.url).toBe('/somewhere')
    expect(flat(el)).toContain("Couldn't delete your account")
  })
})
