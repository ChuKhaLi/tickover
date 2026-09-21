/**
 * Spec §4.5's attention checks, as data. Copy under test rather than a schema, the same
 * way `disclosure.ts` holds the consent wording -- the server seeds these and the daemon's
 * status-line test renders them, so one list serves both instead of two copies drifting.
 *
 * Four rules shape every item here, and the first two were measured rather than assumed.
 *
 * 1. **Whole or not shown, at every width -- which is a property, not a length.** Three drafts got
 *    this wrong in three different ways (R101, R110, R111): written to the 120-character schema
 *    limit they composed as "Please select…"; rewritten to 80 columns they still truncated on every
 *    default terminal, because the daemon composes through `resolveColumns`, which subtracts
 *    `STATUS_LINE_SAFETY_MARGIN`; rewritten to that default of 74 they still fragmented on the
 *    71- and 40-column budgets the width spike actually captured.
 *    The property that holds at every width: the composer must never produce a line that shows the
 *    question *partly*. It has a rung that keeps options whole and squeezes the text, and a rung
 *    below it that shows `press 1-N in the pane` with no options at all -- so the safe zone exists
 *    only when the first becomes reachable before the second, which for three options means
 *    `displayWidth(text) <= TEXT_MIN` and `sum(options) <= 13`. These five are written to that.
 *    `content-legibility.test.ts` sweeps the real composer per item across every sponsor width and
 *    every reachable budget rather than trusting that arithmetic -- a character rule that fit
 *    eleven hand-picked samples still left a band on 125 of 400 random conforming items.
 * 2. **Never answerable by position.** Every correct answer at index 1 would mean a developer
 *    who always presses 2 passes every check. The drafted five had exactly that shape.
 * 3. **No knowledge component.** The developer terms promise these catch "answering without
 *    reading", and getting two wrong withholds the developer's whole balance. A check that a
 *    competent developer could fail by not knowing something would take real money for the
 *    wrong reason, so these test reading and nothing else.
 * 4. **Never labelled.** The terms say "never labelled as such", so no item announces itself
 *    as a check. They ride inside a paid study and display that study's sponsor and price.
 */
import type { SystemStudyInput } from './admin-api.js'

export interface AttentionQuestion {
  readonly text: string
  readonly options: readonly string[]
  readonly correctOption: number
}

export const ATTENTION_STUDY_TITLE = 'Attention checks'

export const ATTENTION_POOL: readonly AttentionQuestion[] = [
  { text: "Pick 'No'.", options: ['Yes', 'No', 'Maybe'], correctOption: 1 },
  { text: 'Largest?', options: ['Nine', 'Two', 'Six'], correctOption: 0 },
  { text: 'An animal?', options: ['Axe', 'Cup', 'Owl'], correctOption: 2 },
  { text: 'A colour?', options: ['Red', 'Desk', 'Cup'], correctOption: 0 },
  { text: 'A weekday?', options: ['Blue', 'Cup', 'Tue'], correctOption: 2 },
]

export function attentionStudyInput(): SystemStudyInput {
  return {
    kind: 'attention',
    title: ATTENTION_STUDY_TITLE,
    questions: ATTENTION_POOL.map((q) => ({ text: q.text, options: [...q.options], correct_option: q.correctOption })),
  }
}
