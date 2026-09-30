import { Directive, computed, input } from '@angular/core'

export type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'quiet'
export type ButtonSize = 'md' | 'sm'

// Written out in full and keyed by the union: the scanner reads text, and a Record stops compiling
// when a variant is added without its classes. Same strings as the web's button (R316).
export const BUTTON_VARIANT: Record<ButtonVariant, string> = {
  primary: 'bg-signal-400 text-ink-950 hover:bg-signal-300',
  secondary: 'border border-ink-500 text-ink-800 hover:bg-ink-100 dark:border-ink-400 dark:text-ink-100 dark:hover:bg-ink-800',
  danger: 'bg-rejected-fg text-white hover:bg-rejected-fg-hover',
  quiet: 'text-signal-600 underline hover:text-signal-700 dark:text-signal-300 dark:hover:text-signal-200',
}
const SIZE: Record<ButtonSize, string> = {
  md: 'min-h-9 rounded-control px-4 py-1.5 text-small font-medium',
  sm: 'min-h-7 rounded-control px-2.5 py-1 text-caption',
}
const ALWAYS =
  'inline-flex cursor-pointer items-center justify-center gap-2 no-underline transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal-600 dark:focus-visible:outline-signal-400'

// A directive on the real control, never a wrapper (R321): forms and specs read .disabled off it.
// It declares its own disabled input so a caller's [disabled] lands here and combines with busy
// instead of being overwritten by it (R601).
@Directive({
  selector: 'button[tk-button], a[tk-button]',
  host: { '[class]': 'classes()', '[attr.disabled]': '(disabled() || busy()) ? "" : null', '[attr.aria-busy]': 'busy() ? "true" : null' },
})
export class Button {
  readonly variant = input<ButtonVariant>('primary')
  readonly size = input<ButtonSize>('md')
  readonly busy = input(false)
  readonly disabled = input(false)
  readonly classes = computed(() => `${ALWAYS} ${SIZE[this.size()]} ${BUTTON_VARIANT[this.variant()]}`)
}
