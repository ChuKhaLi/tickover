import { RULES, sanitizeText, type ServedQuestion } from '@tickover/contract'
import { COLS_MAX, bandHeader, bandMinColumns, formatStatusLine } from '@tickover/contract'

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
    // Header and floor are the contract's (bandHeader), so the buyer's preview draws the same one.
    const header = bandHeader(q)
    return {
      state: 'question',
      assignment_id: q.assignment_id,
      header,
      text: sanitizeText(q.text, RULES.QUESTION_TEXT_MAX),
      options: q.options.map((o) => sanitizeText(o, RULES.OPTION_TEXT_MAX)),
      min_columns: bandMinColumns(header),
    }
  }
  if (i.answered) {
    // The same line the status line shows for the same ten seconds, composed by the same function.
    return { state: 'answered', text: formatStatusLine({ ...i, question: null, maxColumns: COLS_MAX }) }
  }
  return { state: 'none' }
}
