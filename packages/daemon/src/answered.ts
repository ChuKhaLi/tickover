/**
 * Decides what a display surface's `✓ +$0.50` confirmation should be after one SSE view frame.
 *
 * The daemon owns the 10-second answered TTL (`ANSWERED_TTL_MS`) and signals its expiry the only
 * way it can: `QuestionLoop.tick()` clears `answered` and broadcasts a `question` frame whose
 * `question` is null. Both the pane and the localhost page used to clear their confirmation only
 * on a frame that CARRIED a question, so that signal did nothing and the checkmark stayed put
 * until the next question -- five minutes at the very best, routinely hours (whole-branch review
 * I5). A developer glancing at either surface could not tell a stale confirmation from a fresh
 * payment.
 *
 * The `status`/`question` asymmetry below is deliberate and load-bearing in the other direction:
 * `status` frames are hook traffic (`daemon.ts`'s `handlers.hook` emits one on every SessionStart,
 * UserPromptSubmit, Stop and SessionEnd), so clearing on those would wipe the checkmark seconds
 * after it appeared -- the same defect with the sign flipped. A `status` frame is only ever
 * allowed to clear the confirmation by carrying a new question, which genuinely retires it.
 *
 * Deliberately self-contained (no reference to any module-scope name, no imports): `page.ts`
 * embeds this function's own compiled source into the served page via `.toString()`, so the
 * browser runs byte-identical code to what the unit tests exercise -- and `pane.ts` calls this
 * very function, so the two surfaces cannot drift apart on the rule.
 */
export function answeredAfterFrame<T>(previous: T | null, event: string, view: { question: unknown } | null): T | null {
  if (event === 'question') return null
  if (view && view.question) return null
  return previous
}
