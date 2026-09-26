import { Component, DestroyRef, ElementRef, afterNextRender, inject, signal } from '@angular/core'
import { HERO_STUDY } from '../lib/hero-study'
import { RouterLink } from '@angular/router'
import { PRICING, RULES, quoteStudy } from '@tickover/contract'
import { Button, Link } from '../ui/button'
import { Range } from '../ui/input'
import { Money } from '../ui/money'
import { Pane } from '../ui/pane'
import { Figure, Rows } from '../ui/rows'
import { Shell } from '../ui/shell'

/**
 * The hero is the product, literally: one row of mono text in a terminal, at a real
 * column budget, composed by the same function the client calls. The headline exists
 * to point at it.
 *
 * **And it is shown inside the terminal, which is R318 and was the one part of the
 * design this page had not built.** What shipped first was the row on its own: a dark
 * strip under the headline, which reads as a styled code block and says nothing about
 * where that row appears. A status line sits at the bottom of a running terminal, so a
 * strip on its own explains the product to someone who already understood it and to
 * nobody else. The session above the row -- the directory, the agent's settled output,
 * the prompt that was typed -- is the context that makes the row legible, and it is
 * projected into the pane rather than drawn beside it so that there is still exactly
 * one dark object on the page and one character width shared by everything in it.
 *
 * Behind the band, the lattice: the character cell drawn rather than described
 * (styles.css, .mw-lattice). It needs a band that reaches both page edges, which is
 * why mw-shell grew a second slot.
 *
 * Two traps in this file's own prose, both already paid for: a backtick ends the
 * template literal the template is written in, and an English word that happens to be
 * a Tailwind class name mints a rule into the shipped CSS (R47).
 *
 * **The sequence draws three states, not the four the screen design lists.**
 * Beat 3 there is "a keypress lands, the chosen option is marked" -- and the status
 * line does not render that. It goes from the question straight to the credited
 * state. Drawing a marked option here would be inventing a frame the client never
 * prints, on the page whose entire claim is that this is what the client prints, so
 * the beat is dropped rather than faked (R336 is the same decision about `rung`).
 * What remains is: idle, question, credited, idle-with-the-counters-moved -- which is
 * still four frames and still ends where it began, with the numbers changed.
 *
 * **The screen design's phone rule is not implemented, and it is wrong.** It says the
 * pane should default to a narrow budget on a phone, "being shown what their own
 * terminal will render". A phone visitor's terminal is not 38 columns -- their
 * *browser* is. Claude Code runs in a desktop terminal whatever device someone reads
 * this page on, so defaulting a phone to 38 would show them a line their own machine
 * would never print, which is the one thing this hero must not do. Design system 6.1
 * already says what to do instead: the replica keeps its budget and scrolls inside
 * its own frame, and the page never scrolls sideways.
 */
const BEATS = [0, 1600, 3600, 5400] as const

/**
 * `null` when the environment cannot answer -- `matchMedia` is absent from the
 * unit-test DOM, and a hero that threw on that would take the whole page down with
 * it. It is not only defensiveness: the reduced-motion question below treats an
 * unanswerable environment as a *yes*, because autonomous motion needs consent and
 * "we could not ask" is not consent.
 */
function media(query: string): boolean | null {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return null
  return window.matchMedia(query).matches
}

/** The width the prerendered control holds, or 80 when there is none to read (R413). */
function seedCols(host: HTMLElement): number {
  const n = Number(host.querySelector<HTMLInputElement>('[data-cols]')?.value)
  return Number.isFinite(n) && n > 0 ? n : 80
}

