import { Component, input } from '@angular/core'
import { Banner } from './banner'
import { Empty } from './empty'

/**
 * The failed / loading / empty / data ladder, in one place instead of seven.
 *
 * **The order of the rungs is the whole point, and it is a correctness rule rather
 * than a presentation one.** A load that failed must never fall through to the empty
 * state: on `/dev` that would tell a developer they have answered nothing, which is a
 * claim about money they are owed; on `/admin` it would show an empty review queue
 * while a study waits in it. Seven hand-rolled ladders each got this right, but each
 * got it right separately, and the eighth is the one that would not have.
 *
 * `failed` therefore wins over `loading`, and `loading` over `empty`. A caller that
 * sets both `failed` and `empty` sees the failure, which is the safe reading.
 *
 * The data branch is projected. Angular creates projected content whether or not it
 * is inserted, so a caller's rows are built even while this shows the loading rung --
 * harmless here, because every caller iterates a signal that is empty until the data
 * lands, but worth knowing before putting something expensive in the slot.
 *
 * A second slot, `mw-empty-action`, reaches the empty rung. An empty screen is an
 * invitation to act, and the invitation is usually a link -- which `emptySays` cannot
 * carry, because it is a string. Without it a caller with a link to offer has to leave
 * the ladder and hand-roll the rung, which is the one thing this component exists to
 * stop. The slot is selected, so the data content still lands in the default one.
 */
@Component({
  selector: 'mw-async',
  imports: [Banner, Empty],
  template: `
    @if (failed()) {
      <mw-banner data-load-failed tone="error">{{ failedSays() }}</mw-banner>
    } @else if (loading()) {
      <p data-loading class="py-3 text-small text-ink-600 dark:text-ink-400">Loading…</p>
    } @else if (empty()) {
      <mw-empty data-empty [says]="emptySays()"><ng-content select="[mw-empty-action]" /></mw-empty>
    } @else {
      <ng-content />
    }
  `,
  host: { class: 'block' },
})
export class Async {
  failed = input(false)
  loading = input(false)
  empty = input(false)
  /** Said in the error tone. State what did not load and what is therefore unreliable. */
  failedSays = input.required<string>()
  emptySays = input.required<string>()
}
