import { Component, ElementRef, afterRenderEffect, inject, input } from '@angular/core'
import { Badge } from './badge'

let seq = 0

/** The one look for a text control, applied by the caller to input/select/textarea. */
export const CONTROL = 'w-full rounded-control border border-ink-500 bg-white px-2.5 py-1.5 text-small text-ink-900 placeholder:text-ink-500 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-signal-600 dark:border-ink-400 dark:bg-ink-900 dark:text-ink-50 dark:focus-visible:outline-signal-400'

@Component({
  selector: 'tk-field',
  imports: [Badge],
  template: `
    <label [attr.for]="id" class="mb-1 flex items-center gap-2 text-small font-medium text-ink-800 dark:text-ink-100">
      {{ label() }}
      @if (secretState() === 'set') { <tk-badge tone="positive">saved</tk-badge> }
      @if (secretState() === 'unset') { <tk-badge tone="attention">not set</tk-badge> }
    </label>
    <ng-content />
    @if (error()) {
      <p [id]="id + '-msg'" class="mt-1 text-caption text-rejected-fg dark:text-rejected-edge">{{ error() }}</p>
    } @else if (hint()) {
      <p [id]="id + '-msg'" class="mt-1 text-caption text-ink-600 dark:text-ink-400">{{ hint() }}</p>
    }`,
  host: { class: 'block' },
})
export class Field {
  readonly label = input.required<string>()
  readonly hint = input('')
  readonly error = input('')
  readonly secretState = input<'set' | 'unset' | null>(null)
  readonly id = `tk-field-${++seq}`
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef)

  constructor() {
    // Wires whatever control was projected, so callers write a plain input/select/textarea.
    afterRenderEffect(() => {
      const el = this.host.nativeElement.querySelector('input, select, textarea')
      if (!el) return
      el.id = this.id
      if (this.error() || this.hint()) el.setAttribute('aria-describedby', `${this.id}-msg`)
      else el.removeAttribute('aria-describedby')
      if (this.error()) el.setAttribute('aria-invalid', 'true')
      else el.removeAttribute('aria-invalid')
    })
  }
}
