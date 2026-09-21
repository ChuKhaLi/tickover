import { Component } from '@angular/core'
import { TestBed, type ComponentFixture } from '@angular/core/testing'
import { provideHttpClient } from '@angular/common/http'
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing'
import { provideLocationMocks } from '@angular/common/testing'
import { Router, provideRouter } from '@angular/router'
import { describe, it, expect } from 'vitest'
import AdminLoginPage, { routeMeta } from './login.page'
import { AuthState } from '../../lib/auth'

const URL = '/api/admin/auth/login'

@Component({ template: 'the review queue' })
class Elsewhere {}

/** One macrotask drains every pending microtask; `whenStable()` alone does not. */
async function settle(fixture: ComponentFixture<unknown>) {
  await fixture.whenStable()
  await new Promise((ok) => setTimeout(ok, 0))
  fixture.detectChanges()
}

const drain = () => new Promise((ok) => setTimeout(ok, 0))
const squish = (s: string | null) => (s ?? '').replace(/\s+/g, ' ').trim()

/**
 * Async on purpose. These inputs sit inside a `<form>`, so each `ngModel`
 * registers with the form over a microtask; typing into a box before that has
 * happened updates nothing, and the request goes out with three empty strings.
 * Measured — that is exactly what the first version of this file asserted against.
 */
async function mount() {
  TestBed.resetTestingModule()
  TestBed.configureTestingModule({
    providers: [
      provideHttpClient(), provideHttpClientTesting(), provideLocationMocks(),
      provideRouter([{ path: 'admin', component: Elsewhere }, { path: 'admin/login', component: AdminLoginPage }]),
    ],
  })
  const fixture = TestBed.createComponent(AdminLoginPage)
  fixture.detectChanges()
  await settle(fixture)
  const el = fixture.nativeElement as HTMLElement
  const page = fixture.componentInstance
  return {
    fixture, el, page,
    http: TestBed.inject(HttpTestingController),
    auth: TestBed.inject(AuthState),
    router: TestBed.inject(Router),
    error: () => squish(el.querySelector('[data-error]')?.textContent ?? null),
    submit: () => (el.querySelector('form') as HTMLFormElement).dispatchEvent(new Event('submit')),
    fill: async (email: string, password: string, totp: string) => {
      const boxes = Array.from(el.querySelectorAll('input')) as HTMLInputElement[]
      const values = [email, password, totp]
      boxes.forEach((box, i) => { box.value = values[i]!; box.dispatchEvent(new Event('input')) })
      await settle(fixture)
    },
  }
}

describe('admin AdminLoginPage', () => {
  it('names the page in the tab and carries no guard of its own', () => {
    expect(routeMeta.title).toContain('Operator sign in')
    expect((routeMeta as { canActivate?: unknown }).canActivate).toBeUndefined()
  })

  /**
   * `AuthState.admin` is a root singleton and the guard is the only thing entitled
   * to set it true. Arriving at the sign-in page means no session has been proved,
   * so a claim left over from an expired one is stale — and the layout draws admin
   * chrome and a sign-out button off that signal.
   */
  it('clears a stale signed-in claim on arrival', async () => {
    TestBed.resetTestingModule()
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(), provideHttpClientTesting(), provideLocationMocks(),
        provideRouter([{ path: 'admin', component: Elsewhere }, { path: 'admin/login', component: AdminLoginPage }]),
      ],
    })
    const auth = TestBed.inject(AuthState)
    auth.admin.set(true)
    TestBed.createComponent(AdminLoginPage).detectChanges()
    expect(auth.admin()).toBe(false)
  })

  it('sends the trimmed credentials, marks the session, and goes to the queue', async () => {
    const m = await mount()
    await m.fill('  ops@tickover.dev ', 'admin-pass-123', ' 123456 ')
    m.submit()
    await drain()
    const req = m.http.expectOne(URL)
    expect(req.request.body).toEqual({ email: 'ops@tickover.dev', password: 'admin-pass-123', totp: '123456' })
    req.flush({ ok: true })
    await settle(m.fixture)
    expect(m.auth.admin()).toBe(true)
    expect(m.router.url).toBe('/admin')
  })

  /**
   * The server answers a wrong email, a wrong password and a wrong code with a
   * byte-identical 401 on purpose — no account-existence or password oracle — so
   * this page must not narrow it either. The password is not offered back to be
   * corrected field by field.
   */
  it('gives no oracle on a rejected sign-in', async () => {
    const m = await mount()
    await m.fill('ops@tickover.dev', 'wrong', '123456')
    m.submit()
    await drain()
    m.http.expectOne(URL).flush({ error: 'unauthorized' }, { status: 401, statusText: 'Unauthorized' })
    await settle(m.fixture)
    expect(m.error()).toBe('Wrong email, password, or code.')
    expect(m.auth.admin()).toBe(false)
    expect(m.router.url).not.toBe('/admin')
  })

  // An outage reported as bad credentials sends the operator to re-check a
  // password that was never the problem. The server's own status code separates
  // the two, so saying which is not an oracle.
  it('does not report an outage as a wrong password', async () => {
    const m = await mount()
    await m.fill('ops@tickover.dev', 'admin-pass-123', '123456')
    m.submit()
    await drain()
    m.http.expectOne(URL).flush({ error: 'internal' }, { status: 500, statusText: 'Server Error' })
    await settle(m.fixture)
    expect(m.error()).toContain("Couldn't reach the server")
    expect(m.error()).not.toContain('Wrong email')
    expect(m.auth.admin()).toBe(false)
  })

  /**
   * A TOTP code is good for one 30-second window, so a second submit is not a
   * harmless retry: it can arrive after the code has rolled, be refused, and
   * replace a sign-in that worked with a credentials error.
   */
  it('will not submit a second time while the first is in flight', async () => {
    const m = await mount()
    await m.fill('ops@tickover.dev', 'admin-pass-123', '123456')
    m.submit()
    await drain()
    expect((m.el.querySelector('[data-signin]') as HTMLButtonElement).disabled).toBe(true)
    m.submit()
    await drain()
    // One request, not two: `expectOne` fails outright if a second is queued.
    m.http.expectOne(URL).flush({ ok: true })
    await settle(m.fixture)
    expect(m.auth.admin()).toBe(true)
  })

  it('clears a previous error when the next attempt is made', async () => {
    const m = await mount()
    await m.fill('ops@tickover.dev', 'wrong', '123456')
    m.submit()
    await drain()
    m.http.expectOne(URL).flush({ error: 'unauthorized' }, { status: 401, statusText: 'Unauthorized' })
    await settle(m.fixture)
    expect(m.error()).toContain('Wrong email')

    m.submit()
    await drain()
    m.http.expectOne(URL).flush({ ok: true })
    await settle(m.fixture)
    expect(m.el.querySelector('[data-error]')).toBeNull()
  })
})
