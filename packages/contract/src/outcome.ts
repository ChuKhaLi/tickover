/**
 * How every surface turns an answer outcome into something a developer can read.
 *
 * The reason set here is the union of the wire reasons (`AnswerReason`: ok, duplicate, late,
 * not_found, already_resolved, invalid_option) and the ones the daemon adds locally -- `queued`
 * when an answer is accepted but not yet delivered, `failed` on the HTTP reply to the client that
 * submitted, and `rejected`/`abandoned` on the SSE event that tells every other surface. Those
 * live outside the wire schema on purpose (they are not things the server ever says), but the
 * DISPLAY decision has to cover all of them in one place, because the status line, the terminal
 * pane, the localhost page and the VS Code status bar must not disagree about whether a developer
 * was just paid.
 *
 * Both functions are self-contained (no module-scope references, no imports): `page.ts` embeds
 * their compiled source into the served page via `.toString()`, so the browser must be able to run
 * them standalone.
 */
export interface AnswerOutcomeLike {
  accepted: boolean
  reason: string
  earned_cents: number
}

/**
 * Whether this outcome is money the developer just earned, and therefore whether to show the
 * `✓ +$0.50` confirmation.
 *
 * The distinction that matters is `duplicate`: the server returns it as **accepted: true** with
 * `earned_cents: 0` (see the server's `domain/answer.ts`), which every surface used to render as
 * `✓ +$0.00` -- a checkmark and a zero, which reads as being paid nothing rather than as "this was
 * already counted, and you were already paid for it" (whole-branch review I6). `queued` is the
 * mirror case: not yet delivered, but genuinely owed, so it does show the confirmation.
 */
export function isEarning(o: AnswerOutcomeLike): boolean {
  return o.accepted && (o.reason === 'ok' || o.reason === 'queued')
}

/**
 * A sentence explaining an outcome that is not an earning, or null when there is nothing to
 * explain. Replaces the bare `'Not accepted: ' + reason` the surfaces used to print, which left a
 * developer reading a protocol token.
 */
export function answerNotice(o: AnswerOutcomeLike): string | null {
  switch (o.reason) {
    case 'ok': return null
    case 'queued': return null
    case 'duplicate': return 'Already counted - this answer had reached the server before.'
    case 'late': return 'Too late - the question had expired, so this answer was not paid.'
    case 'failed': return 'Could not be delivered - nothing was paid.'
    case 'rejected': return 'The server refused this answer - nothing was paid.'
    case 'abandoned': return 'Gave up after repeated delivery failures - nothing was paid.'
    case 'not_found': return 'The server no longer has this question.'
    case 'already_resolved': return 'This question had already been answered or skipped.'
    case 'invalid_option': return 'That is not one of the offered choices.'
    case 'not_current': return 'That question is no longer the current one.'
    default: return o.accepted ? null : `Not accepted: ${o.reason}`
  }
}
