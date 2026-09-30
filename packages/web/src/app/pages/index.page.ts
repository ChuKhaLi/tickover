import { Component, DestroyRef, ElementRef, afterNextRender, computed, inject, signal } from '@angular/core'
import { HeroPlayer, browserEnv } from '../lib/hero-player'
import {
  AVAILABLE_CENTS, DRAGGED_FRAME, DURATION_MS, FINAL_FRAME, PROMPT, SPINNER_TEXT, TOOL_LINES, frameAt, paneInputs,
} from '../lib/hero-timeline'
import { HERO_STUDY } from '../lib/hero-study'
import { RouterLink } from '@angular/router'
import { PRICING, RULES, quoteStudy } from '@tickover/contract'
import { Button, Link } from '../ui/button'
import { Range } from '../ui/input'
import { Money } from '../ui/money'
import { ADVANCE_EM, Pane } from '../ui/pane'
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
 * (styles.css, .tk-lattice). It needs a band that reaches both page edges, which is
 * why tk-shell grew a second slot.
 *
 * Two traps in this file's own prose, both already paid for: a backtick ends the
 * template literal the template is written in, and an English word that happens to be
 * a Tailwind class name mints a rule into the shipped CSS (R47).
 *
 * **The sequence (R384).** The session above the row plays out as Claude Code draws it -- the prompt
 * typed and sent, two tool lines, a spinner counting -- and the row goes idle, question, credited,
 * idle with the counters moved. It starts when half the pane is in view, plays once and ends on
 * `FINAL_FRAME`, the frame the prerender already holds. A keypress landing and an option being
 * marked are still not drawn: the status line never prints that frame (R336). `hero-timeline.ts`
 * says what is on screen at each moment; `hero-player.ts` is only the clock.
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
    <tk-shell [links]="[{ href: '/data', label: 'Data' }, { href: '/buyers', label: 'For buyers' }, { href: '/app/login', label: 'Buyer sign in' }]">
      <div slot="band" data-band class="tk-lattice border-b border-ink-200 dark:border-ink-800">
        <div class="mx-auto w-full max-w-content px-4 py-12">
          <h1 class="max-w-[68ch] text-display text-ink-900 dark:text-ink-50">This line is the product.</h1>

          <div class="mt-8">
            @let f = frame();
            @let r = row();
            <tk-pane
              [cols]="cols()"
              [sponsor]="sponsor"
              [payoutCents]="developerPayCents"
              [question]="r.showQuestion ? question : ''"
              [options]="options"
              [answeredCents]="r.answeredCents"
              [todayPaid]="r.todayPaid"
              [pendingCents]="r.pendingCents"
              [availableCents]="availableCents"
              [flash]="f.flash"
              [scene]="scene"
            >
              <!-- What was on the screen before the bottom row (R318), now played out as Claude
                   Code draws it (R384): the prompt typed and sent, the tool lines arriving, the
                   spinner counting. Every line is always here and only faded in, so the pane is the
                   same height at every moment of the sequence and hydration moves nothing below
                   it. Shades are measured on ink-950 in section 3: settled output and the directory
                   at ink-400 (7.71), the typed prompt at white (19.87), the marker and the caret at
                   signal-400 (8.06).

                   The caret used to sit after the typed text as an in-flow sibling, so every
                   character typed pushed its own box one column right -- a genuine, measured
                   start-position change (fix round 1, task 6 finding: proven nonzero against the
                   Layout Instability API by e2e/public.spec.ts, before a fix landed). A ::after on
                   the typed span looked promising -- no DOM node of its own for the API to name --
                   and still measured nonzero: generated content is still a box the layout pass
                   places, and that pass runs on every character. The caret below is out of flow
                   entirely (.tk-caret, absolute, pinned at the box's own top-left) and moved by
                   styles.css's own translate declaration, reading the --tk-caret-x custom property
                   caretShift below writes -- translate is a compositor-only property, specified as a
                   channel the Layout Instability API does not watch (the same rule that clears the
                   row wash and the money flash). ADVANCE_EM is tk-pane's own measured column width,
                   imported rather than restated, so the two stay one number.

                   The box around this line carries its own padding and border for the frame
                   (px-2 py-1, border), and "the box's own top-left" used to mean that box's padding
                   edge -- eight pixels and change short of where the text actually starts, wide
                   enough to sit on top of the last typed character rather than after it (fix round
                   2, re-review finding). The relative span wrapping just the prompt's own three
                   spans is the caret's real anchor now: it carries no padding or border of its own,
                   so its top-left coincides with the text, and .tk-caret needs no padding figure
                   copied in to correct for. That inner span is also why the caret's own class list
                   dropped absolute/top-0/left-0 -- .tk-caret already carries all three, so the
                   Tailwind utilities were 56 bytes stating the same three declarations twice.
                   It also keeps the typed text's spaces as typed (whitespace-pre, the row's own
                   rule in tk-pane): a space typed last is a column in a terminal and caretShift
                   counts it, but in ordinary flow a trailing space is dropped, so the typed span
                   ended a column short of the caret whenever Pause landed just after one (final
                   review I2).

                   The spinner's own glyph (.tk-icon below) turned out to need the same rethinking,
                   found only once the caret above stopped hiding it: the five glyphs it cycles
                   through are outside the self-hosted face's range (styles.css's font-face comment),
                   so a fallback face draws them, and that face does not give ✢ ✳ ✶ ✻ ✽ the same
                   advance width. Swapping glyphs then pushed "Reworking the refresh flow…" sideways
                   by a sub-pixel amount every 120ms -- too small to see, not too small for the API to
                   total up. Pinning the glyph's own box to one column stops its width from ever
                   being read from the glyph at all. -->
              <div data-session class="text-ink-400">
                <p>~/projects/acme</p>
                <p data-sent class="tk-step mt-3 text-white" [class.opacity-0]="!f.submitted"><span class="text-signal-400">&gt;&#160;</span>{{ prompt }}</p>
                @for (line of toolLines; track line; let i = $index) {
                  <p data-tool class="tk-step" [class.opacity-0]="f.tools <= i">&#9679; {{ line }}</p>
                }
                <p data-spinner class="tk-step" [class.opacity-0]="!f.spinner.shown"><span class="tk-icon text-signal-400" [style.width.em]="advanceEm">{{ f.spinner.glyph }}</span> {{ spinnerText }} ({{ f.spinner.seconds }}s)</p>
              </div>
              <div class="mt-3 mb-2 rounded-control border border-ink-800 px-2 py-1">
                <span class="relative whitespace-pre"><span class="text-signal-400">&gt;&#160;</span><span data-typed class="text-white">{{ prompt.slice(0, f.typed) }}</span><span data-caret class="tk-caret text-signal-400" [class.tk-blink]="playerState() === 'playing'" [style.--tk-caret-x]="caretShift(f.typed)">&#9608;</span></span>
              </div>
            </tk-pane>
            <!-- A native range, so the keyboard, the screen reader and the touch target
                 are the platform's. It is the most persuasive control on the page: it
                 shows the line stepping down through the real rungs as the budget
                 narrows, which no screenshot can claim.

                 The play control's width does not follow its label (final review I1). This
                 row wraps, and at 513-528px "Replay" and "Pause" pushed it onto a second
                 line where "Play" fit on one -- while the label changes with no input, at
                 hydration and as the sequence starts, moving everything under it 32px (CLS
                 0.256 at 518px). All three labels share one cell of .tk-stack, so the widest
                 sets the button's width; only the current one is text, and the other two are
                 drawn from data-sizer by styles.css, unseen and aria-hidden, so the button's
                 name and text are still exactly the label. -->
            <p class="mt-3 flex flex-wrap items-center gap-3 text-small text-ink-600 dark:text-ink-400">
              <label for="cols">Terminal width</label>
              <input
                id="cols"
                data-cols
                type="range"
                tk-range
                [min]="minCols"
                [max]="maxCols"
                [value]="cols()"
                (input)="setCols($any($event.target).value)"
                class="w-56"
              />
              <span class="tabular-nums">{{ cols() }} columns</span>
              <span data-replay-slot [class.invisible]="!motion()">
                <button tk-button variant="secondary" size="sm" type="button" data-replay (click)="toggle()"><span class="tk-stack"><span>{{ control() }}</span><span aria-hidden="true" data-sizer="Replay"></span><span aria-hidden="true" data-sizer="Pause"></span><span aria-hidden="true" data-sizer="Play"></span></span></button>
              </span>
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
          <p class="mt-4 text-ink-800 dark:text-ink-100"><tk-money [cents]="developerPayCents" /> a question, up to {{ maxPaidPerDay }} a day. Never $0.002 an ad.</p>
          <p class="mt-6 flex flex-wrap items-center gap-4">
            <a tk-button routerLink="/developers">Join the waitlist</a>
            <a tk-link routerLink="/data">What leaves your machine</a>
          </p>
        </section>

        <section>
          <h2 class="text-h2 text-ink-900 dark:text-ink-50">Ask 300 AI-native developers one question</h2>
          <table tk-rows class="mt-4">
            <tbody>
              <tr><td>Per valid response</td><td tk-figure><tk-money voice="data" [cents]="full.priceCents" /></td></tr>
              <tr><td>With targeting (language, country, activity, OS)</td><td tk-figure>+<tk-money voice="data" [cents]="targetingCents" /></td></tr>
              <tr><td>Study size</td><td tk-figure>{{ minRespondents }} to {{ maxRespondents }}</td></tr>
              <tr><td>Your first study, at cost</td><td tk-figure><tk-money voice="data" [cents]="atCost.priceCents" /></td></tr>
            </tbody>
          </table>
          <p class="mt-6 flex flex-wrap items-center gap-4">
            <a tk-button routerLink="/app/login">Sign in to create a study</a>
            <a tk-link routerLink="/buyers">Review policy and refusals</a>
          </p>
        </section>
      </div>
    </tk-shell>`,
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
   * the width in `tk-pane` the way the daemon does), and 72 stopped being true when the
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

  prompt = PROMPT
  toolLines = TOOL_LINES
  spinnerText = SPINNER_TEXT
  availableCents = AVAILABLE_CENTS

  /** Built during the prerender too, which is safe: `browserEnv` touches nothing until the player runs. */
  private player = new HeroPlayer(DURATION_MS, browserEnv())
  playerState = this.player.state
  /** True only where motion was asked about and allowed. Until then the control holds its place unseen. */
  motion = signal(false)
  private dragged = signal(false)

  /**
   * The final frame until the sequence starts -- which is what the prerender emits and what reduced
   * motion keeps -- then the timeline, then the final frame again. A drag replaces all of it with
   * the question, which is the state that has rungs to fall through.
   */
  frame = computed(() => {
    if (this.dragged()) return DRAGGED_FRAME
    return this.player.state() === 'idle' ? FINAL_FRAME : frameAt(this.player.elapsed())
  })
  row = computed(() => paneInputs(this.frame(), this.developerPayCents))

  /**
   * One terminal column, tk-pane's own measured width (ADVANCE_EM there). Reused for the caret's
   * shift below and for .tk-icon's width, so a second measurement never has the chance to drift
   * from the first.
   */
  advanceEm = ADVANCE_EM

  /**
   * Where the caret sits, in columns from the box's own top-left (fix round 1, task 6 finding):
   * "&gt;&#160;" is two, plus however many characters are typed, as an em length. Written to the
   * --tk-caret-x custom property rather than to a style property directly, so this file never
   * spells out the CSS property name that moves it (styles.css's .tk-caret owns that) -- the two
   * traps in this file's own header comment are a backtick and an English word Tailwind's scanner
   * reads as a utility, and that property's name is exactly such a word (R47). The custom property
   * itself is inert to Tailwind's scanner: nothing it emits is a utility class name. `left`/`right`
   * would recompute through layout on every character, which is the same shift the caret used to
   * cause as an in-flow sibling, just moved one property over -- this one is specified not to count.
   */
  caretShift(typed: number): string {
    return `${((typed + 2) * ADVANCE_EM).toFixed(3)}em`
  }

  /**
   * A name that says what pressing it does, rather than a pressed state as well (R384).
   *
   * Reduced motion, and an environment `media()` could not ask, never attach the player: the
   * state stays 'idle' forever although the pane is already showing `FINAL_FRAME` -- the same
   * picture 'ended' leaves behind. The control is invisible there regardless (`motion()` is
   * false), but the label still has to describe what pressing it would do, and pressing it would
   * start the sequence over from the final frame already on screen, not play it for the first
   * time.
   */
  control = computed(() => {
    const s = this.player.state()
    if (s === 'playing') return 'Pause'
    if (s === 'ended') return 'Replay'
    return this.motion() ? 'Play' : 'Replay'
  })

  constructor() {
    const host = inject(ElementRef).nativeElement as HTMLElement
    // Browser only: `afterNextRender` does not run during the prerender, which is what keeps the
    // prerendered documents holding the final frame.
    afterNextRender(() => {
      // Design system 5: the only autonomous motion in the product. Reduced motion gets the final
      // frame and no control -- and so does an environment that cannot be asked.
      if (media('(prefers-reduced-motion: reduce)') !== false) return
      this.motion.set(true)
      this.player.attach(host.querySelector('tk-pane') ?? host)
    })
    this.destroy.onDestroy(() => this.player.destroy())
  }

  toggle(): void {
    const s = this.player.state()
    if (s === 'playing') this.player.pause()
    else if (s === 'ended') {
      this.dragged.set(false)
      this.player.replay()
    } else this.player.play()
  }

  /**
   * Moving the width also puts the question back, and that is not a flourish. An idle line has
   * nothing to drop -- it fits at 38 columns as well as at 120 -- so a drag is the visitor taking
   * over: the sequence stops and the row returns to the question, the state with rungs to fall
   * through.
   */
  setCols(v: string): void {
    const n = Number(v)
    if (!Number.isFinite(n)) return
    this.cols.set(n)
    this.dragged.set(true)
    this.player.stop()
  }
}
