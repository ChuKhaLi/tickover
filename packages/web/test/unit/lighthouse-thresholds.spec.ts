import { describe, it, expect } from 'vitest'
import { THRESHOLDS, evaluate, median, nodeSupportsLighthouse, type LhrLike } from '../../scripts/lighthouse-thresholds'

const passing = (): LhrLike => ({
  categories: {
    performance: { score: 0.97 }, accessibility: { score: 1 },
    'best-practices': { score: 1 }, seo: { score: 1 },
  },
  audits: {
    'largest-contentful-paint': { numericValue: 1800 },
    'cumulative-layout-shift': { numericValue: 0.01 },
    'total-blocking-time': { numericValue: 40 },
  },
})

describe('evaluate', () => {
  it('passes a report that meets every target', () => {
    expect(evaluate(passing())).toEqual([])
  })
  it('names the one category that misses, with its score', () => {
    const r = passing(); r.categories['seo']!.score = 0.92
    expect(evaluate(r)).toEqual(['seo 92 < 100'])
  })
  it('treats the boundary as passing: Perf exactly 95, LCP exactly 2500 ms, CLS exactly 0.1', () => {
    const r = passing()
    r.categories['performance']!.score = 0.95
    r.audits['largest-contentful-paint']!.numericValue = 2500
    r.audits['cumulative-layout-shift']!.numericValue = 0.1
    expect(evaluate(r)).toEqual([])
  })
  // One case per metric: with only the CLS case, deleting the LCP or TBT check left every test green
  // (measured in review on the extracted module).
  it('fails CLS over its limit', () => {
    const r = passing(); r.audits['cumulative-layout-shift']!.numericValue = 0.604
    expect(evaluate(r)).toEqual(['CLS 0.604 > 0.1'])
  })
  it('fails LCP one millisecond over', () => {
    const r = passing(); r.audits['largest-contentful-paint']!.numericValue = 2501
    expect(evaluate(r)).toEqual(['LCP 2501 > 2500'])
  })
  it('fails TBT one millisecond over', () => {
    const r = passing(); r.audits['total-blocking-time']!.numericValue = 201
    expect(evaluate(r)).toEqual(['TBT 201 > 200'])
  })
  it('fails a report missing a category rather than passing it', () => {
    const r = passing(); delete (r.categories as Record<string, unknown>)['seo']
    expect(evaluate(r)).toEqual(['seo missing from report'])
  })
  it('uses the thresholds the spec sets', () => {
    expect(THRESHOLDS).toEqual({
      categories: { performance: 95, accessibility: 100, 'best-practices': 100, seo: 100 },
      lcpMs: 2500, cls: 0.1, tbtMs: 200,
    })
  })
})

describe('median', () => {
  it('picks the middle run by the key, not the first or last', () => {
    expect(median([{ p: 90 }, { p: 70 }, { p: 80 }], (r) => r.p)).toEqual({ p: 80 })
  })
})

// Extracted so the version guard in scripts/lighthouse.ts can be proven without actually running
// on an unsupported Node, and so it is a pure function the guard calls rather than an inline
// comparison nothing exercises. Lighthouse 13 declares node >=22.19; this package allows >=20.
describe('nodeSupportsLighthouse', () => {
  it('rejects 22.18.0, one minor below the floor', () => {
    expect(nodeSupportsLighthouse('22.18.0')).toBe(false)
  })
  it('accepts 22.19.0, exactly the floor', () => {
    expect(nodeSupportsLighthouse('22.19.0')).toBe(true)
  })
  it('rejects 20.11.1, an earlier major entirely', () => {
    expect(nodeSupportsLighthouse('20.11.1')).toBe(false)
  })
  it('accepts 24.0.0, a later major', () => {
    expect(nodeSupportsLighthouse('24.0.0')).toBe(true)
  })
})
