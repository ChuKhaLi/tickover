import { RULES, money, sanitizeText, truncateToWidth } from '@tickover/contract'
import type { QuestionView, ServedQuestionLike } from './daemon-client.js'

const ICON = '$(comment-discussion) '

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
    return { text: ICON + truncateToWidth(label, 60), tooltip: 'Click to answer', command: 'tickover.answer' }
  }
  if (answered) return { text: `$(check) +${money(answered.earnedCents)} · ${tail}`, tooltip, command: undefined }
  return { text: ICON + tail, tooltip, command: undefined }
}

export function quickPickItems(q: ServedQuestionLike): Array<{ label: string; description: string; index: number }> {
  const items = q.options.map((o, i) => ({ label: `${i + 1}  ${sanitizeText(o, RULES.OPTION_TEXT_MAX)}`, description: '', index: i }))
  items.push({ label: '0  Skip', description: 'costs nothing', index: -1 })
  return items
}
