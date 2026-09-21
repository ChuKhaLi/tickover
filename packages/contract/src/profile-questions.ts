/**
 * Spec §4.6's panel-profile questions, and spec §7 Phase 1's "five profile questions written".
 *
 * These are the entire content of the public `/data` page: `GET /api/public/aggregates` selects
 * questions joined to studies on `kind = 'profile'` and nothing else, so a repository with no
 * profile questions publishes an empty page — and §4.6 calls that page "the buyer-acquisition
 * content". They are also the cold-start feed: unpaid, one per developer per day, which is what
 * keeps a status line alive on a panel with no paid studies yet.
 *
 * Three rules, the first measured the way the attention pool's were (R101, corrected by R110):
 *
 * 1. **Three options, short enough that the status line never cuts one — at any width.** A profile
 *    question carries §4.6's label, `tickover · unpaid · panel profile · `, which is *longer* than
 *    a paid question's sponsor and payout. What decides whether an option survives is the options
 *    alone, not the question: the composer has a rung that keeps every option whole and squeezes
 *    only the text, and rungs below it that stub the options or replace them with `press 1-N in
 *    the pane`, and the first is reachable before the others exactly when `sum(options) <= 13` for
 *    three options. The question's own length does not enter into it, which is what makes a
 *    readable heading on /data affordable here (R111).
 *    Two of the five first shipped at exactly 14 and cut an option; they were measured at 80
 *    columns, a width the daemon never composes at (R110).
 *    The *text* may truncate here, and that is the deliberate difference from an attention check:
 *    there is no correct answer to miss. (Nor is there one on the status line for an attention
 *    check either — no question is answerable from it, since `pane-view.ts` is where the keystroke
 *    is read. The difference is that a wrong answer exists at all, which makes the sharper rule
 *    worth its cost there.) See **R108** and **R110**.
 * 2. **Coarse buckets are the price of that.** Three categories cannot cover any of these
 *    dimensions finely. It is a normal survey trade-off, and it makes a cleaner bar chart on
 *    /data; a dimension needing more granularity earns its own question later rather than a wider
 *    one now.
 * 3. **Nothing the daemon already reports.** Primary language, country, activity tier and
 *    operating system are computed client-side and are already targeting dimensions (`Segment`),
 *    so asking for one would spend the single question a developer sees in a day re-collecting
 *    data the panel already holds.
 */
import type { SystemStudyInput } from './admin-api.js'

export interface ProfileQuestion {
  readonly text: string
  readonly options: readonly string[]
}

export const PROFILE_STUDY_TITLE = 'Panel profile'

export const PROFILE_QUESTIONS: readonly ProfileQuestion[] = [
  // Numeric options rather than "Under 3 years": the units live in the question, which /data
  // prints above the bars, and spelled-out ranges cost the columns the options need to stay whole.
  { text: 'Years coding professionally?', options: ['0-3', '4-9', '10+'] },
  { text: 'How much of your code does AI write now?', options: ['Some', 'Half', 'Most'] },
  { text: 'What kind of place do you write code for?', options: ['Small', 'Big', 'Solo'] },
  { text: 'What do you spend most time building?', options: ['Web', 'Server', 'Data'] },
  { text: 'How do you choose which model to use?', options: ['Habit', 'Cost', 'Task'] },
]

export function profileStudyInput(): SystemStudyInput {
  return {
    kind: 'profile',
    title: PROFILE_STUDY_TITLE,
    questions: PROFILE_QUESTIONS.map((q) => ({ text: q.text, options: [...q.options] })),
  }
}
