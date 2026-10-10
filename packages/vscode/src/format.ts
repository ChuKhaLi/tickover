import { RULES, money, sanitizeText, truncateToWidth } from '@tickover/contract'
import type { QuestionView, ServedQuestionLike } from './daemon-client.js'

const ICON = '$(comment-discussion) '

/**
 * VS Code draws `$(name)` as an icon in status bar text, QuickPick labels and the QuickPick title,
 * so buyer text containing `$(check) +$5.00` drew the extension's own "you were paid" mark (audit
 * C5, R919). VS Code's escape is a backslash before the `$` -- its renderer reads `\$(name)` as
 * literal text. Every `$(` is escaped, not only ones naming a real icon, so a new icon name in a
 * later VS Code cannot reopen it; a buyer's own `\$(` gains a second backslash, which the renderer
 * still reads as the escaped form. Applied to buyer fields only, never to the extension's ICON.
 */
export function escapeCodicons(s: string): string {
  return s.replace(/\$\(/g, '\\$(')
}

export function statusBarText(view: QuestionView | null, connected: boolean, answered: { earnedCents: number } | null): { text: string; tooltip: string; command: string | undefined } {
  if (!connected || !view) return { text: `${ICON}tickover: daemon off`, tooltip: 'Run: tickover daemon', command: undefined }
  if (!view.logged_in) return { text: `${ICON}tickover: run tickover login`, tooltip: 'Run: tickover login', command: undefined }
  const tail = `tickover ${view.today_paid_answers}/${RULES.MAX_PAID_PER_DAY} · ${money(view.balance_pending_cents + view.balance_available_cents)}`
  const tooltip = `today ${view.today_paid_answers}/${RULES.MAX_PAID_PER_DAY} · balance ${money(view.balance_pending_cents + view.balance_available_cents)}`
  if (view.question) {
    const q = view.question
    // Sanitize each server-controlled field on its own, before it's woven into a formatted
    // line -- running sanitizeText over the composed string would eat the layout separators
    // along with anything actually worth stripping.
    const label = q.kind === 'profile' ? `unpaid · ${sanitizeText(q.text, RULES.QUESTION_TEXT_MAX)}` : `${sanitizeText(q.sponsor, 30)} · ${money(q.price_cents)} · ${sanitizeText(q.text, RULES.QUESTION_TEXT_MAX)}`
    // Escaped after the cut: the budget is measured on what is drawn, and a `$(` cut short of its
    // `)` is no icon anyway. Nothing of ours inside the label is an icon.
    return { text: ICON + escapeCodicons(truncateToWidth(label, 60)), tooltip: 'Click to answer', command: 'tickover.answer' }
  }
  if (answered) return { text: `$(check) +${money(answered.earnedCents)} · ${tail}`, tooltip, command: undefined }
  return { text: ICON + tail, tooltip, command: undefined }
}

export function quickPickItems(q: ServedQuestionLike): Array<{ label: string; description: string; index: number }> {
  const items = q.options.map((o, i) => ({ label: `${i + 1}  ${escapeCodicons(sanitizeText(o, RULES.OPTION_TEXT_MAX))}`, description: '', index: i }))
  items.push({ label: '0  Skip', description: 'costs nothing', index: -1 })
  return items
}

/** The QuickPick title. The sponsor is buyer text like any other field; it used to go in raw. */
export function quickPickTitle(q: ServedQuestionLike): string {
  return q.kind === 'profile' ? 'Tickover panel profile · unpaid' : `${escapeCodicons(sanitizeText(q.sponsor, 30))} asks · ${money(q.price_cents)}`
}

/** The QuickPick placeholder: sanitised, not escaped. It is an input's placeholder attribute,
 * which draws no icons, so an escape would show as a stray backslash. */
export function quickPickPlaceholder(q: ServedQuestionLike): string {
  return sanitizeText(q.text, RULES.QUESTION_TEXT_MAX)
}
