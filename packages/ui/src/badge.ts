import { Component, computed, input } from '@angular/core'
import type { Tone } from './tone'

// Fills and inks from the measured state ramps (design system 3.4). positive is the indigo the web
// calls settled, never green (3.4 removed green on purpose); info is the accent tint the web's done
// banner uses; accent is the one solid fill, the same both themes, like the primary button (R316).
export const BADGE_TONE: Record<Tone, string> = {
  neutral: 'border-ink-200 bg-ink-100 text-ink-700 dark:border-ink-700 dark:bg-ink-800 dark:text-ink-100',
  accent: 'border-signal-400 bg-signal-400 text-ink-950 dark:bg-signal-400 dark:text-ink-950',
  info: 'border-signal-300 bg-signal-50 text-signal-700 dark:border-signal-500 dark:bg-signal-800 dark:text-signal-200',
  attention: 'border-review-edge bg-review-bg text-review-fg dark:border-review-edge-dark dark:bg-review-bg-dark dark:text-review-edge',
  positive: 'border-settled-edge bg-settled-bg text-settled-fg dark:border-settled-edge-dark dark:bg-settled-bg-dark dark:text-settled-edge',
  negative: 'border-rejected-edge bg-rejected-bg text-rejected-fg dark:border-rejected-edge-dark dark:bg-rejected-bg-dark dark:text-rejected-edge',
}

@Component({
  selector: 'tk-badge',
  template: `<ng-content />`,
  host: { '[class]': 'classes()' },
})
export class Badge {
  readonly tone = input<Tone>('neutral')
  readonly classes = computed(() => `inline-flex items-center gap-1 whitespace-nowrap rounded-chip border px-1.5 py-px text-caption ${BADGE_TONE[this.tone()]}`)
}
