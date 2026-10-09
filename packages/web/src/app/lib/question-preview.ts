import { RULES, bandHeader, bandMinColumns, bandRows, formatStatusLine, resolveColumns, sanitizeText, type ServedQuestion } from '@tickover/contract'
import type { StudyDraft } from './study-form'

export const PREVIEW_WIDTHS = [60, 80, 120] as const
export type PreviewWidth = (typeof PREVIEW_WIDTHS)[number]
export type PreviewSurface = 'status' | 'band'
export interface Previewable { question: ServedQuestion; placeholder: boolean }

// Fields the status line and the band never read; constants so the value is a valid ServedQuestion.
const INERT = { assignment_id: '00000000-0000-4000-8000-000000000000', context: null, served_at: '1970-01-01T00:00:00.000Z', expires_at: '1970-01-01T00:00:00.000Z' }

/**
 * What a developer would be served for this draft question. price_cents is the
 * developer's share because that is what the server serves (serve.ts) -- the
 * buyer's price on a developer's screen would overstate the payout by the fee.
 */
export function previewQuestion(q: StudyDraft['questions'][number], sponsor: string, developerCents: number): Previewable | null {
  const options = q.options.map((o) => o.trim()).filter((o) => o.length > 0)
  if (options.length < 2) return null
  const text = q.text.trim()
  const who = sponsor.trim()
  return {
    placeholder: !text || !who,
    question: { ...INERT, kind: 'choice', text: text || 'Your question', sponsor: who || 'Sponsor', options, price_cents: developerCents },
  }
}

const line = (q: ServedQuestion, width: number) =>
  formatStatusLine({ loggedIn: true, question: q, answered: null, todayPaid: 0, pendingCents: 0, availableCents: 0, maxColumns: resolveColumns({ detected: width }) })

/** The line at this width, and a sentence when it lost part of the question. */
export function statusLinePreview(q: ServedQuestion, width: number): { line: string; note: string | null } {
  const l = line(q, width)
  const header = bandHeader(q)
  // The header is what the contract puts first on every disclosed question, so a line that does not
  // open with it is one where the question was withheld. Not a match on 'question waiting': at a
  // narrow width that line is itself cut.
  if (!l.startsWith(header)) return { line: l, note: `At ${width} columns the question does not fit; developers see 'question waiting'.` }
  if (l.includes(` press 1-${q.options.length} in the pane`)) return { line: l, note: `At ${width} columns only the question start and 'press 1-${q.options.length} in the pane' fit.` }
  const whole = q.options.map((o, i) => `${i + 1} ${sanitizeText(o, RULES.OPTION_TEXT_MAX)}`).join('  ')
  if (!l.includes(whole)) return { line: l, note: `At ${width} columns the options are shortened too.` }
  const text = sanitizeText(q.text, RULES.QUESTION_TEXT_MAX)
  // The separator between header and text is three characters wide (space, mark, space).
  const start = header.length + 3
  if (l.slice(start).startsWith(text)) return { line: l, note: null }
  const shown = l.slice(start, l.length - whole.length - 1).replace(/…$/, '')
  return { line: l, note: `At ${width} columns the question is cut to its first ${Array.from(shown).length} characters.` }
}

/** Mirrors packages/plugin/hooks/band.tsx's two rows; approximate, because Ink wraps them, not CSS. */
export function bandPreview(q: ServedQuestion, width: number): { draws: true; rows: [string, string] } | { draws: false; note: string; line: string } {
  const header = bandHeader(q)
  if (width < bandMinColumns(header)) return { draws: false, note: `The band does not draw at ${width} columns; developers see the status line instead.`, line: line(q, width) }
  return { draws: true, rows: bandRows(q) }
}
