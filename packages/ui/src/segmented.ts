import { Component, computed, input, output } from '@angular/core'

export interface SegmentedOption<T extends string> { value: T; label: string }

export const SEGMENTED_ON = 'bg-ink-800 text-ink-50 dark:bg-ink-100 dark:text-ink-900'
const SEGMENTED_OFF = 'text-ink-700 hover:bg-ink-100 dark:text-ink-300 dark:hover:bg-ink-800'

@Component({
  selector: 'tk-segmented',
  template: `
    <div role="radiogroup" [attr.aria-label]="label()" (keydown)="key($event)" class="inline-flex rounded-control border border-ink-300 p-0.5 dark:border-ink-600">
      @for (o of options(); track o.value) {
        <button type="button" role="radio" [attr.aria-checked]="o.value === value()" [attr.tabindex]="o.value === value() ? 0 : -1"
          [class]="shape + (o.value === value() ? on : off)" (click)="valueChange.emit(o.value)">{{ o.label }}</button>
      }
    </div>`,
})
export class Segmented<T extends string> {
  readonly options = input.required<SegmentedOption<T>[]>()
  readonly value = input.required<T>()
  readonly label = input('')
  readonly valueChange = output<T>()
  protected readonly shape = 'rounded-chip px-2.5 py-1 text-caption '
  protected readonly on = SEGMENTED_ON
  protected readonly off = SEGMENTED_OFF
  private readonly index = computed(() => this.options().findIndex((o) => o.value === this.value()))
  key(e: KeyboardEvent) {
    const step = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0
    if (!step) return
    e.preventDefault()
    const n = this.options().length
    const at = (this.index() + step + n) % n
    this.valueChange.emit(this.options()[at]!.value)
    // Focus the target by position: the checked state has not been re-rendered yet, so it cannot be queried.
    ;(e.currentTarget as HTMLElement).querySelectorAll<HTMLElement>('[role=radio]')[at]?.focus()
  }
}
