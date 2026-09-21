import { describe, it, expect } from 'vitest'
import {
  ATTENTION_POOL,
  COLS_MIN,
  LAUNCH_STUDY_QUESTIONS,
  PROFILE_QUESTIONS,
  SPONSOR_STATUS_MAX,
  STATUS_LINE_SAFETY_MARGIN,
  formatStatusLine,
  resolveColumns,
  type ServedQuestion,
} from '../src/index.js'

/**
 * The shipped question content, held to the rendered status line across every width and sponsor the
 * daemon can compose at -- not at one width, and not to a character count. Both of those were tried
 * on this branch and both shipped content that truncated in production (R110, R111).
 *
 * **Not one width.** `daemon.ts` is the only production caller of `formatStatusLine` and always
 * passes `resolveColumns(...)`, which subtracts `STATUS_LINE_SAFETY_MARGIN`, so 80 is not the
 * default -- 74 is, for an *undetected* width. And 74 is not a floor either: the width spike
 * captured budgets of 71 and 40 in one session on this machine. A test pinned to any single number
 * samples the width its content happens to pass at.
 *
 * **Not a character count.** A rule of "text <= TEXT_MIN, options <= OPTION_MIN" fits every sample
 * anyone picks by hand and is still wrong: rung 4 composes `press 1-N in the pane` with no options
 * at all, in a band *above* where rung 1 fails, so a short question with four short options still
 * fragments. Only the composer knows where its own rungs engage.
 *
 * **So: the property, swept.** For each item, at each sponsor width and each budget, either the
 * composer declines to show the question at all, or it shows the whole thing. The fragment band --
 * budgets where a question renders with its text cut or its options stubbed -- must be empty.
 */
