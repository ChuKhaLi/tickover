import { Component, input } from '@angular/core'
import { Card } from './card'

/**
 * Label, value, hint. Three near-identical shapes become one, and the value is
 * projected because it is never a plain string: it is `mw-money`, a ratio, a count
 * against its ceiling.
 *
 * The panel comes from `mw-card` rather than from a copy of its classes, so the one
 * decision about what a panel looks like stays in one file. `h-full` is not
 * decoration -- these sit in one row, and a tile whose hint runs to two lines
 * would otherwise be taller than its neighbours and leave the row ragged.
 *
 * The value is `text-h2`, which is a heading size for something that is not a
 * heading. Deliberate: on this kind of tile the number is what the eye is looking
 * for, and design system 4's scale has no separate role for it. The label above it
 * stays `small`, so the pair reads as a caption over a figure rather than as two
 * headings.
 */
@Component({
  selector: 'mw-stat',
  imports: [Card],
  template: `
    <div mw-card pad="lg" class="h-full">
      <div class="text-small text-ink-600 dark:text-ink-400">{{ label() }}</div>
      <div class="mt-0.5 text-h2 text-ink-900 dark:text-ink-50"><ng-content /></div>
      @if (hint()) {
        <p class="mt-1 text-caption text-ink-600 dark:text-ink-400">{{ hint() }}</p>
      }
    </div>
  `,
  host: { class: 'block' },
})
export class Stat {
  label = input.required<string>()
  hint = input<string>('')
}
