import { Directive } from '@angular/core'

/**
 * A line of facts under a heading: sponsor, price, respondent count, when it was
 * submitted. Each fact is its own element and the gap between them is the separator.
 *
 * A directive rather than a component, for R331's reason: specs query these lines by
 * their spans, and a wrapper would exist only to break them on.
 *
 * **It retires four spacings and two type roles for one idea.** Six of these lines
 * shipped, hand-written, with `gap-x-3`, `gap-x-4` and `gap-x-6` between them, one at
 * `text-caption` and the rest at `text-small` -- and nothing distinguished the groups
 * except which was written first, which is what design system 7 catalogues as drift
 * rather than variety. 24px is the top of section 5's app scale and it is what the
 * study page already used in three places; `small` is the role section 4 gives to a
 * note, where `caption` is for chips and column heads.
 *
 * Spacing rather than the middle dot, and that is the point of the primitive as much
 * as the spacing is: every one of these lines is a place where a dotted chain is the
 * obvious thing to write, and the mark belongs to the one line this product sells
 * (design system 7). One of the six had grown one back.
 */
@Directive({
  selector: '[tk-meta]',
  host: { class: 'flex flex-wrap items-baseline gap-x-6 gap-y-1 text-small text-ink-600 dark:text-ink-400' },
})
export class Meta {}