describe('the shipped question content, at every width the composer can produce', () => {
  // The full range the daemon can hand `formatStatusLine`: `resolveColumns` clamps to
  // [COLS_MIN, COLS_MAX] and then subtracts the margin, so this is the lowest budget reachable.
  const MIN_BUDGET = COLS_MIN - STATUS_LINE_SAFETY_MARGIN
  // Past this every item fits with room to spare; the spike's widest captured terminal was 189.
  const MAX_BUDGET = 200

  const render = (q: { text: string; options: readonly string[] }, sponsor: string, cols: number, paid: boolean): string =>
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
  const idleAt = (cols: number): string =>
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
  const showsAQuestion = (line: string, cols: number) => line !== idleAt(cols)

  /**
   * The options exactly as the composer lays them out: `1 Yes  2 No  3 Maybe`.
   *
   * Asserted as this one contiguous run rather than option by option, because a bare
   * `line.includes('No')` is satisfied by the *question* "Pick 'No'." -- that option's check could
   * never fail while the text was present. Smallest element that carries the claim (R99, plan 2),
   * and it is also what actually distinguishes a whole option list from a squeezed one.
   */
  const optionRun = (options: readonly string[]) => options.map((o, i) => `${i + 1} ${o}`).join('  ')

  /** Every budget at which a question is composed but not composed whole. */
  function fragmentBand(q: { text: string; options: readonly string[] }, sponsor: string, paid: boolean): number[] {
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
  const SPONSOR_WIDTHS = Array.from({ length: SPONSOR_STATUS_MAX - 1 }, (_, i) => i + 2)

  /**
   * The guarantee for attention checks: whole, or not shown. An attention check is the one question
   * with a wrong answer, so it is the one worth the sharper rule -- not because the status line can
   * be answered from (it cannot: `pane-view.ts` renders the full text and reads the keystroke), but
   * because a half-read instruction is the only kind of display failure that could change what
   * somebody chooses once they do open the pane.
   */
  it('never shows an attention check in fragments, at any width or sponsor', () => {
    for (const q of ATTENTION_POOL) {
      for (const width of SPONSOR_WIDTHS) {
        const band = fragmentBand(q, 'x'.repeat(width), true)
        expect(band, `"${q.text}" fragments at sponsor width ${width}, budgets ${band.join(',')}`).toEqual([])
      }
    }
  })

  /**
   * Profile questions get the weaker half of the rule -- their *text* may be cut, since they have no
   * wrong answer -- but never a stubbed or missing option, at any width. Every option is published
   * on /data as a percentage, so one the developer could not read is a number whose label nobody
   * saw.
   *
   * An earlier version of this test asked for that only from the default budget upward, on the
   * reasoning that the stronger form was unachievable: an empty band needs the text within
   * `TEXT_MIN`, and these are printed on /data as headings that have to read as questions. That
   * reasoning was wrong, and the review caught it. The text length does not enter into the weak
   * property at all -- an option is cut only when rung 3 or rung 4 composes before rung 2, which
   * depends on the *options* alone: rung 2 needs `1 + options_rendered`, rung 4 needs `3 + hint`,
   * so the band is empty whenever `sum(options) <= 13` for three options, whatever the question
   * says. Two of the five were one column over, at exactly 14. They are not any more, and the
   * assertion is back to every width.
   */
  it('never shows a profile question with an option cut, at any width', () => {
    for (const q of PROFILE_QUESTIONS) {
      for (let cols = MIN_BUDGET; cols <= MAX_BUDGET; cols++) {
        const line = render(q, 'Tickover', cols, false)
        if (!showsAQuestion(line, cols)) continue
        expect(line, `"${q.text}" has an option cut at budget ${cols}`).toContain(optionRun(q.options))
      }
    }
  })

  /**
   * The day-one at-cost study, under the same weak rule as the profile questions rather than the
   * pool's strong one. The line between them is whether a *wrong answer exists*: an attention check
   * has one, so a half-read instruction can change what somebody picks; a day-one question asks an
   * opinion, where a cut question means a worse answer and never a penalised one. Holding it to the
   * strong rule would force its text within TEXT_MIN and make "What makes you try a new dev tool?"
   * into something nobody could act on.
   *
   * It was the one content file the sweep did not reach, and it failed the moment it was pointed
   * here: `A friend`/`Numbers`/`Slowness` cut an option across thirty budgets including the default,
   * rendering as `1 A frie…  2 A demo  3 Numbers`. That matters more here than anywhere else --
   * this is the study Tickover pays $82.50 for, and the first paid question most developers see.
   */
  it('never shows a day-one study question with an option cut, at any width', () => {
    for (const q of LAUNCH_STUDY_QUESTIONS) {
      for (let cols = MIN_BUDGET; cols <= MAX_BUDGET; cols++) {
        const line = render(q, 'Tickover', cols, true)
        if (!showsAQuestion(line, cols)) continue
        expect(line, `"${q.text}" has an option cut at budget ${cols}`).toContain(optionRun(q.options))
      }
    }
  })

  /**
   * The negative control, and the reason it is here: `fragmentBand` carries the whole claim of this
   * file, and replacing its body with `return []` left all of these green. Mutating the *content*
   * does turn them red, so the file works -- but nothing proved the helper can detect anything, and
   * a test that cannot fail is the defect this repo has shipped fifteen times.
   *
   * The subject is an item known to band: "Pick the day." is 13 columns, one over `TEXT_MIN`, which
   * is exactly one budget's worth of fragment (R111's `band == displayWidth(text) - TEXT_MIN`).
   */
  it('detects a fragment band when one exists', () => {
    const banded = fragmentBand({ text: 'Pick the day.', options: ['Blue', 'Cup', 'Tue'] }, 'x'.repeat(SPONSOR_STATUS_MAX), true)
    expect(banded, 'fragmentBand reported no band for an item measured to have one').not.toEqual([])
  })

  // The passing direction, and the one that keeps the sweep honest: a sweep that never composed
  // anything would satisfy both tests above vacuously. This asserts each item really is shown at
  // the width an undetected terminal produces -- the case the whole pool exists to serve.
  it('does show every item at the default budget, so the sweep is not vacuous', () => {
    const budget = resolveColumns({})
    for (const q of ATTENTION_POOL) {
      expect(showsAQuestion(render(q, 'x'.repeat(SPONSOR_STATUS_MAX), budget, true), budget), `"${q.text}" is never shown at budget ${budget}`).toBe(true)
    }
    for (const q of PROFILE_QUESTIONS) {
      expect(showsAQuestion(render(q, 'Tickover', budget, false), budget), `"${q.text}" is never shown at budget ${budget}`).toBe(true)
    }
  })
})
