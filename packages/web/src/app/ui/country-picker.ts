import { Component, computed, input, model, signal } from '@angular/core'
import { countryName, filterCountries } from '../lib/countries'
import { Input } from './input'

let seq = 0

/**
 * Countries by name, not by code. The field it replaces took free text, and UK --
 * the code people type -- is not the code any developer carries, so a study could
 * target nobody without a word. This can only emit codes from filterCountries,
 * which only knows the contract's list.
 *
 * ARIA 1.2 combobox: focus stays in the text field, the active option is named by
 * aria-activedescendant. Enter is taken here and never reaches the form, whose
 * submit sends a study for review.
 */
@Component({
  selector: 'tk-country-picker',
  imports: [Input],
  template: `
    <div class="space-y-2">
      @if (value().length) {
        <ul class="flex flex-wrap gap-2" aria-label="Selected countries">
          @for (c of value(); track c) {
            <li class="inline-flex items-center gap-1 rounded-chip bg-signal-400 py-1 pl-3 pr-1 text-small text-ink-950">
              {{ name(c) }}
              <button type="button" class="rounded-chip px-1.5 focus-visible:outline-2 focus-visible:outline-signal-600" [attr.aria-label]="'Remove ' + name(c)" [disabled]="disabled()" (click)="remove(c)">×</button>
            </li>
          }
        </ul>
      }
      <div class="relative max-w-md">
        <label [for]="id" class="mb-1 block text-small font-medium text-ink-800 dark:text-ink-100">Search countries</label>
        <p [id]="id + '-count'" class="mb-1 text-small text-ink-600 dark:text-ink-400">{{ value().length ? value().length + ' of ' + cap() + ' selected' : 'Up to ' + cap() + ' countries.' }}</p>
        <input tk-input role="combobox" aria-autocomplete="list" autocomplete="off" [id]="id" [attr.aria-describedby]="id + '-count'" [attr.aria-controls]="id + '-list'" [attr.aria-expanded]="open()" [attr.aria-activedescendant]="open() && results().length ? optionId(results()[active()]!) : null" [disabled]="disabled()" [value]="query()" (input)="onInput($event)" (keydown)="onKey($event)" (focus)="onFocus()" (blur)="open.set(false)" placeholder="Search by name or code" />
        <!-- Always in the DOM: a live region has to exist before its text does, or a reader misses the first message. -->
        <p role="status" aria-live="polite" [class]="status() ? 'px-3 py-1.5 text-small text-ink-600 dark:text-ink-400' : ''">{{ status() }}</p>
        @if (open() && results().length) {
          <ul role="listbox" aria-multiselectable="true" [id]="id + '-list'" aria-label="Countries" class="absolute z-10 mt-1 max-h-64 w-full overflow-auto rounded-control border border-ink-500 bg-white py-1 text-small dark:border-ink-400 dark:bg-ink-800">
            @for (c of results(); track c; let i = $index) {
              <li role="option" [id]="optionId(c)" [attr.aria-selected]="value().includes(c)" [attr.aria-disabled]="full() && !value().includes(c) ? 'true' : null" (mousedown)="$event.preventDefault(); toggle(c)" class="flex cursor-pointer justify-between gap-4 px-3 py-1.5" [class.bg-ink-100]="i === active()" [class.dark:bg-ink-700]="i === active()">
                <span>{{ value().includes(c) ? '✓ ' : '' }}{{ name(c) }}</span><span class="font-mono text-ink-600 dark:text-ink-400">{{ c }}</span>
              </li>
            }
          </ul>
        }
      </div>
    </div>`,
  host: { class: 'block' },
})
export class CountryPicker {
  value = model<string[]>([])
  cap = input.required<number>()
  disabled = input(false)

  readonly id = `tk-country-${++seq}`
  query = signal('')
  open = signal(false)
  active = signal(0)
  results = computed(() => filterCountries(this.query()))
  full = computed(() => this.value().length >= this.cap())
  // Outside the listbox: ARIA 1.2 lets it hold only options, and a polite status line is what a reader announces.
  status = computed(() => {
    if (!this.open()) return ''
    const none = this.results().length ? '' : 'No country matches.'
    const capped = this.full() ? this.cap() + ' of ' + this.cap() + ' selected; remove one to add another.' : ''
    return [none, capped].filter(Boolean).join(' ')
  })

  name(c: string) { return countryName(c) }
  optionId(c: string) { return `${this.id}-opt-${c}` }

  /**
   * Whether the buyer has typed or moved through the list since focus or the last pick.
   * Enter picks the active option only then: the first option is highlighted the moment
   * the list opens, so a stray Enter on focus would otherwise add a country nobody chose.
   */
  private intent = false

  onFocus() { this.intent = false; this.open.set(true) }

  onInput(e: Event) {
    this.query.set((e.target as HTMLInputElement).value)
    this.active.set(0)
    this.open.set(true)
    // Clearing the text is not a choice: the first option is still only the default row.
    this.intent = this.query() !== ''
  }

  onKey(e: KeyboardEvent) {
    const n = this.results().length
    if (e.key === 'ArrowDown') { e.preventDefault(); this.open.set(true); this.intent = true; this.active.set(n ? (this.active() + 1) % n : 0) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); this.intent = true; this.active.set(n ? (this.active() - 1 + n) % n : 0) }
    else if (e.key === 'Enter') {
      e.preventDefault()
      const c = this.results()[this.active()]
      if (this.open() && c && this.intent && this.toggle(c)) { this.query.set(''); this.active.set(0); this.intent = false }
    }
    else if (e.key === 'Escape') this.open.set(false)
    else if (e.key === 'Backspace' && !this.query() && this.value().length) this.remove(this.value()[this.value().length - 1]!)
  }

  /** True when the selection changed, so Enter keeps the query when the cap refused the pick. */
  toggle(c: string): boolean {
    if (this.value().includes(c)) { this.remove(c); return true }
    if (this.full()) return false
    this.value.set([...this.value(), c])
    return true
  }

  remove(c: string) { this.value.set(this.value().filter((x) => x !== c)) }
}
