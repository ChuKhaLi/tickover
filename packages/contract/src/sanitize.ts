import stringWidth from 'string-width'

const OSC = /\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)/g
const CSI = /(?:\u001b\[|\u009b)[0-?]*[ -/]*[@-~]/g
const ESC_SINGLE = /\u001b[@-Z\\-_]/g
const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/g
// Invisible or direction-changing characters a buyer could use to hide or reorder what a developer
// reads: zero-width marks, line/paragraph separators, bidi embeddings/overrides (202A-202E) and
// isolates (2066-2069), the Arabic letter mark, the Mongolian vowel separator, the two Hangul
// fillers (drawn blank, but letters, so string-width counts them as columns) and the tag block
// E0000-E007F (invisible, used to smuggle ASCII). The `u` flag is what lets the class name astral
// code points; without it E0000 would be read as two surrogate halves (R917).
const ZERO_WIDTH = /[\u061c\u180e\u200b-\u200f\u2028-\u202e\u2060-\u2064\u2066-\u2069\u3164\uffa0\ufeff\u{e0000}-\u{e007f}]/gu

/**
 * Display columns a string occupies. The single authority on width in this codebase: any budgeting
 * that has to agree with truncateToWidth must measure with this, or budgets drift from cuts.
 */
export function displayWidth(s: string): number {
  return stringWidth(s)
}

export function sanitizeText(input: string, maxChars: number): string {
  const cleaned = input
    .replace(OSC, '')
    .replace(CSI, '')
    .replace(ESC_SINGLE, '')
    .replace(CONTROL, '')
    .replace(ZERO_WIDTH, '')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/ {2,}/g, ' ')
    .trim()
  return truncateChars(cleaned, maxChars)
}

export function truncateChars(s: string, maxChars: number): string {
  const chars = Array.from(s)
  if (chars.length <= maxChars) return s
  return chars.slice(0, Math.max(0, maxChars - 1)).join('') + '…'
}

export function truncateToWidth(s: string, maxColumns: number): string {
  if (stringWidth(s) <= maxColumns) return s
  let out = ''
  for (const ch of Array.from(s)) {
    if (stringWidth(out + ch) > maxColumns - 1) break
    out += ch
  }
  return out + '…'
}
