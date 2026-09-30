/**
 * The day-one paid study — spec §4.6's "at-cost first studies from early buyers are loaded before
 * launch so paid questions exist on day one", with Tickover standing in for the buyer.
 *
 * **Why Tickover is the sponsor (R104).** There are no buyers yet, and §4.7 displays the sponsor
 * name with every paid question. Seeding a study for a buyer who does not exist would put a
 * fabricated organisation in front of every developer on the panel, in a product whose stated
 * trust position is that the plugin is open source. So the questions are ones Tickover genuinely
 * wants answered, under Tickover's own name, funded by Tickover.
 *
 * **What that costs.** At-cost pricing is `developerCents + AT_COST_FEE_CENTS` = 56c per answer, of
 * which 50c reaches the developer. Three questions at the 50-respondent minimum is a hold of
 * **8,400 cents ($84.00)**, $75 of it paid out. `seedLaunch` will not create this study unless the
 * caller passes the funding explicitly — money never moves as a side effect of seeding content.
 *
 * **The consequence to remember:** an at-cost study never carries an attention check
 * (`serveAssignment` excludes it, and the developer terms promise "never in a study a buyer is
 * running at cost"). A launch feed made only of this study therefore leaves the attention pool
 * correctly unused; the quality mechanism starts with the first full-price study.
 */
import type { StudyInput } from './buyer-api.js'
import { PRICING } from './constants.js'

export const LAUNCH_STUDY_TITLE = 'Tickover day one'

/**
 * Three questions whose options sum to 13 columns or fewer, which is what keeps the status line from
 * cutting one (see `profile-questions.ts` and R111). The first draft here was the one content file
 * the swept legibility test did not cover, and it failed that test the moment it was pointed at it:
 * `A friend`/`Numbers`/`Slowness`/`Privacy`/`Sometimes` fragmented across thirty budgets including
 * the default, rendering as `1 A frie…  2 A demo  3 Numbers`. It is now swept alongside the other
 * two, which matters more here than anywhere: this is the study Tickover is paying $84.00 for and
 * the first paid question most developers will ever see.
 *
 * They ask about the panel's own behaviour rather than about Claude Code or Anthropic, which §4.7
 * rejects outright.
 */
export const LAUNCH_STUDY_QUESTIONS = [
  { text: 'What makes you try a new dev tool?', options: ['Word', 'Demo', 'Data'] },
  { text: 'What would make you remove one?', options: ['Noise', 'Lag', 'Trust'] },
  { text: 'How often do you read your status line?', options: ['Often', 'Some', 'Rare'] },
] as const

export function launchStudyInput(): StudyInput {
  return {
    title: LAUNCH_STUDY_TITLE,
    sponsor: 'Tickover',
    questions: LAUNCH_STUDY_QUESTIONS.map((q) => ({ text: q.text, options: [...q.options] })),
    target_count: PRICING.MIN_RESPONDENTS,
  }
}
