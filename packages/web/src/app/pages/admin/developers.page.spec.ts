import { TestBed, type ComponentFixture } from '@angular/core/testing'
import { provideHttpClient } from '@angular/common/http'
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing'
import { provideRouter } from '@angular/router'
import { describe, it, expect } from 'vitest'
import { DeveloperStatusInput } from '@tickover/contract'
import DevelopersPage, { routeMeta } from './developers.page'
import { adminGuard } from '../../lib/auth'
import type { AdminDeveloper } from '../../lib/api'

const A = '8f0b0f2e-6f6a-4a3a-9c1f-0f1e2d3c4b5a'
const B = '22222222-2222-4222-8222-222222222222'
const url = (status: string) => `/api/admin/developers?status=${status}`

const dev = (over: Partial<AdminDeveloper> = {}): AdminDeveloper => ({
  id: A, github_login: 'octo', status: 'flagged', flag_reason: 'attention:abc', country: 'US',
  activity_tier: 'regular', created_at: '2026-03-01T10:00:00.000Z', last_seen_at: '2026-09-10T10:00:00.000Z', ...over,
})

/** One macrotask drains every pending microtask; `whenStable()` alone does not. */
async function settle(fixture: ComponentFixture<unknown>) {
  await fixture.whenStable()
  await new Promise((ok) => setTimeout(ok, 0))
  fixture.detectChanges()
}

const drain = () => new Promise((ok) => setTimeout(ok, 0))
const squish = (s: string | null) => (s ?? '').replace(/\s+/g, ' ').trim()

async function mount(rows: AdminDeveloper[] | { status: number } = [dev()]) {
  TestBed.resetTestingModule()
  TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])] })
  const fixture = TestBed.createComponent(DevelopersPage)
  fixture.detectChanges()
  const http = TestBed.inject(HttpTestingController)
  const req = http.expectOne(url('flagged'))
  if (Array.isArray(rows)) req.flush(rows)
  else req.flush({ error: 'internal' }, { status: rows.status, statusText: 'Server Error' })
  await settle(fixture)
  const el = fixture.nativeElement as HTMLElement
  return {
    fixture, http, el, page: fixture.componentInstance,
    text: () => squish(el.textContent),
    button: (selector: string) => el.querySelector(selector) as HTMLButtonElement,
    click: (selector: string) => {
      const b = el.querySelector(selector) as HTMLButtonElement | null
      if (!b) throw new Error(`no ${selector} on the page`)
      if (b.disabled) throw new Error(`${selector} is disabled`)
      b.click()
    },
    type: async (id: string, value: string) => {
      const box = el.querySelector(`[data-reason="${id}"]`) as HTMLInputElement
      box.value = value
      box.dispatchEvent(new Event('input'))
      await settle(fixture)
    },
    panel: () => squish((el.querySelector('[data-confirm]') as HTMLElement | null)?.textContent ?? null),
  }
}

