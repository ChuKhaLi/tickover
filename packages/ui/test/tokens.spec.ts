import { describe, expect, it } from 'vitest'
import { contrast, hexOf, tokens, tokensCss } from './palette'

describe('packages/ui/tokens.css', () => {
  it('declares both 11-step ramps and every state token the components use', () => {
    const t = tokens()
    for (const ramp of ['ink', 'signal']) for (const step of [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950]) expect(t.has(`${ramp}-${step}`), `${ramp}-${step}`).toBe(true)
    for (const s of ['review', 'settled', 'rejected']) for (const k of ['fg', 'bg', 'edge', 'bg-dark', 'edge-dark']) expect(t.has(`${s}-${k}`), `${s}-${k}`).toBe(true)
  })
  it('is a Tailwind @theme block with the type roles and radii', () => {
    const css = tokensCss()
    expect(css).toMatch(/@theme\s*\{/)
    for (const name of ['--font-sans', '--font-mono', '--text-small', '--text-caption', '--radius-chip', '--radius-control', '--radius-card']) expect(css).toContain(name)
  })
  it('measures, so a lightened ink-600 would go red here and not just in the web', () => {
    expect(contrast(hexOf('ink-600'), hexOf('ink-50'))).toBeGreaterThanOrEqual(4.5)
  })
})
