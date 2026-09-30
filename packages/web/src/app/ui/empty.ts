import { Component, input } from '@angular/core'

/**
 * What a list says when it has nothing in it, plus whatever action would fill it.
 *
 * The sentence is an input and the action is projected, because that is the split
 * that holds: every empty state has a sentence, and about half have something the
 * person can press. Eight of these were written by hand across the app with six
 * different margins, which is the tell that the spacing belonged to the component
 * rather than to each caller. **The caller supplies no margin** -- the vertical
 * space is here.
 *
 * It renders the same inside a `<td colspan>` as it does on its own, which is why
 * there is no prop for that: the padding is vertical only, so a cell adds its
 * column's horizontal space and nothing collides.
 *
 * Left-aligned, not centred. A centred sentence in a data-dense product reads as a
 * marketing moment; this is a row of a list that happens to have no rows.
 */
@Component({
  selector: 'tk-empty',
  template: `
    <!-- The cap belongs here and not at the call site. The sentence is an input, so
         source cannot see how long it renders -- and the widest one in the product
         turned out to be an empty state at 155 characters. A caller cannot forget a
         cap it does not own. -->
    <p class="max-w-[68ch] text-small text-ink-600 dark:text-ink-400">{{ says() }}</p>
    <ng-content />
  `,
  host: { class: 'block py-3' },
})
export class Empty {
  says = input.required<string>()
}
