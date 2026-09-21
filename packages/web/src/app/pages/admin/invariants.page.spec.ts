import { TestBed, type ComponentFixture } from '@angular/core/testing'
import { provideHttpClient } from '@angular/common/http'
import { HttpTestingController, provideHttpClientTesting, type TestRequest } from '@angular/common/http/testing'
import { provideRouter } from '@angular/router'
import { describe, it, expect } from 'vitest'
import InvariantsPage, { routeMeta } from './invariants.page'
import { adminGuard } from '../../lib/auth'

const URL = '/api/admin/invariants'
const PROBLEM = 'negative available balance -100 for developer 8f0b0f2e-6f6a-4a3a-9c1f-0f1e2d3c4b5a'

/** One macrotask drains every pending microtask; `whenStable()` alone does not. */
async function settle(fixture: ComponentFixture<unknown>) {
  await fixture.whenStable()
  await new Promise((ok) => setTimeout(ok, 0))
  fixture.detectChanges()
}

const squish = (s: string | null) => (s ?? '').replace(/\s+/g, ' ').trim()

async function mount(first: unknown | { status: number }) {
  TestBed.resetTestingModule()
  TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])] })
  const fixture = TestBed.createComponent(InvariantsPage)
  fixture.detectChanges()
  const http = TestBed.inject(HttpTestingController)
  answer(http.expectOne(URL), first)
  await settle(fixture)
  const el = fixture.nativeElement as HTMLElement
  return {
    fixture, http, el,
    text: () => squish(el.textContent),
    has: (selector: string) => el.querySelector(selector) !== null,
    /** Presses Re-check and answers it. */
    recheck: async (next: unknown | { status: number }) => {
      (el.querySelector('[data-recheck]') as HTMLButtonElement).click()
      await new Promise((ok) => setTimeout(ok, 0))
      answer(http.expectOne(URL), next)
      await settle(fixture)
    },
  }
}

function answer(req: TestRequest, body: unknown | { status: number }) {
  if (body && typeof body === 'object' && 'status' in body) req.flush({ error: 'internal' }, { status: (body as { status: number }).status, statusText: 'Server Error' })
  else req.flush(body as Record<string, unknown>)
}

describe('admin InvariantsPage', () => {
  it('is behind the admin guard', () => {
    expect(routeMeta.canActivate).toEqual([adminGuard])
  })

  it('reports a sound ledger in its own state', async () => {
    const m = await mount({ ok: true, problems: [] })
    expect(m.has('[data-ok]')).toBe(true)
    expect(m.text()).toContain('All ledger invariants hold.')
    expect(m.has('[data-problems]')).toBe(false)
    expect(m.has('[data-check-failed]')).toBe(false)
  })

  /**
   * Problems are the most important thing on any admin screen, so this asserts on
   * more than their presence: the count, the text of each one, and the instruction
   * that follows from them. A payout batch debits balances, so it is the one
   * action that must not be taken while the ledger does not reconcile.
   */
  it('reports problems loudly, lists every one, and says not to run a payout batch', async () => {
    const m = await mount({ ok: false, problems: [PROBLEM, 'answer x settled 2 times for developer y'] })
    expect(m.has('[data-problems]')).toBe(true)
    expect(m.has('[data-ok]')).toBe(false)
    const box = squish(m.el.querySelector('[data-problems]')?.textContent ?? null)
    expect(box).toContain('The ledger does not add up: 2 problems.')
    expect(box).toContain(PROBLEM)
    expect(box).toContain('answer x settled 2 times for developer y')
    expect(box).toContain('Do not create a payout batch until this is resolved')
  })

  it('says one problem, not one problems', async () => {
    const m = await mount({ ok: false, problems: [PROBLEM] })
    expect(m.text()).toContain('The ledger does not add up: 1 problem.')
  })

  /**
   * The failure this page exists not to have. A check that could not run is not a
   * clean result, and a page that draws it as one — a green box, or nothing at all
   * under the heading — is the no-signal failure this branch keeps finding.
   */
  it('does not draw a check that never ran as a clean result', async () => {
    const m = await mount({ status: 500 })
    expect(m.has('[data-check-failed]')).toBe(true)
    expect(m.has('[data-ok]')).toBe(false)
    expect(m.has('[data-problems]')).toBe(false)
    expect(m.text()).toContain('The check did not run.')
    expect(m.text()).toContain('do not create a payout batch until this page answers')
    expect(m.text()).not.toContain('All ledger invariants hold.')
  })

  // The other half of the same rule: a green box that was true a minute ago must
  // not survive a re-check that failed, or the operator reads a stale all-clear as
  // the current one.
  it('drops a previous all-clear when the re-check fails', async () => {
    const m = await mount({ ok: true, problems: [] })
    expect(m.has('[data-ok]')).toBe(true)
    await m.recheck({ status: 503 })
    expect(m.has('[data-ok]')).toBe(false)
    expect(m.has('[data-check-failed]')).toBe(true)
  })

  it('clears the failure when a later re-check answers', async () => {
    const m = await mount({ status: 500 })
    await m.recheck({ ok: false, problems: [PROBLEM] })
    expect(m.has('[data-check-failed]')).toBe(false)
    expect(m.has('[data-problems]')).toBe(true)
  })

  // The server derives ok from the problem count, so this shape should never
  // arrive. If it does it is a broken reporter, not a clean bill of health.
  it('refuses to call an unexplained failure sound', async () => {
    const m = await mount({ ok: false, problems: [] })
    expect(m.has('[data-inconsistent]')).toBe(true)
    expect(m.has('[data-ok]')).toBe(false)
    expect(m.text()).toContain('Treat the ledger as unchecked')
  })

  it('says it is still checking rather than showing nothing', async () => {
    TestBed.resetTestingModule()
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])] })
    const fixture = TestBed.createComponent(InvariantsPage)
    fixture.detectChanges()
    TestBed.inject(HttpTestingController).expectOne(URL)
    expect((fixture.nativeElement as HTMLElement).querySelector('[data-checking]')).not.toBeNull()
  })
})
