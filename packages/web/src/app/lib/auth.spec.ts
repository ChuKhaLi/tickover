import { TestBed } from '@angular/core/testing'
import { provideHttpClient } from '@angular/common/http'
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing'
import { provideRouter, Router, type ActivatedRouteSnapshot, type CanActivateFn, type RouterStateSnapshot, type UrlTree } from '@angular/router'
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { ApiError } from './api'
import { AuthState, adminGuard, buyerGuard, developerGuard } from './auth'

const BUYER = { id: '8f0b0f2e-6f6a-4a3a-9c1f-0f1e2d3c4b5a', email: 'pm@acme.test', org: null, credit_cents: 500, first_study_used: false }
const DEVELOPER = {
  id: 'c2f4a1d0-3b5e-4c7a-8d9f-1e2b3c4d5e6f', github_login: 'octocat', balance_pending_cents: 250,
  balance_available_cents: 900, today_paid_answers: 3, activity_tier: 'regular', can_cash_out: true,
  payout_method: null,
}

describe('AuthState', () => {
  let auth: AuthState
  let http: HttpTestingController
  let router: Router

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()] })
    auth = TestBed.inject(AuthState)
    http = TestBed.inject(HttpTestingController)
    router = TestBed.inject(Router)
  })
  afterEach(() => http.verify())

  const runGuard = (guard: CanActivateFn) =>
    TestBed.runInInjectionContext(() => guard({} as ActivatedRouteSnapshot, {} as RouterStateSnapshot)) as Promise<boolean | UrlTree>

  /** Signs a buyer in for real, so later assertions about the signal are not made against an empty fixture. */
  async function signInBuyer(): Promise<void> {
    const p = auth.refreshBuyer()
    http.expectOne('/api/buyer/me').flush(BUYER)
    await p
    expect(auth.buyer()).toMatchObject({ id: BUYER.id })
  }

  it('stores the buyer on success', async () => {
    await signInBuyer()
  })

  it('clears the buyer on 401', async () => {
    await signInBuyer()
    const p = auth.refreshBuyer()
    http.expectOne('/api/buyer/me').flush({ error: 'unauthorized' }, { status: 401, statusText: 'Unauthorized' })
    await expect(p).resolves.toBeNull()
    expect(auth.buyer()).toBeNull()
  })

  it('re-throws a 500 and leaves the buyer signal alone', async () => {
    await signInBuyer()
    const p = auth.refreshBuyer()
    http.expectOne('/api/buyer/me').flush({ error: 'internal' }, { status: 500, statusText: 'Server Error' })
    await expect(p).rejects.toBeInstanceOf(ApiError)
    await expect(p).rejects.toMatchObject({ status: 500 })
    // Not null: a 500 does not mean signed out, and clearing here would blank the
    // header on a page the user is still entitled to see.
    expect(auth.buyer()).toMatchObject({ id: BUYER.id })
  })

  it('re-throws a malformed body rather than reporting it as signed out', async () => {
    await signInBuyer()
    const p = auth.refreshBuyer()
    http.expectOne('/api/buyer/me').flush({ nope: true })
    await expect(p).rejects.toThrow()
    await expect(p).rejects.not.toBeInstanceOf(ApiError)
    expect(auth.buyer()).toMatchObject({ id: BUYER.id })
  })

  it('clears the developer on 401 and re-throws a 500', async () => {
    const ok = auth.refreshDeveloper()
    http.expectOne('/api/dev/web/me').flush(DEVELOPER)
    await ok
    expect(auth.developer()).toMatchObject({ github_login: 'octocat' })

    const gone = auth.refreshDeveloper()
    http.expectOne('/api/dev/web/me').flush({ error: 'unauthorized' }, { status: 401, statusText: 'Unauthorized' })
    await expect(gone).resolves.toBeNull()
    expect(auth.developer()).toBeNull()

    // Signed back in before the 500, so the assertion below is made against a
    // populated signal rather than the null the 401 just left behind.
    const back = auth.refreshDeveloper()
    http.expectOne('/api/dev/web/me').flush(DEVELOPER)
    await back

    const boom = auth.refreshDeveloper()
    http.expectOne('/api/dev/web/me').flush({ error: 'internal' }, { status: 500, statusText: 'Server Error' })
    await expect(boom).rejects.toMatchObject({ status: 500 })
    expect(auth.developer()).toMatchObject({ github_login: 'octocat' })
  })

  // The probe is `/api/admin/me`, not `/api/admin/invariants`. Named here rather
  // than left to `expectOne` matching whatever the code asks for: the point of the
  // route is which one it is. `expectNone` on the ledger route is the other half —
  // the guard must not scan the ledger to find out who is signed in, and if it did,
  // a bare `expectOne('/api/admin/me')` would still be green with both requests out.
  it('reports admin false on 401 but re-throws a 500, and never reads the ledger to decide', async () => {
    const no = auth.refreshAdmin()
    http.expectNone('/api/admin/invariants')
    http.expectOne('/api/admin/me').flush({ error: 'unauthorized' }, { status: 401, statusText: 'Unauthorized' })
    await expect(no).resolves.toBe(false)
    expect(auth.admin()).toBe(false)

    const yes = auth.refreshAdmin()
    http.expectOne('/api/admin/me').flush({ ok: true, principal: 'admin' })
    await expect(yes).resolves.toBe(true)
    expect(auth.admin()).toBe(true)

    const boom = auth.refreshAdmin()
    http.expectOne('/api/admin/me').flush({ error: 'internal' }, { status: 500, statusText: 'Server Error' })
    await expect(boom).rejects.toMatchObject({ status: 500 })
    // Still true: a failed probe is not evidence of not being an admin.
    expect(auth.admin()).toBe(true)
  })

  it('buyerGuard admits a signed-in buyer and redirects a 401 to the login page', async () => {
    const allowed = runGuard(buyerGuard)
    http.expectOne('/api/buyer/me').flush(BUYER)
    expect(await allowed).toBe(true)

    const denied = runGuard(buyerGuard)
    http.expectOne('/api/buyer/me').flush({ error: 'unauthorized' }, { status: 401, statusText: 'Unauthorized' })
    expect(router.serializeUrl((await denied) as UrlTree)).toBe('/app/login')
  })

  it('buyerGuard does not send a 500 to the login page', async () => {
    const p = runGuard(buyerGuard)
    http.expectOne('/api/buyer/me').flush({ error: 'internal' }, { status: 500, statusText: 'Server Error' })
    // The previous test proves a 401 resolves to a /app/login UrlTree here, so a
    // rejection is a real difference in behaviour, not an assertion on nothing.
    await expect(p).rejects.toMatchObject({ status: 500 })
  })

  it('developerGuard and adminGuard redirect their own 401s', async () => {
    const dev = runGuard(developerGuard)
    http.expectOne('/api/dev/web/me').flush({ error: 'unauthorized' }, { status: 401, statusText: 'Unauthorized' })
    expect(router.serializeUrl((await dev) as UrlTree)).toBe('/developers')

    const admin = runGuard(adminGuard)
    http.expectOne('/api/admin/me').flush({ error: 'unauthorized' }, { status: 401, statusText: 'Unauthorized' })
    expect(router.serializeUrl((await admin) as UrlTree)).toBe('/admin/login')
  })
})
