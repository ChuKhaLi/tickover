import { Component } from '@angular/core'
import { TestBed } from '@angular/core/testing'
import { provideHttpClient } from '@angular/common/http'
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing'
import { provideLocationMocks } from '@angular/common/testing'
import { Router, provideRouter } from '@angular/router'
import { RouterTestingHarness } from '@angular/router/testing'
import { describe, it, expect } from 'vitest'
import { AuthState, buyerGuard } from '../lib/auth'
import AppLayout from './app.page'
import LoginPage from './app/login.page'

const BUYER = { id: '8f0b0f2e-6f6a-4a3a-9c1f-0f1e2d3c4b5a', email: 'pm@acme.test', org: null, credit_cents: 1234, first_study_used: false }

@Component({ template: 'somewhere else' })
class Elsewhere {}

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
      provideRouter([{ path: '', component: Elsewhere }, { path: 'app/studies/new', component: Elsewhere }, { path: 'app/credits', component: Elsewhere }]),
    ],
  })
  const auth = TestBed.inject(AuthState)
  if (signedIn) auth.buyer.set(BUYER)
  const fixture = TestBed.createComponent(AppLayout)
  fixture.detectChanges()
  return { fixture, auth, el: fixture.nativeElement as HTMLElement, http: TestBed.inject(HttpTestingController), router: TestBed.inject(Router) }
}

const signOutButton = (el: HTMLElement) => Array.from(el.querySelectorAll('button')).find((b) => b.textContent?.includes('sign out'))!

describe('buyer AppLayout', () => {
  // The credit figure is the one number in this chrome the buyer acts on, and it
  // arrives as integer cents. Rendered raw it reads as a 1234-dollar balance.
  it('shows who is signed in and what they have, from cents', () => {
    const { el } = mount(true)
    expect(el.textContent).toContain('pm@acme.test')
    expect(el.textContent).toContain('$12.34')
    expect(el.textContent).not.toContain('1234')
  })

  it('offers the buyer sections', () => {
    const { el } = mount(true)
    const hrefs = Array.from(el.querySelectorAll('header a'), (a) => a.getAttribute('href'))
    expect(hrefs).toContain('/app')
    expect(hrefs).toContain('/app/studies/new')
    expect(hrefs).toContain('/app/credits')
  })

  // Signing out is the one control here that has to be believed. It has to reach
  // the server (the cookie is the session, so a client-side forget leaves it
  // live), clear the principal (or the next page renders another buyer's address
  // out of the cached signal), and leave the app.
  //
  // The navigation is measured from somewhere that is not the destination:
  // `Router.url` reads `/` before any navigation at all, so an assertion made
  // from a standing start passes with `navigateByUrl` deleted.
  it('signs out through the server, clears the principal, and leaves', async () => {
    const { fixture, el, auth, http, router } = mount(true)
    await router.navigateByUrl('/app/credits')
    signOutButton(el).click()
    http.expectOne({ method: 'POST', url: '/api/buyer/auth/logout' }).flush({ ok: true })
    await settle(fixture)
    expect(auth.buyer()).toBeNull()
    expect(router.url).toBe('/')
  })

  // The opposite failure: the request fails, the session is still live on the
  // server, and pretending otherwise would show signed-out chrome to a buyer
  // whose cookie still works.
  it('keeps the principal and says so when signing out fails', async () => {
    const { fixture, el, auth, http, router } = mount(true)
    await router.navigateByUrl('/app/credits')
    signOutButton(el).click()
    http.expectOne({ method: 'POST', url: '/api/buyer/auth/logout' }).flush({ error: 'internal' }, { status: 500, statusText: 'Server Error' })
    await settle(fixture)
    expect(auth.buyer()).toMatchObject({ id: BUYER.id })
    expect(router.url).toBe('/app/credits')
    expect(el.textContent).toContain("Couldn't sign you out")
  })

  // /app/login is a child of this layout, so a signed-out visitor sees this
  // chrome. It must not offer the buyer sections it would only redirect back out
  // of, and it must not render an account strip with nobody in it.
  it('offers the public sections, and no account strip, when nobody is signed in', () => {
    const out = mount(false)
    const hrefs = Array.from(out.el.querySelectorAll('header a'), (a) => a.getAttribute('href'))
    expect(hrefs).not.toContain('/app/credits')
    expect(hrefs).toContain('/buyers')
    expect(out.el.querySelector('button'), 'nothing to sign out of').toBeNull()
    // Non-vacuous: the same probe finds a button when a buyer is signed in, so
    // its absence above is the signed-out branch and not an empty render.
    expect(mount(true).el.querySelector('button')).not.toBeNull()
  })

  // One layout, one chrome. Rendering the login page inside the layout is where a
  // second `<tk-shell>` would show up, and no unit render of either component on
  // its own can see it.
  it('wraps a child route in exactly one header and one footer', async () => {
    TestBed.resetTestingModule()
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(), provideHttpClientTesting(), provideLocationMocks(),
        provideRouter([{ path: 'app', component: AppLayout, children: [{ path: 'login', component: LoginPage }] }]),
      ],
    })
    const harness = await RouterTestingHarness.create('/app/login')
    const el = harness.routeNativeElement!
    expect(el.querySelectorAll('header')).toHaveLength(1)
    expect(el.querySelectorAll('footer')).toHaveLength(1)
    expect(el.querySelector('input[type=email]'), 'the child route did not render').not.toBeNull()
  })

  // The layout deliberately carries no guard, because /app/login is one of its
  // children and guarding it would bounce a signed-out buyer at itself. That puts
  // the guard on each child instead, which is a rule a later task can forget in
  // silence — Tasks 5 to 7 add four more pages under this directory. This is the
  // thing that notices.
  it('leaves every page under /app guarded except the login page', async () => {
    const modules = import.meta.glob('./app/**/*.page.ts')
    const paths = Object.keys(modules)
    // Without this the rule passes by finding nothing.
    expect(paths).toContain('./app/index.page.ts')
    for (const path of paths) {
      if (path === './app/login.page.ts') continue
      const mod = (await modules[path]!()) as { routeMeta?: { canActivate?: unknown[] } }
      const guards = mod.routeMeta?.canActivate
      // The array check is not ceremony: `expect(undefined).toContain(x)` passes
      // here, so a page that declares no `canActivate` at all slipped through the
      // line below on its own. Measured — the mutant survived until this was added.
      expect(Array.isArray(guards), `${path} declares no canActivate at all`).toBe(true)
      expect(guards, `${path} is reachable without signing in`).toContain(buyerGuard)
    }
  })
})
