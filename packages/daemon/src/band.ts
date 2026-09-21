import { RULES, displayWidth, sanitizeText, truncateToWidth, type ServedQuestion } from '@tickover/contract'
import { COLS_MAX, SPONSOR_STATUS_MAX, formatStatusLine, money } from '@tickover/contract'

/**
 * What the plugin's hooks module draws above Claude Code's prompt (spec
 * 2026-09-15-claude-mods-band-design.md). Composed here rather than in the module because a hooks
 * module cannot import @tickover/contract, so this is the only place buyer text can be sanitised
 * on its way to that surface (R203).
 */
export type BandView =
  | { state: 'none' }
  | { state: 'question'; assignment_id: string; header: string; text: string; options: string[]; min_columns: number }
  | { state: 'answered'; text: string }

export interface BandInput {
  loggedIn: boolean
  question: ServedQuestion | null
  answered: { earnedCents: number } | null
  todayPaid: number
  pendingCents: number
  availableCents: number
}

export function composeBand(i: BandInput): BandView {
  if (!i.loggedIn) return { state: 'none' }
  const q = i.question
  if (q) {
    // Section 4.7: sponsor and amount are shown with every paid question. The sponsor is capped
    // exactly as the status line caps it; the band has rows to spare, but a header that never
    // exceeds the status line's is one the two surfaces cannot disagree about.
    const header = q.kind === 'profile'
      ? 'tickover · unpaid · panel profile'
      : `tickover · ${truncateToWidth(sanitizeText(q.sponsor, 30), SPONSOR_STATUS_MAX)} · ${money(q.price_cents)}`
    return {
      state: 'question',
      assignment_id: q.assignment_id,
      header,
      text: sanitizeText(q.text, RULES.QUESTION_TEXT_MAX),
      options: q.options.map((o) => sanitizeText(o, RULES.OPTION_TEXT_MAX)),
      // The module draws nothing narrower than this, so the header is never wrapped or cut. +2 for
      // the bullet and its space, which the module draws *before* the header -- the row is
      // `● ${header} · ${text}` (packages/plugin/hooks/band.tsx). At +1 the band agreed to draw one
      // column short of its own first row, and a greedy wrap put the amount on row 2, which section
      // 4.7 forbids. Not more than +2: a wider floor hides the band where it could legitimately draw.
      min_columns: displayWidth(header) + 2,
    }
  }
  if (i.answered) {
    // The same line the status line shows for the same ten seconds, composed by the same function.
    return { state: 'answered', text: formatStatusLine({ ...i, question: null, maxColumns: COLS_MAX }) }
  }
  return { state: 'none' }
}
