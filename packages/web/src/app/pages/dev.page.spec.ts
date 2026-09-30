import { Component } from '@angular/core'
import { TestBed } from '@angular/core/testing'
import { provideHttpClient } from '@angular/common/http'
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing'
import { provideLocationMocks } from '@angular/common/testing'
import { Router, provideRouter } from '@angular/router'
import { RouterTestingHarness } from '@angular/router/testing'
import { describe, it, expect } from 'vitest'
import type { DeveloperSelf } from '@tickover/contract'
import { AuthState, developerGuard } from '../lib/auth'
import DevLayout from './dev.page'
import EarningsPage from './dev/index.page'

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

@Component({ template: 'somewhere else' })
class Elsewhere {}

/** One macrotask drains every pending microtask; `whenStable()` alone does not. */
async function settle(fixture: { whenStable(): Promise<unknown>; detectChanges(): void }) {
  await fixture.whenStable()
  await new Promise((ok) => setTimeout(ok, 0))
  fixture.detectChanges()
}

function mount() {
  TestBed.resetTestingModule()
  TestBed.configureTestingModule({
    providers: [
      provideHttpClient(), provideHttpClientTesting(), provideLocationMocks(),
      provideRouter([{ path: 'developers', component: Elsewhere }, { path: 'dev/settings', component: Elsewhere }]),
    ],
  })
  const auth = TestBed.inject(AuthState)
  auth.developer.set(DEV)
  const fixture = TestBed.createComponent(DevLayout)
  fixture.detectChanges()
  return { fixture, auth, el: fixture.nativeElement as HTMLElement, http: TestBed.inject(HttpTestingController), router: TestBed.inject(Router) }
}

const signOutButton = (el: HTMLElement) => Array.from(el.querySelectorAll('button')).find((b) => b.textContent?.includes('sign out'))!

describe('developer DevLayout', () => {
  it('says who is signed in and offers both developer sections', () => {
    const { el } = mount()
    expect(el.textContent).toContain('octo')
    const hrefs = Array.from(el.querySelectorAll('header a'), (a) => a.getAttribute('href'))
    expect(hrefs).toContain('/dev')
    expect(hrefs).toContain('/dev/settings')
  })

  // Signing out has to reach the server — the session is an httpOnly cookie, so a
  // client-side forget leaves it live — clear the principal, and leave the area.
  // The destination is measured from somewhere that is not it: `Router.url` reads
  // `/` from a standing start, so an assertion made there passes with the
  // navigation deleted.
  it('signs out through the server, clears the principal, and leaves', async () => {
    const { fixture, el, auth, http, router } = mount()
    await router.navigateByUrl('/dev/settings')
    signOutButton(el).click()
    http.expectOne({ method: 'POST', url: '/api/dev/web/logout' }).flush({ ok: true })
    await settle(fixture)
    expect(auth.developer()).toBeNull()
    expect(router.url).toBe('/developers')
  })

  // The request failed, so the session is still live on the server. Clearing the
  // principal would show signed-out chrome over a session that still works — R48's
  // mistake one layer up, and the same fix `app.page.ts` carries.
  it('keeps the principal and says so when signing out fails', async () => {
    const { fixture, el, auth, http, router } = mount()
    await router.navigateByUrl('/dev/settings')
    signOutButton(el).click()
    http.expectOne({ method: 'POST', url: '/api/dev/web/logout' }).flush({ error: 'internal' }, { status: 500, statusText: 'Server Error' })
    await settle(fixture)
    expect(auth.developer()).toMatchObject({ id: DEV.id })
    expect(router.url).toBe('/dev/settings')
    expect(el.textContent).toContain("Couldn't sign you out")
  })

  // One layout, one chrome. A second `<tk-shell>` on a child page shows up here and
  // nowhere else, because no unit render of either component on its own can see it.
  //
  // The child-route probe is `Available`, a balance-card label, and the word matters.
  // It was `Earnings` — which is this layout's own nav label, rendered by `ui/shell.ts`
  // into the header — so the assertion was satisfied by the chrome whether or not the
  // outlet rendered anything. Measured: deleting `<router-outlet />` from `dev.page.ts`
  // left all five tests here green and the whole web suite at 244/244, with /dev and
  // /dev/settings rendering an empty shell. `Available` appears only on the child.
  it('wraps a child route in exactly one header and one footer', async () => {
    TestBed.resetTestingModule()
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(), provideHttpClientTesting(), provideLocationMocks(),
        provideRouter([{ path: 'dev', component: DevLayout, children: [{ path: '', component: EarningsPage }] }]),
      ],
    })
    TestBed.inject(AuthState).developer.set(DEV)
    const harness = await RouterTestingHarness.create('/dev')
    const el = harness.routeNativeElement!
    expect(el.querySelectorAll('header')).toHaveLength(1)
    expect(el.querySelectorAll('footer')).toHaveLength(1)
    expect(el.textContent, 'the child route did not render').toContain('Available')
  })

  // Unlike `/app`, nothing under `/dev` is reachable signed out, so every page here
  // carries the guard. Task 9 and anything after it can forget one in silence; this
  // is what notices.
  it('leaves every page under /dev behind the developer guard', async () => {
    const modules = import.meta.glob('./dev/**/*.page.ts')
    const paths = Object.keys(modules)
    // Without this the rule passes by finding nothing.
    expect(paths).toContain('./dev/index.page.ts')
    for (const path of paths) {
      const mod = (await modules[path]!()) as { routeMeta?: { canActivate?: unknown[] } }
      const guards = mod.routeMeta?.canActivate
      // `expect(undefined).toContain(x)` passes, so a page declaring no
      // `canActivate` at all slips through the line below on its own (measured on
      // `app.page.spec.ts`, where the mutant survived until this was added).
      expect(Array.isArray(guards), `${path} declares no canActivate at all`).toBe(true)
      expect(guards, `${path} is reachable without signing in`).toContain(developerGuard)
    }
  })
})
