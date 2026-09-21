import { RULES, money, sanitizeText, truncateToWidth, type ServedQuestion } from '@tickover/contract'
import type { QuestionView } from './http.js'

export interface PaneState {
  view: QuestionView
  answered: { earnedCents: number } | null
  message: string | null
  width: number
  height: number
}
export type PaneAction = { type: 'answer'; optionIndex: number } | { type: 'skip' } | { type: 'quit' } | { type: 'none' }

// `money` comes from the contract, like the composer and the width helpers beside it.
// This file had its own copy, identical to it, which is the arrangement a figure
// drifts out of: two formatters agree until one of them is changed for a reason the
// other never hears about, and the pane and the status line are the same product
// quoting the same cents.

export function renderPane(s: PaneState): string {
  const w = Math.max(20, s.width)
  // Only truncateToWidth runs over the fully composed line (R17): sanitizeText's own
  // space-collapsing and trimming is meant for one untrusted field at a time, not a line that
  // already carries our own layout whitespace (the "  1  " option gutter) -- running it over the
  // composed line would eat that gutter along with anything actually worth stripping.
  const fit = (line: string) => truncateToWidth(line, w)
  const rule = '─'.repeat(w)
  const v = s.view
  const head = v.logged_in
    ? `tickover · ${s.answered ? `✓ +${money(s.answered.earnedCents)} · ` : ''}today ${v.today_paid_answers}/${RULES.MAX_PAID_PER_DAY} · balance ${money(v.balance_pending_cents + v.balance_available_cents)}`
    : 'tickover · not logged in'
  const q: ServedQuestion | null = v.question
  const body: string[] = []
  if (!v.logged_in) body.push('Not logged in. Run: tickover login')
  else if (!q) body.push('Waiting for the next question…')
  else {
    // Sanitize each server-controlled field on its own, before it's woven into a formatted
    // line -- this is what actually strips a malicious sponsor/text/option's escape codes,
    // without disturbing the surrounding layout.
    const sponsor = sanitizeText(q.sponsor, 60)
    const text = sanitizeText(q.text, RULES.QUESTION_TEXT_MAX)
    const context = q.context ? sanitizeText(q.context, RULES.CONTEXT_MAX) : null
    const options = q.options.map((o) => sanitizeText(o, RULES.OPTION_TEXT_MAX))
    body.push(q.kind === 'profile' ? 'Tickover panel profile · unpaid' : `${sponsor} asks · ${money(q.price_cents)}`)
    body.push(text)
    if (context) body.push(context)
    options.forEach((o, i) => body.push(`  ${i + 1}  ${o}`))
  }
  if (s.message) body.push(s.message)
  return [head, rule, ...body, rule, '1-5 answer · 0 skip · q quit'].map(fit).join('\n')
}

export function handleKey(key: string, s: PaneState): PaneAction {
  // Ctrl-C: raw mode clears ISIG, so it never becomes SIGINT -- it arrives here as byte 0x03.
  // Written as the explicit escape text (not the raw control byte itself), which is invisible
  // in an editor/diff and reads exactly like an empty string.
  if (key === 'q' || key === '\u0003') return { type: 'quit' }
  const q: ServedQuestion | null = s.view.question
  if (!q) return { type: 'none' }
  if (key === '0') return { type: 'skip' }
  const n = Number(key)
  if (Number.isInteger(n) && n >= 1 && n <= q.options.length) return { type: 'answer', optionIndex: n - 1 }
  return { type: 'none' }
}
