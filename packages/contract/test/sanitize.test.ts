import { describe, it, expect } from 'vitest'
import { displayWidth, sanitizeText, truncateChars, truncateToWidth } from '../src/index.js'

describe('sanitizeText', () => {
  it('strips CSI color sequences', () => {
    expect(sanitizeText('\u001b[31mred\u001b[0m text', 100)).toBe('red text')
  })
  it('strips 8-bit CSI sequences, including ones with no parameters', () => {
    expect(sanitizeText('x\u009bmy', 100)).toBe('xy')
  })
  it('strips OSC title sequences terminated by BEL or ST', () => {
    expect(sanitizeText('a\u001b]0;evil title\u0007b', 100)).toBe('ab')
    expect(sanitizeText('a\u001b]8;;http://x\u001b\\b', 100)).toBe('ab')
  })
  it('strips C0 and C1 control characters and zero-width characters', () => {
    expect(sanitizeText('a\u0000b\u0085c\u200bd', 100)).toBe('abcd')
  })
  // Audit 2026-10-08 (Lower, C3): invisible characters the original zero-width class missed. Each
  // is asserted on its own so dropping any single one from the class goes red; built from code
  // points because a pasted invisible character cannot be seen in an editor or a diff (R917).
  it.each([
    ['U+2066 LEFT-TO-RIGHT ISOLATE', 0x2066],
    ['U+2067 RIGHT-TO-LEFT ISOLATE', 0x2067],
    ['U+2068 FIRST STRONG ISOLATE', 0x2068],
    ['U+2069 POP DIRECTIONAL ISOLATE', 0x2069],
    ['U+061C ARABIC LETTER MARK', 0x061c],
    ['U+180E MONGOLIAN VOWEL SEPARATOR', 0x180e],
    ['U+3164 HANGUL FILLER', 0x3164],
    ['U+FFA0 HALFWIDTH HANGUL FILLER', 0xffa0],
    ['U+E0000 (tag block start)', 0xe0000],
    ['U+E0001 LANGUAGE TAG', 0xe0001],
    ['U+E0041 TAG LATIN CAPITAL LETTER A', 0xe0041],
    ['U+E007F CANCEL TAG', 0xe007f],
  ])('strips %s', (_name, cp) => {
    const ch = String.fromCodePoint(cp)
    expect(sanitizeText(`pay${ch}ment${ch}`, 100)).toBe('payment')
  })
  it('keeps the neighbours of the stripped ranges', () => {
    // The other direction: a class widened by an off-by-one would eat real text.
    const keep = [0x061b, 0x061d, 0x180d, 0x180f, 0x3163, 0x3165, 0xff9f, 0xffa1, 0x1f600]
    for (const cp of keep) {
      const ch = String.fromCodePoint(cp)
      expect(sanitizeText(`a${ch}b`, 100)).toBe(`a${ch}b`)
    }
  })
  it('measures a sanitised string as wide as its visible text', () => {
    // Width budgets (statusline, pane) measure sanitised text; a filler that survives and is
    // counted as a column would make the budget disagree with what is drawn.
    const hidden = [0x2066, 0x3164, 0xffa0, 0xe0041, 0x180e].map((cp) => String.fromCodePoint(cp)).join('')
    expect(displayWidth(sanitizeText(`ok${hidden}go`, 100))).toBe(displayWidth('okgo'))
  })
  it('collapses newlines, tabs and runs of spaces', () => {
    expect(sanitizeText('  one\n\ttwo   three \r\n', 100)).toBe('one two three')
  })
  it('truncates by characters with an ellipsis', () => {
    expect(sanitizeText('abcdefghij', 5)).toBe('abcd…')
    expect(truncateChars('héllo', 5)).toBe('héllo')
  })
})

describe('truncateToWidth', () => {
  it('keeps short strings', () => {
    expect(truncateToWidth('hello', 10)).toBe('hello')
  })
  it('counts wide characters as two columns', () => {
    expect(truncateToWidth('日本語テキスト', 7)).toBe('日本語…')
  })
})
