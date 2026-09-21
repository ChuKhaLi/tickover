import { Component, computed, input } from '@angular/core'
import { STATUS_LINE_SAFETY_MARGIN, formatStatusLine, resolveColumns, type ServedQuestion } from '@tickover/contract'

/**
 * The signature component: a replica of the status line, true to width.
 *
 * Not a styled code block, and not a hand-written string that looks like one. It
 * takes a column budget and calls **the composer the daemon calls** -- moved into
 * `@tickover/contract` for this, from `packages/daemon/src`. That is the whole
 * design of this component. A second composer in the web would drift, and it would
 * drift in the direction that matters most: this product's entire pitch is one line
 * of text, and a marketing page showing a line the client would not print is a
 * product claim that is false.
 *
 * So `rung` is **not** a prop, although design system 6.1 lists one. A prop would let
 * a page ask for a rung the composer would never produce at that width -- which is
 * exactly the drift the move was made to prevent. The rung is whatever the arithmetic
 * reaches, and the page can only change the inputs.
 *
 * Colour is applied by walking the composed line rather than by assembling a coloured
 * one, for the same reason: the text is the composer's output, and this only decides
 * what shade each piece of it is. `pane.spec.ts` asserts that the pieces rejoin to
 * exactly what `formatStatusLine` returned, which is the assertion that keeps the two
 * from separating.
 *
 * The middle dot stays here. Spec 5.4 puts it in this line, and design system 7
 * retires it everywhere else -- the mark is this component's, and page chrome
 * borrowing it was spending the product's one distinctive device on decoration.
 */
const SEP = ' · '
/** A payout, either a price (`$0.50`) or an earning (`+$0.50`). */
const MONEY = /^\+?\$\d+\.\d\d$/

/**
 * One character, in `em`, and **not** `ch` -- which is what this was first written in
 * and is the unit that exists for exactly this job.
 *
 * Measured in Chrome on the built page, with `document.fonts.check('14px "IBM Plex
 * Mono"')` returning true and `document.fonts.ready` awaited: `1ch` resolves to
 * **7.0px** at a 14px font size, while the advance width of the glyph the face
 * actually paints is **8.4px**. 7.0 is 0.5em, the value the spec tells a browser to
 * fall back to when it cannot read the glyph's advance -- so `ch` here is 17% short,
 * and an 80-column replica was rendering 68 columns wide and clipping the rest behind
 * a scrollbar. A replica whose whole claim is to be true to width cannot be measured
 * in a unit that is 17% wrong.
 *
 * 0.6 is the ratio of the face itself (600 units of a 1000-unit em), confirmed by the
 * measurement above rather than taken from the metrics table. `e2e/public.spec.ts`
 * asserts in a real browser that the surface is wide enough for the line it holds,
 * because that is the only place this can be checked at all.
 */
const ADVANCE_EM = 0.6

type Piece = { text: string; kind: 'plain' | 'sep' | 'sponsor' | 'money' }

@Component({
  selector: 'mw-pane',
  template: `
    <!-- The frame is dark-theme only, and R317 is why. On paper the surface is
         ink-950 against ink-50 and needs nothing; on the dark page it is ink-950 on
         ink-900, which measures **1.12** -- less than a hairline manages -- so the
         one object this whole design is built around stops being an object. The edge
         that fixes it carries meaning rather than decorating, so it is measured at
         3.0 and not at the hairline bar: signal-500 on ink-900 is 3.90.

         The pair was decided and written into the token spec when the dark theme was
         designed, and this component shipped without it -- which no guard could have
         caught, because signal-500 is painted elsewhere and the pair list is a claim
         about roles rather than about which component draws them. Looking at the
         built page in the dark theme is what found it. No backtick in this comment:
         one would end the template literal it sits inside. -->
    <div class="w-fit max-w-full overflow-x-auto rounded-pane bg-ink-950 p-2 dark:border dark:border-signal-500">
      <!-- Square inside: a terminal has no rounded corners, so the radius is the
           frame's and the surface it holds is not softened. -->
      <div class="font-mono text-small" [style.width]="surfaceWidth()">
        <!-- The session above the line, and the boundary is exact: this slot holds
             what was on the screen before the status line, and it can never hold the
             status line. A status line sits at the bottom of a running terminal, so a
             replica floating on its own shows the product to someone who has already
             understood it and to nobody else (R318) -- but the whole doctrine of this
             component is that a page supplies inputs and the composer supplies the
             row. A slot that could paint the row would be the drift the composer was
             moved into the contract to stop. So the slot sits above the row, inside
             the same surface and the same character width, and the row below it is
             still only ever what formatStatusLine returned.

             Empty on every page but the landing hero, and it costs nothing when
             empty. -->
        <ng-content />
        <div data-line class="whitespace-pre text-ink-100">
        @for (p of pieces(); track $index) {
          @switch (p.kind) {
            @case ('sep') { <span class="text-ink-400">{{ p.text }}</span> }
            @case ('sponsor') { <span class="text-signal-200">{{ p.text }}</span> }
            @case ('money') { <span class="font-semibold text-white">{{ p.text }}</span> }
            @default { <span>{{ p.text }}</span> }
          }
        }
        </div>
      </div>
    </div>
  `,
  host: {
    class: 'block',
    // A picture of a terminal, so it is announced as one thing in prose rather than
    // read out as a row of fields joined by a punctuation mark nobody needs to hear.
    role: 'img',
    '[attr.aria-label]': 'label()',
  },
})
export class Pane {
  /**
   * The terminal's width in characters -- what a developer would say their terminal
   * is -- not the composer's budget. `budget()` turns one into the other.
   */
  cols = input(80)

