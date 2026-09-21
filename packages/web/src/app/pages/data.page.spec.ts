import { TestBed } from '@angular/core/testing'
import { provideHttpClient } from '@angular/common/http'
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing'
import { provideRouter } from '@angular/router'
import { describe, it, expect, vi } from 'vitest'
import DataPage from './data.page'

const QUESTION = { question_id: '8f0b0f2e-6f6a-4a3a-9c1f-0f1e2d3c4b5a', text: 'Which model do you use most?', options: ['Opus', 'Sonnet'], counts: [30, 10], total: 40 }

/** Renders the page and answers its one request with `body` at `status`. */
async function renderWith(body: Record<string, unknown>, status = 200) {
  TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])] })
  const fixture = TestBed.createComponent(DataPage)
  fixture.detectChanges()
  const req = TestBed.inject(HttpTestingController).expectOne('/api/public/aggregates')
  if (status === 200) req.flush(body)
  else req.flush(body, { status, statusText: 'Service Unavailable' })
  await fixture.whenStable()
  fixture.detectChanges()
  return fixture.nativeElement as HTMLElement
}

describe('DataPage', () => {
  it('renders one card per profile question with bars and totals', async () => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])] })
    const fixture = TestBed.createComponent(DataPage)
    fixture.detectChanges()
    const http = TestBed.inject(HttpTestingController)
    http.expectOne('/api/public/aggregates').flush({ generated_at: '2026-09-10T10:00:00.000Z', questions: [{ question_id: '8f0b0f2e-6f6a-4a3a-9c1f-0f1e2d3c4b5a', text: 'Which model do you use most?', options: ['Opus', 'Sonnet'], counts: [30, 10], total: 40 }] })
    await fixture.whenStable()
    fixture.detectChanges()
    const el = fixture.nativeElement as HTMLElement
    expect(el.textContent).toContain('Which model do you use most?')
    expect(el.textContent).toContain('40 answers')
    const bars = el.querySelectorAll('[data-bar]')
    expect(bars).toHaveLength(2)
    expect((bars[0] as HTMLElement).style.width).toBe('75%')
    expect(el.textContent).toContain('Opus')
    expect(el.textContent).toContain('75%')
  })

  // The test above reads only the first bar. An implementation that ignored the
  // option index — `q.counts[0]` for every row — renders two 75% bars and passes it.
  it('sizes each bar from its own option count', async () => {
    const el = await renderWith({ generated_at: '2026-09-10T10:00:00.000Z', questions: [QUESTION] })
    const bars = el.querySelectorAll('[data-bar]')
    expect((bars[1] as HTMLElement).style.width).toBe('25%')
    expect(el.textContent).toContain('25%')
  })

  // A raw ISO string on a public buyer-acquisition page. Asserted as a shape
  // rather than an exact date: DatePipe formats in the machine's timezone.
  it('prints the generated date, not a raw ISO timestamp', async () => {
    const el = await renderWith({ generated_at: '2026-09-10T10:00:00.000Z', questions: [QUESTION] })
    expect(el.textContent).toMatch(/Generated \w+ \d{1,2}, 2026/)
    expect(el.textContent).not.toContain('2026-09-10T10:00:00.000Z')
    expect(el.textContent).not.toContain('T10:00')
  })

  it('says one answer, not "1 answers"', async () => {
    const el = await renderWith({ generated_at: '2026-09-10T10:00:00.000Z', questions: [{ ...QUESTION, options: ['Opus'], counts: [1], total: 1 }] })
    expect(el.textContent).toContain('1 answer')
    expect(el.textContent).not.toContain('1 answers')
  })

  // `AggregatesResponse` constrains counts to non-negative integers, not to `<= total`.
  // Unclamped this renders a 233%-wide bar that escapes its track.
  it('clamps a bar that would overflow its track', async () => {
    const el = await renderWith({ generated_at: '2026-09-10T10:00:00.000Z', questions: [{ ...QUESTION, options: ['Opus'], counts: [7], total: 3 }] })
    expect((el.querySelector('[data-bar]') as HTMLElement).style.width).toBe('100%')
  })

  it('shows the empty state when the study set is genuinely empty', async () => {
    const el = await renderWith({ generated_at: '2026-09-10T10:00:00.000Z', questions: [] })
    expect(el.textContent).toContain('No data yet.')
    expect(el.textContent).not.toContain("Couldn't load")
    expect(el.textContent).not.toContain('Loading…')
  })

  // An outage must not read as "the product has no data" on the one page whose job
  // is to prove the product has data. Both doors into the catch are covered: an
  // HTTP failure, and a 200 whose body the contract schema rejects.
  it.each([
    ['an outage', { error: 'boom' }, 503],
    ['a malformed body', { nope: true }, 200],
  ])('distinguishes a failure to load from an empty dataset — %s', async (_label, body, status) => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const el = await renderWith(body, status)
    expect(el.textContent).toContain("Couldn't load the latest numbers. Try again shortly.")
    expect(el.textContent).not.toContain('No data yet.')
    expect(el.textContent).not.toContain('Loading…')
    // No 1970: the failure path used to fake an empty response dated at the epoch.
    expect(el.textContent).not.toContain('1970')
    expect(el.textContent).not.toContain('Generated')
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })
})
