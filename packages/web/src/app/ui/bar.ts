import { Component, input } from '@angular/core'

/**
 * A proportion, drawn. Every bar on the study page has its own number written
 * beside it, so this carries no text of its own and is marked decorative rather
 * than repeating a figure a screen reader has already read out.
 *
 * The fill is not one colour in both themes, and the measurement is why: a bar means
 * nothing unless it is distinguishable from its own track, which is 3.0 under WCAG
 * 1.4.11. `signal-400` against the light track is **1.96** and fails; `signal-600`
 * is 5.83. On the dark track it is the other way round, and `signal-400` is 4.17.
 */
@Component({
  selector: 'mw-bar',
  template: `<div aria-hidden="true" class="h-2 w-full rounded-chip bg-ink-200 dark:bg-ink-700"><div data-bar class="h-2 rounded-chip bg-signal-600 dark:bg-signal-400" [style.width.%]="pct()"></div></div>`,
})
export class Bar {
  pct = input.required<number>()
}
