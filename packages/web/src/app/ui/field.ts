import { Component, computed, contentChild, effect, input } from '@angular/core'
import { Input as MwInput } from './input'

let seq = 0

/**
 * A label, a control, and at most one of a hint or an error — with the wiring
 * between them done here rather than by whoever remembers.
 *
 * The rule this exists to enforce is design system section 8: every control has a
 * real `<label>`, and a placeholder is never the only label. Eleven inputs across
 * this application are placeholder-only today, `/app/login`'s among them, which is
 * a control with no accessible name at all once the field has text in it.
 *
 * The hint and the error are announced through `aria-describedby` rather than
 * being merely adjacent, and the error replaces the hint rather than stacking with
 * it: two descriptions on one control is two things read out before the person can
 * type, and the error is the one that matters while it is showing.
 *
 * The control is projected rather than rendered, so the caller keeps the element —
 * its `type`, its template reference, its `required`, its `autocomplete`. See
 * `button.ts` for why that is not negotiable in this codebase.
 */
@Component({
  selector: 'tk-field',
  template: `
    <label [attr.for]="id" class="flex flex-col gap-1.5">
      <span class="text-small font-medium text-ink-800 dark:text-ink-100">{{ label() }}</span>
      <ng-content />
    </label>
    @if (error()) {
      <p [id]="id + '-msg'" class="mt-1.5 max-w-[68ch] text-small text-rejected-fg dark:text-rejected-edge">{{ error() }}</p>
    } @else if (hintLines().length) {
      <p [id]="id + '-msg'" class="mt-1.5 max-w-[68ch] text-small text-ink-600 dark:text-ink-400">@for (line of hintLines(); track $index) { <span class="block">{{ line }}</span> }</p>
    }`,
  host: { class: 'block' },
})
export class Field {
  label = input.required<string>()
  /** One description; a list is its lines, each on its own row, and still one aria-describedby target. */
  hint = input<string | string[]>('')
  hintLines = computed(() => [this.hint()].flat().filter(Boolean))
  error = input<string>('')

  /** Stable within a render, and unique across fields on a page. */
  readonly id = `tk-field-${++seq}`

  private control = contentChild(MwInput)

  constructor() {
    effect(() => {
      const el = this.control()?.el.nativeElement
      if (!el) return
      // Set rather than bound: the control belongs to the caller's template, so
      // there is no binding to put these on without taking the element over.
      el.setAttribute('id', this.id)
      const described = this.error() || this.hintLines().length
      if (described) el.setAttribute('aria-describedby', `${this.id}-msg`)
      else el.removeAttribute('aria-describedby')
      // A field in error says so to assistive technology, not only in colour.
      if (this.error()) el.setAttribute('aria-invalid', 'true')
      else el.removeAttribute('aria-invalid')
    })
  }
}
