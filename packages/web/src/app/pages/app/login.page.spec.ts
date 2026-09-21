import { TestBed } from '@angular/core/testing'
import { provideHttpClient } from '@angular/common/http'
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing'
import { provideRouter } from '@angular/router'
import { describe, it, expect, afterEach } from 'vitest'
import LoginPage from './login.page'

function mount() {
  TestBed.resetTestingModule()
  TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])] })
  const fixture = TestBed.createComponent(LoginPage)
  fixture.detectChanges()
  return { fixture, el: fixture.nativeElement as HTMLElement, http: TestBed.inject(HttpTestingController) }
}

function submit(el: HTMLElement, email: string) {
  const input = el.querySelector('input[type=email]') as HTMLInputElement
  input.value = email
  input.dispatchEvent(new Event('input'))
  ;(el.querySelector('form') as HTMLFormElement).dispatchEvent(new Event('submit'))
}

const SENT = 'Check your email for the sign-in link'

describe('buyer LoginPage', () => {
  afterEach(() => TestBed.inject(HttpTestingController).verify())

  it('requests a link and shows the check-email message', async () => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])] })
    const fixture = TestBed.createComponent(LoginPage)
    fixture.detectChanges()
    const el = fixture.nativeElement as HTMLElement
    const input = el.querySelector('input[type=email]') as HTMLInputElement
    input.value = 'pm@acme.test'
    input.dispatchEvent(new Event('input'))
    ;(el.querySelector('form') as HTMLFormElement).dispatchEvent(new Event('submit'))
    const http = TestBed.inject(HttpTestingController)
    const req = http.expectOne('/api/buyer/auth/request')
    expect(req.request.body).toEqual({ email: 'pm@acme.test' })
    req.flush({ ok: true })
    await fixture.whenStable()
    fixture.detectChanges()
    expect(el.textContent).toContain('Check your email for the sign-in link')
  })

  // The server lower-cases the address before it writes the login token, and the
  // buyers table is keyed on email. An address typed with a capital or a stray
  // space has to reach the wire in the same shape the account was created with,
  // or the buyer is silently handed a second, empty account.
  it('normalises the address on the way to the wire', async () => {
    const { fixture, el, http } = mount()
    submit(el, '  PM@Acme.Test  ')
    expect(http.expectOne('/api/buyer/auth/request').request.body).toEqual({ email: 'pm@acme.test' })
    await fixture.whenStable()
  })

  // The endpoint answers `{ ok: true }` whether or not the address has an account,
  // so this page can never say "no such account" — and it must not say "sent"
  // when nothing was sent either. The success text is asserted absent here and
  // present in the test above, so the absence means the failed branch rendered.
  it('does not claim the mail was sent when the request fails', async () => {
    const { fixture, el, http } = mount()
    submit(el, 'pm@acme.test')
    http.expectOne('/api/buyer/auth/request').flush({ error: 'internal' }, { status: 500, statusText: 'Server Error' })
    await fixture.whenStable()
    fixture.detectChanges()
    expect(el.textContent).not.toContain(SENT)
    expect(el.textContent).toContain("Couldn't send the link")
    // Still usable: the form has to survive the failure for the retry the copy invites.
    expect(el.querySelector('input[type=email]')).not.toBeNull()
    expect((el.querySelector('button[type=submit]') as HTMLButtonElement).disabled).toBe(false)
  })

  // A second POST from a double click mints a second login token and invalidates
  // nothing; the button has to be out of action while the first is in flight.
  it('holds the button while the request is in flight', () => {
    const { fixture, el, http } = mount()
    submit(el, 'pm@acme.test')
    fixture.detectChanges()
    expect((el.querySelector('button[type=submit]') as HTMLButtonElement).disabled).toBe(true)
    http.expectOne('/api/buyer/auth/request').flush({ ok: true })
  })

  // The layout route wraps this page, so it must not carry a second copy of the
  // site chrome. `app.page.spec.ts` counts the headers a routed /app/login renders;
  // this is the source-side half — the page owns no shell of its own.
  it('renders no site chrome of its own', () => {
    const { el } = mount()
    expect(el.querySelector('header'), 'the layout route already supplies the header').toBeNull()
    expect(el.querySelector('form'), 'and the probe is not looking at an empty component').not.toBeNull()
  })
})
