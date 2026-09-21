import { RULES } from './constants.js'
import type { ServedQuestion } from './question.js'
import { displayWidth, sanitizeText, truncateToWidth } from './sanitize.js'

export interface StatusInput {
  loggedIn: boolean
  question: ServedQuestion | null
  answered: { earnedCents: number } | null
  todayPaid: number
  pendingCents: number
  availableCents: number
  maxColumns?: number
}

// Claude Code renders the status line itself and truncates at COLUMNS-4 with its own ellipsis
// (measured 2026-09-06: a 200-column ruler came back as 184 columns + an ellipsis at COLUMNS=189).
// That cut is a blind right-edge chop -- exactly what eats the options this module works to
// preserve -- so we compose inside a margin and never hand it anything to cut. 4 measured, 2 spare.
export const STATUS_LINE_SAFETY_MARGIN = 6
// Sanity bounds only. 20 is below any usable terminal and 400 above any plausible one; the point is
// to reject a nonsense value, not to second-guess a real one -- see resolveColumns.
export const COLS_MIN = 20
export const COLS_MAX = 400

// Section 4.7 requires the sponsor be displayed with paid questions, not that it be displayed in
// full -- the pane, page and extension carry all 30 characters. Capping it here buys 14 columns,
// which at the 80-column fallback is the difference between three options fitting and failing.
export const SPONSOR_STATUS_MAX = 16
// Below these a field stops carrying information: a 12-column question fragment still conveys
// subject, a 6-column option still distinguishes itself from its neighbours. Under either floor
// the composition drops a rung rather than emitting stubs.
export const TEXT_MIN = 12
export const OPTION_MIN = 6

export const money = (cents: number) => `$${(cents / 100).toFixed(2)}`

/**
 * Resolves the column budget for the composed line.
 *
 * Precedence: an explicit config override, then the width detected by the status line script, then
 * the 80-column default. The default is a fallback for an UNKNOWN width, never a floor on a known
 * one: terminals genuinely go narrower (46 columns measured), and composing 80 columns for a
 * 46-column window wraps, which is the worst outcome available.
 */
export function resolveColumns(i: { detected?: number | null; configured?: number | null }): number {
  const pick = (v: number | null | undefined) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null)
  const raw = pick(i.configured) ?? pick(i.detected) ?? RULES.STATUS_LINE_MAX_COLUMNS
  const clamped = Math.min(COLS_MAX, Math.max(COLS_MIN, Math.floor(raw)))
  return clamped - STATUS_LINE_SAFETY_MARGIN
}

interface Opt {
  text: string
  /** Display columns the option needs in full. */
  full: number
  /** Display columns it has been granted. */
  show: number
}

const render = (opts: Opt[]) => opts.map((o, n) => `${n + 1} ${truncateToWidth(o.text, o.show)}`).join('  ')

/**
 * Water-fills `budget` display columns across the options: shortest first, each taking the smaller
 * of its own width and an equal share of what remains. Slack from short options therefore flows to
 * long ones instead of being wasted -- an equal split would spend columns on "No" that "It depends
 * on the specific workload" needs.
 *
 * Mutates and returns the given options, so callers hold one array rather than two parallel ones
 * that could fall out of step.
 */
function allocate(opts: Opt[], budget: number): Opt[] {
  let remaining = budget
  let left = opts.length
  for (const o of [...opts].sort((a, b) => a.full - b.full)) {
    o.show = Math.min(o.full, Math.max(0, Math.floor(remaining / left)))
    remaining -= o.show
    left--
  }
  return opts
}

/**
 * Composes a question line within `max` display columns, or returns null when it cannot be shown.
 *
 * The ordering rule (R22): the options carry more decision value per column than the question text.
 * "1 Postgres  2 SQLite  3 MySQL" is nearly answerable on its own; "Which database do you reach
 * for..." is not answerable at all. So the text is the compressible field and the options are
 * defended, down through four rungs, rather than the reverse -- which is what unconditional
 * right-edge truncation was silently doing.
 */
function composeQuestion(q: ServedQuestion, max: number): string | null {
  const prefix = q.kind === 'profile'
    ? 'tickover · unpaid · panel profile · '
    : `tickover · ${truncateToWidth(sanitizeText(q.sponsor, 30), SPONSOR_STATUS_MAX)} · ${money(q.price_cents)} · `
  const text = sanitizeText(q.text, RULES.QUESTION_TEXT_MAX)
  const opts: Opt[] = q.options.map((o) => {
    const t = sanitizeText(o, RULES.OPTION_TEXT_MAX)
    const full = displayWidth(t)
    return { text: t, full, show: full }
  })
  const avail = max - displayWidth(prefix)

  // 1. Everything fits as authored.
  const whole = render(opts)
  if (displayWidth(text) + 1 + displayWidth(whole) <= avail) return `${prefix}${text} ${whole}`

  // 2. Squeeze the question text, keep every option whole.
  const textOnly = avail - 1 - displayWidth(whole)
  if (textOnly >= TEXT_MIN) return `${prefix}${truncateToWidth(text, textOnly)} ${whole}`

  // 3. Squeeze the options too, but only while each stays legible. An option shorter than the floor
  //    is shown in full, so "Yes"/"No" never trip the fallback below.
  const fixed = opts.length * 2 + Math.max(0, opts.length - 1) * 2
  allocate(opts, avail - 1 - TEXT_MIN - fixed)
  if (opts.every((o) => o.show >= Math.min(OPTION_MIN, o.full))) {
    const squeezed = render(opts)
    return `${prefix}${truncateToWidth(text, avail - 1 - displayWidth(squeezed))} ${squeezed}`
  }

  // 4. No option can be legible. Say how many there are and where the keystroke goes, rather than
  //    emitting stubs -- this is also the only place anything tells a new developer how to answer.
  const hint = `press 1-${opts.length} in the pane`
  const textWithHint = avail - 3 - displayWidth(hint)
  if (textWithHint >= TEXT_MIN) return `${prefix}${truncateToWidth(text, textWithHint)} · ${hint}`

  // 5. Not even sponsor + payout + a question fragment fit. Section 4.7's disclosure is
  //    unconditional, so the question is suppressed rather than the disclosure degraded.
  return null
}

export function formatStatusLine(i: StatusInput): string {
  const max = i.maxColumns ?? RULES.STATUS_LINE_MAX_COLUMNS
  const tail = `today ${i.todayPaid}/${RULES.MAX_PAID_PER_DAY} · balance ${money(i.pendingCents + i.availableCents)}`
  const idle = `tickover · ${tail}`
  let line: string
  if (!i.loggedIn) line = 'tickover · run /tickover:setup to start earning'
  else if (i.question) line = composeQuestion(i.question, max) ?? idle
  else if (i.answered) line = `tickover · ✓ +${money(i.answered.earnedCents)} · ${tail}`
  else line = idle
  // Individual pieces (question text, option text, sponsor) are already sanitized above.
  // Re-running sanitizeText on the assembled line would collapse the deliberate double-space
  // separator between options — only width-truncation applies to the final line. This stays
  // unconditional (R17): the budgeting above is arithmetic, and this is the net under it.
  return truncateToWidth(line, max)
}