describe('admin DevelopersPage', () => {
  it('is behind the admin guard', () => {
    expect(routeMeta.canActivate).toEqual([adminGuard])
  })

  it('opens on the flagged tab and switches status with the tab', async () => {
    const m = await mount([dev()])
    expect(m.text()).toContain('octo')
    expect(m.text()).toContain('attention:abc')
    // A formatted date, not the wire string. Asserted by absence of the raw form
    // as well as presence of a rendered one, because a page that prints the ISO
    // instant verbatim still contains the year.
    expect(m.text()).not.toContain('2026-09-10T10:00:00.000Z')
    expect(m.text()).toContain('Sep 10, 2026')
    expect(m.button('[data-tab="flagged"]').getAttribute('aria-pressed')).toBe('true')

    m.click('[data-tab="banned"]')
    await drain()
    m.http.expectOne(url('banned')).flush([dev({ id: B, github_login: 'deleted', status: 'banned', flag_reason: 'deleted by user' })])
    await settle(m.fixture)
    expect(m.text()).toContain('deleted by user')
    expect(m.button('[data-tab="banned"]').getAttribute('aria-pressed')).toBe('true')
    expect(m.button('[data-tab="flagged"]').getAttribute('aria-pressed')).toBe('false')
  })

  /**
   * What each status does, on the screen that sets it. None of it is guessable
   * from the word, and the flagged case is the one that matters: it is not a
   * note-to-self, it silently stops the developer's money going out while they go
   * on earning it.
   */
  it('explains what active, flagged and banned each mean', async () => {
    const m = await mount()
    const t = m.text()
    expect(t).toContain('still answers and still earns, but is left out of every payout run until reinstated')
    expect(t).toContain('settlement flags on repeated attention-check failures')
    expect(t).toContain('the command-line token stops working and browser sessions end')
    expect(t).toContain('deleted their own account is banned too')
  })

  // One reason box per developer, not one for the list. A shared box under the
  // table is how the previous developer's wording ends up recorded against this one.
  it('keeps a separate reason for each developer', async () => {
    const m = await mount([dev(), dev({ id: B, github_login: 'hubot' })])
    expect(m.button(`[data-ban="${A}"]`).disabled).toBe(true)
    expect(m.button(`[data-ban="${B}"]`).disabled).toBe(true)

    await m.type(A, 'duplicate accounts')
    expect(m.button(`[data-ban="${A}"]`).disabled).toBe(false)
    expect(m.button(`[data-ban="${B}"]`).disabled, 'one developer\'s reason armed another developer\'s ban').toBe(true)

    m.click(`[data-ban="${A}"]`)
    await settle(m.fixture)
    m.click('[data-confirm] [data-go]')
    await drain()
    const req = m.http.expectOne(`/api/admin/developers/${A}/status`)
    expect(req.request.body).toEqual({ status: 'banned', expected_status: 'flagged', reason: 'duplicate accounts' })
    req.flush(dev({ status: 'banned', flag_reason: 'duplicate accounts' }))
    await drain()
    m.http.expectOne(url('flagged')).flush([dev({ id: B, github_login: 'hubot' })])
    await settle(m.fixture)
    expect(m.text()).not.toContain('octo')
  })

  it('will not flag or ban without a reason, from the button or from the method', async () => {
    const m = await mount([dev({ status: 'active' })])
    expect(m.button(`[data-flag="${A}"]`).disabled).toBe(true)
    await m.page.set(A, 'flagged', 'active')
    m.http.expectNone(`/api/admin/developers/${A}/status`)
    await m.type(A, '   ')
    expect(m.button(`[data-flag="${A}"]`).disabled).toBe(true)
  })

  it('says what flagging quietly does before it does it', async () => {
    const m = await mount([dev({ status: 'active' })])
    await m.type(A, 'suspected scripting')
    m.click(`[data-flag="${A}"]`)
    await settle(m.fixture)
    m.http.expectNone(`/api/admin/developers/${A}/status`)
    expect(m.panel()).toContain('Flag octo: this quietly stops their payouts.')
    expect(m.panel()).toContain('nothing on their earnings page says anything is wrong')
    expect(m.panel()).toContain('the money accumulates unpaid')
    expect(m.panel()).toContain('Recorded against them: suspected scripting')
  })

  it('says what banning does before it does it', async () => {
    const m = await mount([dev({ status: 'active', github_login: 'hubot' })])
    await m.type(A, 'fraud')
    m.click(`[data-ban="${A}"]`)
    await settle(m.fixture)
    m.http.expectNone(`/api/admin/developers/${A}/status`)
    expect(m.panel()).toContain('Ban hubot: this ends the account.')
    expect(m.panel()).toContain('command-line token stops working and every browser session ends')
    expect(m.panel()).toContain('anything they are owed stays unpaid')
  })

  /**
   * `flag_reason` is the only record of why a developer was stopped, and one of the
   * values it can hold is a developer's own deletion request. It used to be erased
   * on the way back to `active`; ruling 2 stopped that on the server, so the record
   * now survives a reinstatement and the panel says so rather than warning about a
   * destruction that no longer happens. The panel still reads the reason back,
   * because reinstating a `deleted by user` row is the mistake worth preventing.
   */
  it('shows the reason before reinstating, warns about a self-deleted account, and says the record survives', async () => {
    const m = await mount([dev({ status: 'banned', github_login: 'deleted', flag_reason: 'deleted by user' })])
    m.click(`[data-reinstate="${A}"]`)
    await settle(m.fixture)
    expect(m.panel()).toContain('Reinstate deleted: this undoes the banned.')
    expect(m.panel()).toContain('Read the reason before you do it: deleted by user')
    expect(m.panel()).toContain('a developer who asked to be deleted, not a developer to bring back')
    expect(m.panel()).toContain('The reason is kept on the row afterwards, marked as past')
    expect(m.panel(), 'the panel still claims reinstating destroys the record').not.toContain('is erased')

    m.click('[data-confirm] [data-go]')
    await drain()
    const req = m.http.expectOne(`/api/admin/developers/${A}/status`)
    // No reason on the way back to active: the server keeps the recorded one, and
    // sending the box's contents would overwrite the record with a note about
    // un-flagging — the erasure this ruling exists to stop, one field along.
    expect(req.request.body).toEqual({ status: 'active', expected_status: 'banned', reason: undefined })
  })

  /**
   * The server keeps `flag_reason` through a reinstatement now, so an active
   * developer can carry one. Unlabelled it reads as a live flag on a row whose
   * status column says active — two of the columns contradicting each other.
   */
  it('marks a surviving reason as past on an active developer, and not on a stopped one', async () => {
    const m = await mount([dev({ status: 'active', flag_reason: 'deleted by user' }), dev({ id: B, github_login: 'hubot', status: 'flagged', flag_reason: 'attention:abc' })])
    const cell = (id: string) => squish(m.el.querySelector(`[data-reason-cell="${id}"]`)?.textContent ?? null)
    expect(cell(A)).toBe('was: deleted by user')
    expect(cell(B)).toBe('attention:abc')
    expect(m.text()).toContain('A reason stays on the row after a reinstatement, marked as past')
  })

  it('shows a dash rather than the word null when nothing was ever recorded', async () => {
    const m = await mount([dev({ flag_reason: null })])
    expect(squish(m.el.querySelector(`[data-reason-cell="${A}"]`)?.textContent ?? null)).toBe('—')
  })

  // The server caps the reason at 200. Uncapped here, a longer one comes back as a
  // 400 the page reports as a generic failure, after the operator has typed it.
  // Read off the schema so a bound that moves moves this with it.
  it('caps the reason box at the length the server will accept', async () => {
    const m = await mount([dev()])
    const box = m.el.querySelector(`[data-reason="${A}"]`)
    expect(box?.getAttribute('maxlength')).toBe(String(DeveloperStatusInput.shape.reason.unwrap().maxLength))
    expect(Number(box?.getAttribute('maxlength'))).toBeGreaterThan(0)
  })

  it('names the tab in its empty state so a broken load cannot read as none', async () => {
    const m = await mount([])
    expect(m.text()).toContain('No flagged developers.')
    expect(m.el.querySelector('[data-load-failed]')).toBeNull()
  })

  it('says when the list did not load, and does not leave the previous tab under the new label', async () => {
    const m = await mount([dev()])
    m.click('[data-tab="active"]')
    await drain()
    m.http.expectOne(url('active')).flush({ error: 'internal' }, { status: 500, statusText: 'Server Error' })
    await settle(m.fixture)
    expect(m.text()).toContain('Could not load the active developers')
    expect(m.text(), 'a flagged developer was left on screen under the active tab').not.toContain('octo')
  })

  it('does not claim a status change went through when it failed', async () => {
    const m = await mount([dev({ status: 'active' })])
    await m.type(A, 'fraud')
    m.click(`[data-ban="${A}"]`)
    await settle(m.fixture)
    m.click('[data-confirm] [data-go]')
    await drain()
    m.http.expectOne(`/api/admin/developers/${A}/status`).flush({ error: 'not_found' }, { status: 404, statusText: 'Not Found' })
    await settle(m.fixture)
    m.http.expectNone(url('flagged'))
    expect(m.text()).toContain('Could not set that developer to banned')
    expect(m.text()).toContain('octo')
  })
  /**
   * The optimistic-concurrency claim, from the row the operator was actually looking
   * at. `expected_status` cannot be invented server-side: any status can move to any
   * other, so there is no single legal source state the way a study review has
   * `in_review`. Sending the *target* status, or a constant, would make the claim
   * always-true and put the lost update straight back while every other assertion
   * here stayed green.
   */
  it('claims the status the row was loaded with, not the one it is moving to', async () => {
    const m = await mount([dev({ status: 'flagged' })])
    await m.type(A, 'fraud')
    m.click(`[data-ban="${A}"]`)
    await settle(m.fixture)
    m.click('[data-confirm] [data-go]')
    await drain()
    const req = m.http.expectOne(`/api/admin/developers/${A}/status`)
    expect(req.request.body.expected_status, 'the claim is the target status, so it is always true').toBe('flagged')
    expect(req.request.body.status).toBe('banned')
    req.flush(dev({ status: 'banned', flag_reason: 'fraud' }))
    await drain()
    m.http.expectOne(url('flagged')).flush([])
    await settle(m.fixture)
  })

  // A 409 is not "try again", it is "your view is stale". Telling the operator to
  // reload is the only useful thing to say, and the generic message does not.
  it('says the row moved when another operator got there first', async () => {
    const m = await mount([dev({ status: 'active' })])
    await m.type(A, 'fraud')
    m.click(`[data-ban="${A}"]`)
    await settle(m.fixture)
    m.click('[data-confirm] [data-go]')
    await drain()
    m.http.expectOne(`/api/admin/developers/${A}/status`).flush({ error: 'status_changed' }, { status: 409, statusText: 'Conflict' })
    await settle(m.fixture)
    expect(m.text()).toContain('changed since you loaded')
    expect(m.text(), 'a stale view is reported as a failed write').not.toContain('Could not set that developer to banned')
    // Nothing was reloaded behind their back, so what is on screen is still the
    // view the message is telling them not to trust.
    m.http.expectNone(url('flagged'))
    expect(m.text()).toContain('octo')
  })
})
