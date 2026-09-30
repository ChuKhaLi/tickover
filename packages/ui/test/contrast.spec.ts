import { describe, expect, it } from 'vitest'
import { BADGE_TONE } from '../src/badge'
import { BUTTON_VARIANT } from '../src/button'
import type { Tone } from '../src/tone'
import { contrast, hexOf } from './palette'

/** The light and dark text/fill a class string paints. A missing half is a finding, not a skip. */
export function pair(classes: string, theme: 'light' | 'dark'): { fg: string; bg: string } {
  const pick = (kind: 'text' | 'bg') => {
    const re = theme === 'light' ? new RegExp(`(?:^|\\s)${kind}-([a-z0-9-]+)`) : new RegExp(`(?:^|\\s)dark:${kind}-([a-z0-9-]+)`)
    return classes.match(re)?.[1]
  }
  const fg = pick('text') ?? (theme === 'dark' ? classes.match(/(?:^|\s)text-([a-z0-9-]+)/)?.[1] : undefined)
  const bg = pick('bg') ?? (theme === 'dark' ? classes.match(/(?:^|\s)bg-([a-z0-9-]+)/)?.[1] : undefined)
  if (!fg || !bg) throw new Error(`no ${theme} text/bg pair in: ${classes}`)
  return { fg: hexOf(fg), bg: hexOf(bg) }
}

const TONES: Tone[] = ['neutral', 'accent', 'info', 'attention', 'positive', 'negative']

describe('tk-badge tones', () => {
  for (const tone of TONES) for (const theme of ['light', 'dark'] as const) {
    it(`${tone} text clears 4.5 on its own fill (${theme})`, () => {
      const { fg, bg } = pair(BADGE_TONE[tone], theme)
      expect(contrast(fg, bg)).toBeGreaterThanOrEqual(4.5)
    })
  }
  it('gives every tone a distinct light fill, so hue tells them apart', () => {
    expect(new Set(TONES.map((t) => pair(BADGE_TONE[t], 'light').bg)).size).toBe(TONES.length)
  })
})

describe('tk-button variants with a fill', () => {
  for (const v of ['primary', 'danger'] as const) for (const theme of ['light', 'dark'] as const) {
    it(`${v} clears 4.5 (${theme})`, () => {
      const { fg, bg } = pair(BUTTON_VARIANT[v], theme)
      expect(contrast(fg, bg)).toBeGreaterThanOrEqual(4.5)
    })
  }
})

import { BANNER_KIND } from '../src/banner'
describe('tk-banner kinds', () => {
  for (const k of ['info', 'warning', 'error'] as const) for (const theme of ['light', 'dark'] as const) {
    it(`${k} clears 4.5 (${theme})`, () => { const { fg, bg } = pair(BANNER_KIND[k], theme); expect(contrast(fg, bg)).toBeGreaterThanOrEqual(4.5) })
  }
})

import { NAV_ACTIVE } from '../src/nav-item'
import { SEGMENTED_ON } from '../src/segmented'
describe('tk-segmented and tk-nav-item selected states', () => {
  for (const theme of ['light', 'dark'] as const) {
    it(`segmented on clears 4.5 (${theme})`, () => {
      const { fg, bg } = pair(SEGMENTED_ON, theme)
      expect(contrast(fg, bg)).toBeGreaterThanOrEqual(4.5)
    })
    it(`nav item active clears 4.5 (${theme})`, () => {
      const { fg, bg } = pair(NAV_ACTIVE.replaceAll('[&.is-active]:', ''), theme)
      expect(contrast(fg, bg)).toBeGreaterThanOrEqual(4.5)
    })
  }
})
