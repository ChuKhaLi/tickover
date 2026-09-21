import { Component } from '@angular/core'
import { TestBed } from '@angular/core/testing'
import { provideHttpClient } from '@angular/common/http'
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing'
import { provideLocationMocks } from '@angular/common/testing'
import { Router, provideRouter } from '@angular/router'
import { RouterTestingHarness } from '@angular/router/testing'
import { describe, it, expect } from 'vitest'
import { AuthState, adminGuard } from '../lib/auth'
import AdminLayout from './admin.page'
import InvariantsPage from './admin/invariants.page'

@Component({ template: 'somewhere else' })
class Elsewhere {}

/** One macrotask drains every pending microtask; `whenStable()` alone does not. */
async function settle(fixture: { whenStable(): Promise<unknown>; detectChanges(): void }) {
  await fixture.whenStable()
  await new Promise((ok) => setTimeout(ok, 0))
  fixture.detectChanges()
}

function mount(signedIn: boolean) {
  TestBed.resetTestingModule()
  TestBed.configureTestingModule({
    providers: [
      provideHttpClient(), provideHttpClientTesting(), provideLocationMocks(),
      provideRouter([{ path: 'admin', component: Elsewhere }, { path: 'admin/login', component: Elsewhere }]),
    ],
  })
  const auth = TestBed.inject(AuthState)
  auth.admin.set(signedIn)
  const fixture = TestBed.createComponent(AdminLayout)
  fixture.detectChanges()
  return {
    fixture, auth,
    el: fixture.nativeElement as HTMLElement,
    http: TestBed.inject(HttpTestingController),
    router: TestBed.inject(Router),
  }
}

const hrefs = (el: HTMLElement) => Array.from(el.querySelectorAll('header a'), (a) => a.getAttribute('href'))

describe('admin AdminLayout', () => {
  it('offers all five admin sections to a signed-in operator', () => {
    const { el } = mount(true)
    for (const href of ['/admin', '/admin/system-studies', '/admin/developers', '/admin/payouts', '/admin/invariants']) {
      expect(hrefs(el), `${href} is missing from the admin nav`).toContain(href)
    }
    expect(el.textContent).toContain('operator')
  })

  // `/admin/login` renders inside this layout, so the links are the five pages the
  // guard would bounce a signed-out visitor straight back off. Same reasoning as
  // `app.page.ts`, which is why the layout takes no guard of its own.
  it('offers no admin links and no sign-out to a signed-out visitor', () => {
    const { el } = mount(false)
    expect(hrefs(el)).toEqual(['/'])
    expect(el.textContent).not.toContain('operator')
    expect(el.querySelector('[data-signout]')).toBeNull()
  })

  /**
   * The admin session lasts a day and approves studies, bans developers and marks
   * money paid, so an operator on a shared machine needs to be able to end it.
   * Signing out has to reach the server — the session is an httpOnly cookie, so a
   * client-side forget leaves it live — clear the principal, and leave the area.
   * The destination is measured from somewhere that is not it: `Router.url` reads
   * `/` from a standing start, so asserting there passes with the navigation gone.
   */
  it('signs out through the server, clears the principal, and leaves', async () => {
    const { fixture, el, auth, http, router } = mount(true)
    await router.navigateByUrl('/admin')
    ;(el.querySelector('[data-signout]') as HTMLButtonElement).click()
    http.expectOne({ method: 'POST', url: '/api/admin/auth/logout' }).flush({ ok: true })
    await settle(fixture)
    expect(auth.admin()).toBe(false)
    expect(router.url).toBe('/admin/login')
  })

  // The request failed, so the session is still live on the server. Clearing the
  // principal would show signed-out chrome over a session that can still ban a
  // developer — R48's mistake one layer up, and the same fix the other two
  // layouts carry.
  it('keeps the principal and says the session is still live when signing out fails', async () => {
    const { fixture, el, auth, http, router } = mount(true)
    await router.navigateByUrl('/admin')
    ;(el.querySelector('[data-signout]') as HTMLButtonElement).click()
    http.expectOne({ method: 'POST', url: '/api/admin/auth/logout' }).flush({ error: 'internal' }, { status: 500, statusText: 'Server Error' })
    await settle(fixture)
    expect(auth.admin()).toBe(true)
    expect(router.url).toBe('/admin')
    expect(el.textContent).toContain('the session is still live')
  })

  // One layout, one chrome. A second `<mw-shell>` on a child page shows up here and
  // nowhere else. The child-route probe is a string only the invariants page can
  // produce — not a nav label, which the header renders whether the outlet works or
  // not (measured on `dev.page.spec.ts`, where exactly that made the probe vacuous).
  it('wraps a child route in exactly one header and one footer', async () => {
    TestBed.resetTestingModule()
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(), provideHttpClientTesting(), provideLocationMocks(),
        provideRouter([{ path: 'admin', component: AdminLayout, children: [{ path: 'invariants', component: InvariantsPage }] }]),
      ],
    })
    TestBed.inject(AuthState).admin.set(true)
    const harness = await RouterTestingHarness.create('/admin/invariants')
    TestBed.inject(HttpTestingController).expectOne('/api/admin/invariants').flush({ ok: true, problems: [] })
    await harness.fixture.whenStable()
    await new Promise((ok) => setTimeout(ok, 0))
    harness.detectChanges()
    const el = harness.routeNativeElement!
    expect(el.querySelectorAll('header')).toHaveLength(1)
    expect(el.querySelectorAll('footer')).toHaveLength(1)
    expect(el.textContent, 'the child route did not render').toContain('All ledger invariants hold.')
  })

  /**
   * The highest-privilege surface in the product, so the rule is checked rather
   * than trusted: every page under `pages/admin/` carries `adminGuard`, and
   * `login.page.ts` is the single, named exception — it is where the guard sends
   * a signed-out operator, so guarding it would be a redirect to itself.
   */
  it('leaves every page under /admin except the sign-in page behind the admin guard', async () => {
    const modules = import.meta.glob('./admin/**/*.page.ts')
    const paths = Object.keys(modules)
    // Without these the rule passes by finding nothing, or by the exception
    // quietly covering everything.
    expect(paths).toContain('./admin/index.page.ts')
    expect(paths).toContain('./admin/login.page.ts')
    expect(paths.length).toBeGreaterThanOrEqual(6)
    for (const path of paths) {
      const mod = (await modules[path]!()) as { routeMeta?: { canActivate?: unknown[] } }
      const guards = mod.routeMeta?.canActivate
      if (path === './admin/login.page.ts') {
        expect(guards, 'the sign-in page must not be behind the guard that sends people to it').toBeUndefined()
        continue
      }
      // `expect(undefined).toContain(x)` passes, so a page declaring no
      // `canActivate` at all slips through the line below on its own.
      expect(Array.isArray(guards), `${path} declares no canActivate at all`).toBe(true)
      expect(guards, `${path} is reachable without signing in`).toContain(adminGuard)
    }
  })
})
