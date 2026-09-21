import { Directive, computed, input } from '@angular/core'

/**
 * A selectable tag: a country, a language, an activity tier, an operating system, a
 * list of developers to look at. Four sites drew this by hand with the same class
 * string and the same one-utility fill toggle, and **only one of the four set
 * `aria-pressed`** -- so on the other three a screen reader announced a button whose
 * state was carried entirely by its colour. The attribute is on the host here, always
 * written rather than written when true, because `aria-pressed="false"` is what makes
 * the control announce as a toggle at all.
 *
 * A directive on a real `<button>`, for `button.ts`'s reasons and one more: these are
 * toggles, so `disabled` has to be the platform's -- `/app/studies/new` disables the
 * unselected ones once the targeting cap is reached, and the cap is the thing keeping
 * a study's audience from being described so narrowly that nobody matches it.
 *
 * Selected is the accent fill with near-black ink, the same treatment `primary` and
 * the `live` badge use, and for the same reason: it needs no dark twin, because the
 * fill reads identically against either ground. Unselected is the control edge -- this
 * is a control, its boundary is what identifies it, and R326 put that at 3.0 rather
 * than at the hairline bar. `tokens.spec.ts` reads this string and measures it.
 *
 * `rounded-chip` is 3px, not a full pill. Design system 5 gives radius a scale that
 * grows with what the element contains, and these contain one word.
 */
const STATE = {
  on: 'bg-signal-400 text-ink-950',
  off: 'border border-ink-500 text-ink-800 hover:bg-ink-100 dark:border-ink-400 dark:text-ink-100 dark:hover:bg-ink-800',
} as const

const ALWAYS =
  'inline-flex cursor-pointer items-center rounded-chip px-3 py-1 text-small transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal-600 dark:focus-visible:outline-signal-400'

@Directive({
  selector: 'button[mw-chip]',
  host: {
    '[class]': 'classes()',
    '[attr.aria-pressed]': 'selected()',
    '[attr.data-mw-control]': '""',
  },
})
export class Chip {
  selected = input(false)
  classes = computed(() => `${ALWAYS} ${this.selected() ? STATE.on : STATE.off}`)
}
