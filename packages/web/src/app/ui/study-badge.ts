import { Component, computed, input } from '@angular/core'
import type { z } from 'zod'
import type { StudyState } from '@tickover/contract'

// `StudyState` reaches the contract's surface as a schema with no companion
// type (R45), so the union comes from `z.infer`. Keyed as a `Record` over that
// union on purpose: a state added to the contract fails this file to compile
// rather than rendering as an unstyled chip nobody notices.
type State = z.infer<typeof StudyState>

/**
 * Two things changed here, and both were defects rather than preferences.
 *
 * **It had no dark theme at all.** Every state was a `100`-level fill with a
 * `900`-level ink and no `dark:` variant, so on the dark ground the chips rendered
 * as pale blocks — the only element in the application that ignored the theme.
 *
 * **`live` was green**, and design system 3.4 removed green from the palette: money
 * is set in ink rather than coloured, and the ledger's entry types are types rather
 * than sentiment, so a green that does not mean money in a product about money is
 * worse than none. `live` takes the accent instead, which is the right colour for a
 * different reason — live is the state a buyer acts on, and the accent is what marks
 * where the action is. It is also the one state that needs no `dark:` variant: the
 * accent fill with near-black ink reads in both themes, exactly as the primary button
 * does (R316), measured 8.06.
 *
 * `draft` and `closed` share a neutral treatment and are told apart by the edge and
 * by the word. They are both "not in the field", and the five-step track beside the
 * chip on a study's own page is what carries which end of the lifecycle they are at.
 */
const CLASSES: Record<State, string> = {
  draft: 'bg-ink-200 text-ink-700 dark:bg-ink-700 dark:text-ink-100',
  in_review:
    'border border-review-edge bg-review-bg text-review-fg dark:border-review-edge-dark dark:bg-review-bg-dark dark:text-review-edge',
  live: 'bg-signal-400 text-ink-950',
  closed: 'border border-ink-300 bg-ink-200 text-ink-700 dark:border-ink-600 dark:bg-ink-700 dark:text-ink-100',
  settled:
    'border border-settled-edge bg-settled-bg text-settled-fg dark:border-settled-edge-dark dark:bg-settled-bg-dark dark:text-settled-edge',
  rejected:
    'border border-rejected-edge bg-rejected-bg text-rejected-fg dark:border-rejected-edge-dark dark:bg-rejected-bg-dark dark:text-rejected-edge',
}

@Component({
  selector: 'mw-study-badge',
  // `rounded-chip` is 3px, not the pill it was: design system 5 gives radius a scale
  // where it grows with how much the element contains, and a chip contains one word.
  //
  // One type name, not three: the caption role carries the weight and the 0.004em
  // tracking this line used to spell out beside the size. That is the whole argument
  // for roles -- two of three get copied and the third is forgotten.
  template: `<span class="inline-flex items-center rounded-chip px-2 py-0.5 text-caption" [class]="cls()">{{ label() }}</span>`,
})
export class StudyBadge {
  state = input.required<State>()
  cls = () => CLASSES[this.state()]
  label = () => this.state().replace('_', ' ')
}

/**
 * The lifecycle, drawn as the sequence it is.
 *
 * Design system 1 names this as **the one place in this product where a step
 * indicator is honest rather than decorative**: draft, in_review, live, closed,
 * settled is genuinely a sequence, and a buyer asking "where is my study" is asking
 * a question about position in it that a chip cannot answer.
 *
 * It was specified and never built, and the cost of that was not a missing feature.
 * The comment above this one has been saying, for four commits, that draft and closed
 * "are told apart by the edge and by the word" because "the five-step track beside
 * the chip on a study own page is what carries which end of the lifecycle they are
 * at" -- describing a component that did not exist, in the file whose design depends
 * on it. A sentence explaining why a treatment can be quiet, resting on a louder
 * thing that was never drawn.
 *
 * **Rejected is not a step and is not drawn.** A rejected study left the sequence; a
 * track with it wedged in would be inventing a sixth state to keep the picture tidy,
 * and the reviewer note is on screen directly below. The chip says rejected.
 *
 * State is carried by the words and their weight, not by colour alone: the step
 * reached is `ink-900` at 600 and every other label is a measured text colour, so
 * the bars reinforce a distinction that is already readable without them. Measured
 * on the page ground: a bar reached is `signal-600` at 7.01 and 4.97 against an
 * unreached one; on the dark ground `signal-400` at 7.19 and 3.06 against `ink-600`.
 */
const TRACK = ['draft', 'in_review', 'live', 'closed', 'settled'] as const
const STEP_LABEL: Record<(typeof TRACK)[number], string> = {
  draft: 'Draft',
  in_review: 'In review',
  live: 'Live',
  closed: 'Closed',
  settled: 'Settled',
}

@Component({
  selector: 'mw-state-track',
  template: `
    @if (at() >= 0) {
      <ol class="flex gap-2" [attr.aria-label]="label()">
        @for (s of steps; track s; let i = $index) {
          <li class="flex-1" [attr.aria-current]="i === at() ? 'step' : null">
            <div class="h-1 rounded-chip" [class]="i <= at() ? 'bg-signal-600 dark:bg-signal-400' : 'bg-ink-300 dark:bg-ink-600'"></div>
            <span class="mt-1 block text-caption" [class]="i === at() ? 'font-semibold text-ink-900 dark:text-ink-50' : i < at() ? 'text-ink-600 dark:text-ink-400' : 'text-ink-500 dark:text-ink-400'">{{ name(s) }}</span>
          </li>
        }
      </ol>
    }
  `,
  host: { class: 'block' },
})
export class StateTrack {
  state = input.required<State>()
  steps = TRACK
  name(s: (typeof TRACK)[number]): string { return STEP_LABEL[s] }
  /** -1 for a state that is not on the track, which is only ever `rejected`. */
  at = computed(() => TRACK.indexOf(this.state() as (typeof TRACK)[number]))
  label = computed(() => `Study lifecycle: ${STEP_LABEL[TRACK[this.at()]!]}, step ${this.at() + 1} of ${TRACK.length}`)
}
