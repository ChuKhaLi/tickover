import { TestBed, type ComponentFixture } from '@angular/core/testing'
import { describe, it, expect } from 'vitest'
import { WaitlistForm, WAITLIST_FETCH, WAITLIST_URL } from './waitlist-form'

/** One macrotask drains every pending microtask; `whenStable()` alone does not. */
async function settle(fixture: ComponentFixture<WaitlistForm>) {
  await fixture.whenStable()
  await new Promise((ok) => setTimeout(ok, 0))
  fixture.detectChanges()
}

async function typeAndSubmit(email: string, audience: 'developer' | 'buyer' = 'developer') {
  const fixture = TestBed.createComponent(WaitlistForm)
  fixture.componentRef.setInput('audience', audience)
  fixture.detectChanges()
  // NgForm adds its NgModel a microtask after the first render, and the value
  // accessor's onChange is wired there. Typing before that lands silently does
  // nothing — which is how this helper first failed.
  await settle(fixture)
  const el = fixture.nativeElement as HTMLElement
  const input = el.querySelector('input')!
  input.value = email
  input.dispatchEvent(new Event('input'))
  await settle(fixture)
  // Against `input.value`, not the typed string: a `type="email"` input strips
  // surrounding whitespace before ngModel ever sees it. What this pins is that the
  // model followed the DOM at all — typing before NgForm wires up is silent.
  expect(fixture.componentInstance.email).toBe(input.value)
  el.querySelector('form')!.dispatchEvent(new Event('submit'))
  await settle(fixture)
  return { fixture, el }
}

describe('WaitlistForm', () => {
  // `VITE_WAITLIST_ENDPOINT` is unset in this repo, so the default `WAITLIST_URL`
  // is ''. That is the state the Phase 0 page ships in until the form endpoint is
  // wired, and the one way it must never behave is to look like it worked.
  it('says it could not send when there is no endpoint, and does not claim success', async () => {
    const { el } = await typeAndSubmit('dev@example.com')
    expect(el.textContent).toContain("Couldn't send. Email hello@tickover.dev instead.")
    // The failure the whole test exists for: `submitWaitlist` returning 'ok' on an
    // empty endpoint would render the green confirmation to a developer whose email
    // went nowhere.
    expect(el.textContent).not.toContain("You're on the list")
    expect(el.querySelector('form')).not.toBeNull()
  })

  it('rejects a malformed address locally', async () => {
    const { el } = await typeAndSubmit('nope')
    expect(el.textContent).toContain("That email doesn't look right.")
    expect(el.textContent).not.toContain("Couldn't send")
  })

  // Replaces a `setInput` then read-back check, which exercised Angular's `input()`
  // rather than this component and could not fail for any reason within it.
  it('posts the trimmed address and its audience, then confirms and retires the form', async () => {
    const calls: Array<{ url: string; init: RequestInit }> = []
    const capture = (async (url: string, init: RequestInit) => {
      calls.push({ url, init })
      return new Response('{}', { status: 200 })
    }) as unknown as typeof fetch
    TestBed.configureTestingModule({ providers: [
      { provide: WAITLIST_URL, useValue: 'https://formspree.io/f/test' },
      { provide: WAITLIST_FETCH, useValue: capture },
    ] })
    const { fixture, el } = await typeAndSubmit('pm@acme.test', 'buyer')
    expect(calls).toHaveLength(1)
    expect(calls[0]!.url).toBe('https://formspree.io/f/test')
    expect(calls[0]!.init.method).toBe('POST')
    expect(JSON.parse(String(calls[0]!.init.body))).toEqual({ email: 'pm@acme.test', audience: 'buyer' })
    expect(el.textContent).toContain("You're on the list. We'll email you when it opens.")
    expect(el.querySelector('form')).toBeNull()

    // The trim cannot be reached through the DOM — the email input strips the
    // whitespace first — so it is driven against the model the component owns.
    fixture.componentInstance.email = '  spaced@acme.test  '
    await fixture.componentInstance.submit()
    expect(JSON.parse(String(calls[1]!.init.body)).email).toBe('spaced@acme.test')
  })
})
