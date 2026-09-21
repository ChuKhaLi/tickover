import stringWidth from 'string-width'

const OSC = /\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)/g
const CSI = /(?:\u001b\[|\u009b)[0-?]*[ -/]*[@-~]/g
const ESC_SINGLE = /\u001b[@-Z\\-_]/g
const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/g
const ZERO_WIDTH = /[\u200b-\u200f\u2028-\u202e\u2060-\u2064\ufeff]/g

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
