import { Directive, ElementRef, inject, input } from '@angular/core'

export type InputSize = 'md' | 'sm'

const SIZE: Record<InputSize, string> = {
  md: 'min-h-11 rounded-control px-3 py-2 text-body',
  sm: 'min-h-9 rounded-control px-2.5 py-1.5 text-small',
}

const ALWAYS =
  'w-full border border-ink-500 bg-white text-ink-800 placeholder:text-ink-500 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal-600 disabled:cursor-not-allowed disabled:opacity-60 dark:border-ink-400 dark:bg-ink-800 dark:text-ink-100 dark:placeholder:text-ink-400 dark:focus-visible:outline-signal-400'

/**
 * A directive, for the reason `button.ts` records at length: the control has to
 * stay the element the caller holds. `/app/login` reads its address off a template
 * reference on this input and would have to be rewritten around `ngModel` -- which
 * its own comment explains it deliberately avoids, because inside a `<form>` the
 * model is wired a microtask after first render and a submit in that window sends
 * an empty address.
 *
 * The medium size is set at the body role, 16px, rather than at the smaller one, and
 * that is not a style preference: iOS Safari zooms the page when a focused field's
 * text is under 16px, and every form on this site is one a buyer fills on whatever
 * they have to hand.
 *
 * The role rather than Tailwind's own step of the same size, measured rather than
 * assumed: the role's line height is 1.55 against 1.5, which is 0.8px on one line of
 * a control whose height is set by `min-h-11` anyway. Nothing moves, and the entry
 * this file had on the type ledger reaches zero after all -- the ledger's note said
 * it would not, for a reason that turned out to be about a line height that never
 * reaches the outside of the box.
 *
 * The placeholder is `ink-500`, the token R304 reserved for exactly this -- a mark
 * that is decorative and must never be the only label. `mw-field` supplies the
 * label; this directive never does.
 *
 * A `select` takes the same treatment, and for the same reason the edge exists: it is
 * a control on a near-white page, and nothing but the edge says so. It keeps the
 * platform arrow -- this draws no chevron of its own, because a select that looks
 * like a text box is a control people do not know they can open.
 *
 * The edge is `ink-500` too, and there it is an accessibility requirement rather
 * than a matching choice: this control's own surface is white on a near-white page
 * (1.05) and `ink-800` on `ink-900` in the dark (1.21), so it is the edge alone that
 * says a control is here. WCAG 1.4.11 asks 3.0 of that; the step originally used
 * measured 1.48 light and 1.94 dark. `tokens.spec.ts` reads this string and measures
 * the edge it finds, so lightening it goes red instead of quietly shipping.
 */
@Directive({
  selector: 'input[mw-input], textarea[mw-input], select[mw-input]',
  host: {
    '[class]': 'classes()',
    '[attr.data-mw-control]': '""',
  },
})
export class Input {
  size = input<InputSize>('md')
  /** `mw-field` reads this to point its label and its hint at the control. */
  readonly el = inject(ElementRef<HTMLInputElement | HTMLTextAreaElement>)
  classes = () => `${ALWAYS} ${SIZE[this.size()]}`
}

/**
 * A native range, styled once.
 *
 * Two screens draw one -- the landing hero's terminal width and the new-study form's
 * respondent count -- and both had the same nine classes written out by hand: the
 * track height, the accent in both themes, and the focus edge in both themes. The
 * focus half is the part worth a primitive rather than a copy, because it is the half
 * that is easy to leave off and impossible to notice missing (design system 5: focus
 * is never removed, and this product's primary input is a keyboard).
 *
 * Native, not rebuilt: the keyboard behaviour, the screen-reader value and the touch
 * target are the platform's, which is the same reasoning `mw-input` records. Width is
 * the caller's -- one is `w-56` beside a label, the other `w-full` under one -- and
 * width is a layout decision rather than a treatment.
 */
@Directive({
  selector: 'input[type=range][mw-range]',
  host: {
    class:
      'h-2 cursor-pointer accent-signal-600 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal-600 dark:accent-signal-400 dark:focus-visible:outline-signal-400',
  },
})
export class Range {}