@Component({
  imports: [Shell, RouterLink, Pane, Button, Link, Money, Range, Rows, Figure],
  template: `
    <mw-shell [links]="[{ href: '/data', label: 'Data' }, { href: '/buyers', label: 'For buyers' }, { href: '/app/login', label: 'Buyer sign in' }]">
      <div slot="band" data-band class="mw-lattice border-b border-ink-200 dark:border-ink-800">
        <div class="mx-auto w-full max-w-content px-4 py-12">
          <h1 class="max-w-[68ch] text-display text-ink-900 dark:text-ink-50">This line is the product.</h1>

          <div class="mt-8">
            <mw-pane
              [cols]="cols()"
              [sponsor]="sponsor"
              [payoutCents]="developerPayCents"
              [question]="beat() === 1 ? question : ''"
              [options]="options"
              [answeredCents]="beat() === 2 ? developerPayCents : null"
              [todayPaid]="beat() >= 2 ? 4 : 3"
              [pendingCents]="beat() >= 2 ? 300 : 250"
              [availableCents]="1000"
              [scene]="scene"
            >
              <!-- What was on the screen before the bottom row, which is the whole of
                   R318. The session is not animated and does not need to be: the one
                   orchestrated moment belongs to the row below it, and a second thing
                   moving would take attention from the only thing here that is the
                   product. Every shade is measured on ink-950 in section 3: settled
                   output and the directory label at ink-400 (7.71), the typed prompt
                   at white (19.87), the working marker and the caret at signal-400
                   (8.06). No backtick in this comment: one ends the template literal
                   the template is written in, which this file has paid for twice. -->
              <div data-session class="text-ink-400">
                <p>~/projects/acme</p>
                <p class="mt-3">&#9679; Read src/auth/session.ts (142 lines)</p>
                <p>&#9679; Updated src/auth/tokens.ts</p>
                <p><span class="text-signal-400">&#10033;</span> Reworking the refresh flow&#8230; (14s)</p>
              </div>
              <!-- The prompt the developer typed, in the shape the client draws it.
                   Its edge is ink-800 on ink-950 at 1.36 -- decoration, judged at the
                   1.0 bar and not the 3.0 one, because nothing in here is operable:
                   the pane is one role=img and this is a picture of a control, not a
                   control. -->
              <div class="mt-3 mb-2 rounded-control border border-ink-800 px-2 py-1">
                <span class="text-signal-400">&gt;&#160;</span><span class="text-white">refactor the auth module to use the new token flow</span><span class="text-signal-400">&#9608;</span>
              </div>
            </mw-pane>
            <!-- A native range, so the keyboard, the screen reader and the touch target
                 are the platform's. It is the most persuasive control on the page: it
                 shows the line stepping down through the real rungs as the budget
                 narrows, which no screenshot can claim. -->
            <p class="mt-3 flex flex-wrap items-center gap-3 text-small text-ink-600 dark:text-ink-400">
              <label for="cols">Terminal width</label>
              <input
                id="cols"
                data-cols
                type="range"
                mw-range
                [min]="minCols"
                [max]="maxCols"
                [value]="cols()"
                (input)="setCols($any($event.target).value)"
                class="w-56"
              />
              <span class="tabular-nums">{{ cols() }} columns</span>
            </p>
          </div>

          <p class="mt-6 max-w-[68ch] text-lead text-ink-800 dark:text-ink-100">A developer waits five to sixty seconds for their coding agent. Tickover puts one paid question in the status line, they answer it with a single key, and they keep half of what you paid.</p>
        </div>
      </div>

      <!-- Two paths, deliberately not two matching cards. Installing is a sequence, so
           numbering it carries information; a price list is a set of rows, so it is
           rows. Identical cards for content that is not identical is the kit default,
           and it throws away the one structural signal available here. -->
      <!-- Neither column is reachable at 375x667 without a scroll (measured: this row's own
           wrapper starts at 686px against a 667px frame), which is exactly the shape task 9
           went looking for -- and exactly the shape it had to give back. A hydrate-on-viewport
           block around either one drops its heading from the served bytes entirely: the
           framework's own internal flag for "this pass is a server render" never reads true
           for these two blocks in this toolchain (R410), the same gap R407 found in
           afterNextRender's own guard, but this time inside compiled framework output this
           page cannot add a guard to. Reverted rather than shipped with vanished copy on the
           two sections that carry the pitch to each audience. -->
      <div class="grid gap-10 sm:grid-cols-2 sm:gap-12">
        <section>
          <h2 class="text-h2 text-ink-900 dark:text-ink-50">Earn while Claude thinks</h2>
          <ol class="mt-4 space-y-2">
            @for (step of install; track step; let i = $index) {
              <li class="flex gap-3">
                <span aria-hidden="true" class="font-mono text-ink-600 tabular-nums dark:text-ink-400">{{ i + 1 }}</span>
                <span>{{ step }}</span>
              </li>
            }
          </ol>
          <p class="mt-4 text-ink-800 dark:text-ink-100"><mw-money [cents]="developerPayCents" /> a question, up to {{ maxPaidPerDay }} a day. Never $0.002 an ad.</p>
          <p class="mt-6 flex flex-wrap items-center gap-4">
            <a mw-button routerLink="/developers">Join the waitlist</a>
            <a mw-link routerLink="/data">What leaves your machine</a>
          </p>
        </section>

        <section>
          <h2 class="text-h2 text-ink-900 dark:text-ink-50">Ask 300 AI-native developers one question</h2>
          <table mw-rows class="mt-4">
            <tbody>
              <tr><td>Per valid response</td><td mw-figure><mw-money voice="data" [cents]="full.priceCents" /></td></tr>
              <tr><td>With targeting (language, country, activity, OS)</td><td mw-figure>+<mw-money voice="data" [cents]="targetingCents" /></td></tr>
              <tr><td>Study size</td><td mw-figure>{{ minRespondents }} to {{ maxRespondents }}</td></tr>
              <tr><td>Your first study, at cost</td><td mw-figure><mw-money voice="data" [cents]="atCost.priceCents" /></td></tr>
            </tbody>
          </table>
          <p class="mt-6 flex flex-wrap items-center gap-4">
            <a mw-button routerLink="/app/login">Sign in to create a study</a>
            <a mw-link routerLink="/buyers">Review policy and refusals</a>
          </p>
        </section>
      </div>
    </mw-shell>`,
})
export default class IndexPage {
  private destroy = inject(DestroyRef)

