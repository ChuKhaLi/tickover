/**
 * What `tickover status` prints: /v1/health and /v1/question merged under the port.
 *
 * /v1/question repeats health's `loggedIn` as `logged_in`, and merging both printed the same fact
 * twice under two spellings. `loggedIn` is the one kept, because the setup skill tells the model to
 * confirm `loggedIn: true`.
 *
 * The question itself is reduced to `has_question` (R900). The setup and uninstall skills run this
 * command inside a Claude turn, so its output is read by the model, and every string in a served
 * question -- sponsor, text, options, context -- was written by a buyer. Printing them made
 * operator review the only thing between a buyer and the developer's agent.
 */
/** The /v1/question fields `status` may print: all daemon-owned numbers and timestamps. */
const PRINTABLE = ['shown_at', 'balance_pending_cents', 'balance_available_cents', 'today_paid_answers'] as const

export function statusReport(port: number, health: Record<string, unknown>, question: Record<string, unknown>): Record<string, unknown> {
  // An allowlist, not a removal: a field added to /v1/question later stays out until it is listed
  // here (whole-branch review M6).
  const listed = Object.fromEntries(PRINTABLE.filter((k) => k in question).map((k) => [k, question[k]]))
  return { port, ...health, has_question: question.question !== null && question.question !== undefined, ...listed }
}