  /**
   * The width, resolved the way the daemon resolves it, which is the whole of what
   * makes this a replica rather than an impression.
   *
   * `resolveColumns` clamps to 20..400 and subtracts `STATUS_LINE_SAFETY_MARGIN`,
   * because Claude Code blind-chops the status line at `COLUMNS-4`. This component
   * passed `cols` straight to the composer and so drew six characters more than the
   * client would at every width: 36 of the 61 positions on the landing page's slider
   * rendered a line the product does not print, and between 66 and 71 columns it
   * offered a paid question with three options where a real terminal shows only the
   * idle line.
   *
   * Moving `formatStatusLine` into the contract was meant to stop exactly that, and
   * did not, because only half the pipeline moved with it: the daemon reaches for
   * both functions in one import and this file reached for one. Sharing the composer
   * is not the same as composing the same way (R358).
   */
  budget = computed(() => resolveColumns({ detected: this.cols() }))

  /**
   * The terminal itself: the budget with the margin put back, which is the width
   * `resolveColumns` settled on before it took the margin off.
   *
   * `cols` is an input and an input is whatever the caller passes, so everything
   * drawn from it has to survive a caller that passes something else. The composer
   * already did -- it bounds the width to 20..400 -- and the surface did not, so
   * `cols` of 5000 drew a 3000em terminal holding a 394-character row and `cols` of
   * 1 drew one six tenths of an em wide.
   *
   * Recovered from `budget()` rather than bounded a second time here, because a
   * second bound is a second thing to keep in step with the first, and both of this
   * component's defects have been the halves of one arithmetic drifting apart
   * (R358). Derived this way there is one resolution, and the surface cannot
   * disagree with the row it holds.
   */
  private resolved = computed(() => this.budget() + STATUS_LINE_SAFETY_MARGIN)
  sponsor = input('')
  payoutCents = input(0)
  /** Empty renders the idle line instead, which is what a developer sees between questions. */
  question = input('')
  options = input<readonly string[]>([])
  /**
   * Prose naming what the picture is, for the one page that puts a session in the
   * slot above the line.
   *
   * The host is role="img", so everything inside it is replaced by the label for a
   * screen reader -- which is right when the picture is one row of text, and wrong
   * the moment the picture is a whole terminal and the label still announces only
   * its last line. Empty by default, so every other caller is unaffected.
   */
  scene = input('')
  /** The moment after a keypress lands: `tickover · ✓ +$0.50 · today …`. */
  answeredCents = input<number | null>(null)
  todayPaid = input(0)
  pendingCents = input(0)
  availableCents = input(0)

  /**
   * Everything the schema asks for, with placeholders for the fields the line never
   * reads. Built rather than taken as one input so a template can write the four
   * pieces a person cares about; the ids are not shown by any rung.
   */
  private served = computed<ServedQuestion | null>(() =>
    this.question()
      ? {
          assignment_id: '00000000-0000-4000-8000-000000000000',
          kind: 'choice',
          text: this.question(),
          options: [...this.options()],
          context: null,
          sponsor: this.sponsor(),
          price_cents: this.payoutCents(),
          served_at: '2026-01-01T00:00:00.000Z',
          expires_at: '2026-01-01T00:05:00.000Z',
        }
      : null,
  )

  line = computed(() =>
    formatStatusLine({
      loggedIn: true,
      question: this.served(),
      answered: this.answeredCents() === null ? null : { earnedCents: this.answeredCents()! },
      todayPaid: this.todayPaid(),
      pendingCents: this.pendingCents(),
      availableCents: this.availableCents(),
      maxColumns: this.budget(),
    }),
  )

  /**
   * The line split on its separator, with the separators kept as pieces of their own
   * so that rejoining is exact. The sponsor is found by position, and the position is
   * a fact about the composer rather than a guess: a paid question's prefix is
   * `tickover`, the sponsor, the payout -- so when there is a paid question, the
   * second field is the sponsor, truncated to whatever fitted.
   */
  pieces = computed<Piece[]>(() => {
    const fields = this.line().split(SEP)
    const sponsorAt = this.served() && this.served()!.kind === 'choice' ? 1 : -1
    const out: Piece[] = []
    fields.forEach((text, i) => {
      if (i > 0) out.push({ text: SEP, kind: 'sep' })
      out.push({ text, kind: i === sponsorAt ? 'sponsor' : MONEY.test(text) ? 'money' : 'plain' })
    })
    return out
  })

  /** The resolved terminal in character widths, which `ch` is not. See `ADVANCE_EM`. */
  surfaceWidth = computed(() => `${(this.resolved() * ADVANCE_EM).toFixed(3)}em`)

  /** Prose, not the line itself: the separator is punctuation a listener cannot use. */
  label = computed(
    () => `${this.scene()}The Claude Code status line at ${this.resolved()} columns: ${this.line().split(SEP).join(', ')}`,
  )
}
