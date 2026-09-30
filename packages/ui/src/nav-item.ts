import { Component, booleanAttribute, computed, input } from '@angular/core'
import { BADGE_TONE } from './badge'
import type { Tone } from './tone'

// The selected state the host app switches on with routerLinkActive="is-active"; exported so the
// contrast suite reads the very string that ships.
export const NAV_ACTIVE = '[&.is-active]:bg-ink-200 [&.is-active]:font-medium [&.is-active]:text-ink-900 dark:[&.is-active]:bg-ink-800 dark:[&.is-active]:text-ink-50'

@Component({
  selector: 'a[tk-nav-item]',
  template: `<span class="flex-1"><ng-content /></span>
    @if (alert()) { <span class="size-2 rounded-full bg-rejected-fg dark:bg-rejected-edge-dark" data-alert aria-label="needs attention"></span> }
    @if (count()) { <span [class]="countClasses()" data-count>{{ count() }}</span> }`,
  host: { class: `flex items-center gap-2 rounded-control px-2.5 py-1.5 text-small text-ink-700 hover:bg-ink-100 dark:text-ink-300 dark:hover:bg-ink-800 ${NAV_ACTIVE}` },
})
export class NavItem {
  readonly count = input<number | null>(null)
  readonly countTone = input<Tone>('neutral')
  readonly alert = input(false, { transform: booleanAttribute })
  readonly countClasses = computed(() => `rounded-chip border px-1.5 text-caption tabular-nums ${BADGE_TONE[this.countTone()]}`)
}
