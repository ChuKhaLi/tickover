import { Component, booleanAttribute, computed, input, output } from '@angular/core'

export type BannerKind = 'info' | 'warning' | 'error'
// The web's banner tones (design system 6.5), renamed to what they announce.
export const BANNER_KIND: Record<BannerKind, string> = {
  info: 'border-ink-200 bg-ink-100 text-ink-800 dark:border-ink-700 dark:bg-ink-800 dark:text-ink-100',
  warning: 'border-review-edge bg-review-bg text-review-fg dark:border-review-edge-dark dark:bg-review-bg-dark dark:text-review-edge',
  error: 'border-rejected-edge bg-rejected-bg text-rejected-fg dark:border-rejected-edge-dark dark:bg-rejected-bg-dark dark:text-rejected-edge',
}
const ROLE: Record<BannerKind, 'alert' | 'status'> = { info: 'status', warning: 'alert', error: 'alert' }

@Component({
  selector: 'tk-banner',
  template: `<div class="min-w-0 flex-1"><ng-content /></div>
    @if (dismissible()) {
      <button type="button" class="-my-0.5 rounded-control px-1.5 leading-none opacity-70 hover:opacity-100" aria-label="Dismiss" data-dismiss (click)="dismissed.emit()">&times;</button>
    }`,
  host: { '[class]': 'classes()', '[attr.role]': 'role()' },
})
export class Banner {
  readonly kind = input<BannerKind>('info')
  readonly dismissible = input(false, { transform: booleanAttribute })
  readonly dismissed = output<void>()
  readonly role = computed(() => ROLE[this.kind()])
  readonly classes = computed(() => `flex items-start gap-2 rounded-card border px-3 py-2 text-small ${BANNER_KIND[this.kind()]}`)
}
