// The spec's success criteria, as data. Scores are compared as integers 0-100, the way Lighthouse
// displays them, so a 0.945 that displays as 95 is not failed on a rounding artefact.
export const THRESHOLDS = {
  categories: { performance: 95, accessibility: 100, 'best-practices': 100, seo: 100 },
  lcpMs: 2500,
  cls: 0.1,
  tbtMs: 200,
} as const

export type Thresholds = typeof THRESHOLDS
export interface LhrLike {
  categories: Record<string, { score: number | null }>
  audits: Record<string, { numericValue?: number }>
}

export function evaluate(lhr: LhrLike, t: Thresholds = THRESHOLDS): string[] {
  const out: string[] = []
  for (const [id, min] of Object.entries(t.categories)) {
    const c = lhr.categories[id]
    if (!c || c.score === null) { out.push(`${id} missing from report`); continue }
    const score = Math.round(c.score * 100)
    if (score < min) out.push(`${id} ${score} < ${min}`)
  }
  const metric = (id: string, label: string, max: number) => {
    const v = lhr.audits[id]?.numericValue
    if (v === undefined) out.push(`${label} missing from report`)
    else if (v > max) out.push(`${label} ${Number(v.toFixed(3))} > ${max}`)
  }
  metric('largest-contentful-paint', 'LCP', t.lcpMs)
  metric('cumulative-layout-shift', 'CLS', t.cls)
  metric('total-blocking-time', 'TBT', t.tbtMs)
  return out
}

export function median<T>(runs: T[], key: (r: T) => number): T {
  if (runs.length === 0) throw new Error('median of no runs')
  return [...runs].sort((a, b) => key(a) - key(b))[Math.floor(runs.length / 2)]!
}

/**
 * Lighthouse 13 declares node >=22.19, while this package allows >=20. Pulled out as a pure
 * function -- rather than an inline comparison in `scripts/lighthouse.ts` -- so the guard can be
 * unit-tested directly: `lighthouse.ts` only imports `lighthouse`/`chrome-launcher` dynamically,
 * inside `main()`, after this check has already exited on a `false`, so there is no way to force
 * an unsupported runtime through those packages themselves to prove the guard fires.
 */
export function nodeSupportsLighthouse(version: string): boolean {
  const [major, minor] = version.split('.').map(Number) as [number, number]
  return major > 22 || (major === 22 && minor >= 19)
}