  // R81/R58: a price is a function of the configuration, never a constant. These were
  // the last two money claims on the branch typed in by hand, and they are on the page
  // that goes to 50 buyers, r/ClaudeAI, r/cursor and X. Measured before that change:
  // halving DEVELOPER_SHARE in the contract reddened 16 tests and left this page
  // reading $0.50, because the assertion quoted the page rather than quoteStudy.
  // The comparison figure beside it, $0.002 an ad, is an advertising CPM: it is not a
  // Tickover price and has nothing in the contract to come from.
  full = quoteStudy({ targeted: false, atCost: false })
  atCost = quoteStudy({ targeted: false, atCost: true })
  targetingCents = quoteStudy({ targeted: true, atCost: false }).priceCents - this.full.priceCents
  developerPayCents = this.full.developerCents
  maxPaidPerDay = RULES.MAX_PAID_PER_DAY
  minRespondents = PRICING.MIN_RESPONDENTS
  maxRespondents = PRICING.MAX_RESPONDENTS

  install = ['Install the plugin', 'Run /tickover:setup', 'Answer with one key']

  /**
   * The picture named in prose, because role=img replaces everything inside the pane
   * with its label and the label used to describe only the bottom row. It ends with a
   * space: the composer's own sentence follows it.
   */
  scene = 'A terminal where a coding agent is working, and the paid question is on the bottom row. '

  sponsor = HERO_STUDY.sponsor
  question = HERO_STUDY.question
  options = HERO_STUDY.options

  /**
   * A few rungs below the width where this study's question stops being shown at all.
   * Under that width the composer suppresses the question and emits the idle line,
   * because spec 4.7 makes the sponsor unconditional and the question is what gives
   * way -- and watching it disappear rather than degrade is the most honest thing this
   * control can show, so the range has to start under it.
   *
   * Deliberately not written as "n is the floor". It said 66, then 72, and both went
   * stale: 66 was measured on a budget the client never uses (R358, closed by resolving
   * the width in `mw-pane` the way the daemon does), and 72 stopped being true when the
   * product was renamed, because every composed line is prefixed with its name and
   * `tickover` is a character shorter than `meanwhile` (R383). The floor is a function
   * of the composer and of this study; `e2e/public.spec.ts` now derives it from both
   * rather than restating it.
   */
  minCols = 68
  maxCols = 120
  /**
   * R413, the width control's half of R411: seeded from the prerendered control, not from 80. The
   * page takes a drag before it hydrates (R400); hydration keeps the element, the first render then
   * writes this signal into it, and the replayed input event reads that value back -- so starting
   * from 80 put every early drag back to 80. The host element, never the global document (R407). A
   * page created fresh, with no child yet, gets 80.
   */
  cols = signal(seedCols(inject(ElementRef).nativeElement as HTMLElement))
  beat = signal(0)
  private timers: ReturnType<typeof setTimeout>[] = []

  constructor() {
    // Browser only: `afterNextRender` does not run during the prerender, which is
    // what keeps the seven prerendered documents holding the final frame rather than
    // whichever beat the render happened to catch.
    afterNextRender(() => {
      // Design system 5: this is the only autonomous motion in the product. Reduced
      // motion gets the final frame at once rather than a faster sequence -- and so
      // does an environment that cannot be asked.
      if (media('(prefers-reduced-motion: reduce)') !== false) {
        this.beat.set(3)
        return
      }
      this.timers = BEATS.map((at, i) => setTimeout(() => this.beat.set(i), at))
      this.destroy.onDestroy(() => this.stop())
    })
  }

  /**
   * Moving the width also puts the question back, and that is not a flourish.
   *
   * The screen design asks the pane to demonstrate the width ladder in response to
   * the visitor dragging -- and calls it the single most persuasive thing on the
   * page, because it shows the product engineered for the constraint it lives in.
   * But it also has the sequence end on the idle line, and **an idle line has nothing
   * to drop**: it fits at 38 columns as well as at 120, so dragging would move a
   * number and change nothing. Built to the letter, the persuasive control would have
   * been inert within six seconds of load, on every visit.
   *
   * So a drag is the visitor taking over: the sequence stops where it is and the pane
   * returns to the question, which is the state that has rungs to fall through.
   */
  setCols(v: string): void {
    const n = Number(v)
    if (!Number.isFinite(n)) return
    this.cols.set(n)
    this.stop()
    this.beat.set(1)
  }

  private stop(): void {
    this.timers.forEach(clearTimeout)
    this.timers = []
  }
}
