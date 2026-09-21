import { Directive } from '@angular/core'

/**
 * The shape of a data listing, as a directive on the real element.
 *
 * Five styles, two divider directions and a handful of unstyled ones become one. A
 * directive rather than a component taking column definitions, for two reasons: the
 * caller keeps writing ordinary `<thead>` and `<tr>`, so seven existing specs that
 * query `tbody tr` go on working; and a column-definition API would have to carry
 * cell templates, which in Angular means `ng-template` with context and a lot of
 * machinery to express what a template already says plainly.
 *
 * The descendant rules are arbitrary variants so that every rule lands in the one
 * pinned stylesheet. A component stylesheet would have been shorter to write and
 * would have put this outside `test/unit/styles.spec.ts`'s byte count -- the check
 * that has caught seven minted utilities and three real styling regressions on this
 * package. Dodging it to save six characters is the wrong trade.
 *
 * Dividers go on the top of each body row and nowhere else: a single direction means
 * no doubled rule where a head meets a body, and no orphan rule under the last row.
 *
 * **The head's alignment is scoped, and that is a bug fix rather than a nicety.** It
 * was `[&_th]:text-left`, which is a descendant selector and therefore outranks the
 * plain `text-right` that `mw-figure` puts on the element -- so a figure column's
 * header sat over the wrong edge of its own column while `mw-figure` was present and
 * correct on it. `layout.spec.ts` asserted the class was there, which it was, and a
 * class-presence test cannot see specificity. Found by reading the built page.
 *
 * Cells carry trailing space except the last. Without it a right-aligned figure
 * column runs straight into the next column's text, which on the payouts screen read
 * as one string.
 */
@Directive({
  selector: 'table[mw-rows]',
  host: {
    class:
      'w-full text-small [&_thead]:text-caption [&_thead]:text-ink-600 dark:[&_thead]:text-ink-400 [&_th]:py-2 [&_th:not([mw-figure])]:text-left [&_td]:py-2 [&_th:not(:last-child)]:pr-4 [&_td:not(:last-child)]:pr-4 [&_tbody_tr]:border-t [&_tbody_tr]:border-ink-200 dark:[&_tbody_tr]:border-ink-700',
  },
})
export class Rows {}

/**
 * A cell holding a figure. Right-aligned and tabular, which is the pair design
 * system 4 asks for wherever a number has to line up with the number below it --
 * and the reason `mw-money`'s `data` voice exists. Put it on the `<th>` too, or the
 * column head sits over the wrong edge of its own column.
 */
@Directive({
  selector: '[mw-figure]',
  host: { class: 'text-right tabular-nums' },
})
export class Figure {}
