/**
 * The status-line legibility sweep, shared by every test that holds shipped question content to the
 * rendered line: this package's `content-legibility.test.ts` for the profile and launch content, and
 * `packages/server`'s for the attention pool, which lives there so its answers are not published
 * (R905). The reasoning for sweeping rather than sampling is in `content-legibility.test.ts`.
 *
 * Test support, not runtime code: nothing in the daemon or server imports it.
 */
import { COLS_MIN, SPONSOR_STATUS_MAX, STATUS_LINE_SAFETY_MARGIN, formatStatusLine } from './statusline.js'
import { truncateToWidth } from './sanitize.js'
import type { ServedQuestion } from './question.js'

// The full range the daemon can hand `formatStatusLine`: `resolveColumns` clamps to
// [COLS_MIN, COLS_MAX] and then subtracts the margin, so this is the lowest budget reachable.
export const MIN_BUDGET = COLS_MIN - STATUS_LINE_SAFETY_MARGIN
// Past this every item fits with room to spare; the spike's widest captured terminal was 189.
export const MAX_BUDGET = 200

export const render = (q: { text: string; options: readonly string[] }, sponsor: string, cols: number, paid: boolean): string =>
  formatStatusLine({
    loggedIn: true,
    question: {
      assignment_id: '00000000-0000-0000-0000-000000000001', kind: paid ? 'choice' : 'profile',
      text: q.text, options: [...q.options], context: null,
      sponsor, price_cents: paid ? 50 : 0,
      served_at: '2026-09-08T00:00:00.000Z', expires_at: '2026-09-08T00:05:00.000Z',
    } satisfies ServedQuestion,
    answered: null, todayPaid: 0, pendingCents: 0, availableCents: 0, maxColumns: cols,
  })

/** The line the daemon shows when there is no question at all, at this width. */
export const idleAt = (cols: number): string =>
  formatStatusLine({ loggedIn: true, question: null, answered: null, todayPaid: 0, pendingCents: 0, availableCents: 0, maxColumns: cols })

/**
 * A question was shown iff the composed line differs from the idle line at the same width.
 *
 * Compared rather than pattern-matched, because `formatStatusLine` truncates the *whole* line to
 * the budget as its last act: below about 20 columns even the idle line comes back as
 * `tickover · t…`, and a regex looking for "today N/M" reads that as a question and reports a
 * fragment band that is really the idle line being narrow. Asking "is the text absent" is the
 * other wrong way round -- it would call a truncated question a suppressed one, which is the
 * exact case being hunted here.
 */
export const showsAQuestion = (line: string, cols: number) => line !== idleAt(cols) && !waitingAt(cols).includes(line)

/**
 * What stands in for a question too narrow to disclose: "a question is waiting", with no sponsor
 * and no question in it. It replaced the idle line there (2026-09-29), so it counts as not shown.
 */
export const waitingAt = (cols: number): string[] =>
  ['tickover · question waiting · answer: tickover pane', 'tickover · question waiting'].map((w) => truncateToWidth(w, cols))

/**
 * The options exactly as the composer lays them out: `1 Yes  2 No  3 Maybe`.
 *
 * Asserted as this one contiguous run rather than option by option, because a bare
 * `line.includes('No')` is satisfied by the *question* "Pick 'No'." -- that option's check could
 * never fail while the text was present. Smallest element that carries the claim (R99, plan 2),
 * and it is also what actually distinguishes a whole option list from a squeezed one.
 */
export const optionRun = (options: readonly string[]) => options.map((o, i) => `${i + 1} ${o}`).join('  ')

/** Every budget at which a question is composed but not composed whole. */
export function fragmentBand(q: { text: string; options: readonly string[] }, sponsor: string, paid: boolean): number[] {
  const band: number[] = []
  for (let cols = MIN_BUDGET; cols <= MAX_BUDGET; cols++) {
    const line = render(q, sponsor, cols, paid)
    if (!showsAQuestion(line, cols)) continue
    const whole = line.includes(q.text) && line.includes(optionRun(q.options))
    if (!whole) band.push(cols)
  }
  return band
}

// Every sponsor a buyer can produce, as seen by the composer: it caps display at
// SPONSOR_STATUS_MAX, so widths past that are indistinguishable from it.
export const SPONSOR_WIDTHS = Array.from({ length: SPONSOR_STATUS_MAX - 1 }, (_, i) => i + 2)
