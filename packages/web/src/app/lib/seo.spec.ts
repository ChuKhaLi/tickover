import { TestBed } from '@angular/core/testing'
import { DOCUMENT } from '@angular/common'
import { Seo } from './seo'
import { PAGE_META, SITE_URL } from './page-meta'

const head = () => TestBed.inject(DOCUMENT).head
const attr = (sel: string, a = 'content') => head().querySelector(sel)?.getAttribute(a) ?? null

describe('Seo.apply', () => {
  let seo: Seo
  beforeEach(() => { seo = TestBed.inject(Seo) })

  it('writes the full preview set for a public route', () => {
    seo.apply('/buyers')
    const m = PAGE_META['/buyers']!
    expect(attr('meta[name="description"]')).toBe(m.description)
    expect(attr('meta[property="og:title"]')).toBe(m.title)
    expect(attr('meta[property="og:url"]')).toBe(`${SITE_URL}/buyers`)
    expect(attr('link[rel="canonical"]', 'href')).toBe(`${SITE_URL}/buyers`)
    expect(attr('meta[property="og:image"]')).toBe(`${SITE_URL}/og.png`)
    expect(attr('meta[name="twitter:card"]')).toBe('summary_large_image')
    expect(head().querySelector('meta[name="robots"]')).toBeNull()
  })

  it('replaces rather than appends when navigating between public routes', () => {
    seo.apply('/'); seo.apply('/buyers')
    expect(head().querySelectorAll('link[rel="canonical"]')).toHaveLength(1)
    expect(head().querySelectorAll('meta[name="description"]')).toHaveLength(1)
    expect(head().querySelectorAll('script[type="application/ld+json"]')).toHaveLength(0)
  })

  it('puts Organization and WebSite JSON-LD on / only, and nothing that claims a rating', () => {
    seo.apply('/')
    const s = head().querySelectorAll('script[type="application/ld+json"]')
    expect(s).toHaveLength(1)
    const data = JSON.parse(s[0]!.textContent!)
    expect(data['@graph'].map((n: { '@type': string }) => n['@type'])).toEqual(['Organization', 'WebSite'])
    expect(s[0]!.textContent).not.toMatch(/aggregateRating|review|FAQPage|SoftwareApplication/i)
  })

  it('marks a route off the map noindex and drops the canonical', () => {
    seo.apply('/'); seo.apply('/app/login')
    expect(attr('meta[name="robots"]')).toBe('noindex')
    expect(head().querySelector('link[rel="canonical"]')).toBeNull()
    expect(head().querySelectorAll('script[type="application/ld+json"]')).toHaveLength(0)
  })

  it('clears noindex again on the way back to a public route', () => {
    seo.apply('/app/login'); seo.apply('/developers')
    expect(head().querySelector('meta[name="robots"]')).toBeNull()
  })

  it('ignores a query and a fragment', () => {
    seo.apply('/buyers?x=1#waitlist')
    expect(attr('link[rel="canonical"]', 'href')).toBe(`${SITE_URL}/buyers`)
  })
})
