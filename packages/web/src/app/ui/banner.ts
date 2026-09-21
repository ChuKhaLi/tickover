import { Component, computed, input } from '@angular/core'

export type BannerTone = 'error' | 'warn' | 'done' | 'info'

/**
 * One block message, four tones, replacing three red vocabularies, three amber
 * owners and four different "it worked" treatments (design system section 7).
 *
 * `done` is where green used to be. Design system 3.4 removed green from the
 * palette — money is set in ink rather than coloured, and the ledger's five entry
 * types are types rather than sentiment — so success is carried by the accent and
 * by the words. The four existing green boxes become this.
 */
const TONE: Record<BannerTone, string> = {
  error: 'border-rejected-edge bg-rejected-bg text-rejected-fg dark:border-rejected-edge-dark dark:bg-rejected-bg-dark dark:text-rejected-edge',
  warn: 'border-review-edge bg-review-bg text-review-fg dark:border-review-edge-dark dark:bg-review-bg-dark dark:text-review-edge',
  done: 'border-signal-300 bg-signal-50 text-signal-700 dark:border-signal-500 dark:bg-signal-800 dark:text-signal-200',
  info: 'border-ink-200 bg-ink-100 text-ink-800 dark:border-ink-700 dark:bg-ink-800 dark:text-ink-100',
}

/**
 * `alert` interrupts; `status` waits for a pause. An error a person has just
 * caused is worth interrupting for, and a confirmation is not — reading out
 * "Check your email" over whatever they were listening to is the announcement
 * being louder than the news.
 */
const ROLE: Record<BannerTone, 'alert' | 'status'> = { error: 'alert', warn: 'alert', done: 'status', info: 'status' }

@Component({
  selector: 'mw-banner',
  template: `<ng-content />`,
  host: {
    '[class]': 'classes()',
    '[attr.role]': 'role()',
    // Focus is moved here after an action resolves, so it has to be able to take it.
    tabindex: '-1',
  },
})
export class Banner {
  tone = input<BannerTone>('info')
  role = computed(() => ROLE[this.tone()])
  classes = computed(() => `block rounded-card border p-3 text-small ${TONE[this.tone()]}`)
}
