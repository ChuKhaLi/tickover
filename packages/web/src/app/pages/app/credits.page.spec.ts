import { TestBed, type ComponentFixture } from '@angular/core/testing'
import { provideHttpClient } from '@angular/common/http'
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing'
import { provideRouter } from '@angular/router'
import { describe, it, expect } from 'vitest'
import CreditsPage, { routeMeta } from './credits.page'
import { AuthState, buyerGuard } from '../../lib/auth'
import { SITE_NAME } from '../../lib/page-meta'

const BUYER = { id: '8f0b0f2e-6f6a-4a3a-9c1f-0f1e2d3c4b5a', email: 'pm@acme.test', org: null, credit_cents: 1250, first_study_used: true }
const PAYMENT = { id: '11111111-1111-4111-8111-111111111111', study_id: '22222222-2222-4222-8222-222222222222', cents: 2750, method: 'wise', reference: 'W-1', recorded_at: '2026-09-26T10:00:00.000Z' }

async function settle(fixture: ComponentFixture<unknown>) {
  await fixture.whenStable()
  await new Promise((ok) => setTimeout(ok, 0))
  fixture.detectChanges()
}

function mount(buyer: typeof BUYER | null = BUYER) {
  TestBed.resetTestingModule()
  TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])] })
  TestBed.inject(AuthState).buyer.set(buyer)
  const fixture = TestBed.createComponent(CreditsPage)
  fixture.detectChanges()
  const el = fixture.nativeElement as HTMLElement
  return { fixture, el, http: TestBed.inject(HttpTestingController), text: () => (el.textContent ?? '').replace(/\s+/g, ' ') }
}

describe('CreditsPage', () => {
  it('is guarded and titled', () => {
    expect(routeMeta.canActivate).toContain(buyerGuard)
    expect(routeMeta.title).toBe(`${SITE_NAME} — Credits`)
  })

  it('shows the balance and where credit comes from, with no packs and no buy button', async () => {
    const m = mount()
    m.http.expectOne('/api/buyer/payments').flush([])
    await settle(m.fixture)
    expect(m.text()).toContain('Balance: $12.50')
    expect(m.text()).toContain('used first on your next study')
    expect(m.el.querySelector('[data-pack]')).toBeNull()
    expect(Array.from(m.el.querySelectorAll('button')).some((b) => /buy/i.test(b.textContent ?? ''))).toBe(false)
  })

  it('lists payments received', async () => {
    const m = mount()
    m.http.expectOne('/api/buyer/payments').flush([PAYMENT])
    await settle(m.fixture)
    const row = m.el.querySelector('[data-payment]')!
    expect(row.textContent).toContain('$27.50')
    expect(row.textContent).toContain('W-1')
  })

  it('says so when payments cannot load', async () => {
    const m = mount()
    m.http.expectOne('/api/buyer/payments').flush({ error: 'x' }, { status: 500, statusText: 'Server Error' })
    await settle(m.fixture)
    expect(m.text()).toContain("Couldn't load your payments")
  })

  it('names the refund route with the contact address', async () => {
    const m = mount()
    m.http.expectOne('/api/buyer/payments').flush([])
    await settle(m.fixture)
    const link = m.el.querySelector('a[href^="mailto:"]')!
    expect(link.getAttribute('href')).toBe('mailto:hello@tickover.dev')
    expect(m.text()).toContain('Unused credit is refunded on request')
  })

  it('loads no third-party script', async () => {
    const m = mount()
    m.http.expectOne('/api/buyer/payments').flush([])
    await settle(m.fixture)
    expect(document.querySelector('script[src*="paddle"]')).toBeNull()
  })

  it('shows how much of a payment was refunded', async () => {
    const m = mount()
    m.http.expectOne('/api/buyer/payments').flush([{ ...PAYMENT, method: 'paypal', reversed_cents: 1000 }])
    await settle(m.fixture)
    expect(m.el.querySelector('[data-payment]')!.textContent).toContain('refunded $10.00')
  })

  // Review finding 1: a payment with nothing reversed must not show the word at all -- pinned
  // separately from the positive case above, since a guard that always renders "refunded" would
  // pass a substring check on the positive test alone.
  it('says nothing about a refund when reversed_cents is 0', async () => {
    const m = mount()
    m.http.expectOne('/api/buyer/payments').flush([{ ...PAYMENT, method: 'paypal', reversed_cents: 0 }])
    await settle(m.fixture)
    expect(m.el.querySelector('[data-payment]')!.textContent).not.toContain('refunded')
  })
})
