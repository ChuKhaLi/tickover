import { Component, computed, input, model } from '@angular/core'
import { PREVIEW_WIDTHS, bandPreview, statusLinePreview, type PreviewSurface, type PreviewWidth, type Previewable } from '../lib/question-preview'
import { Chip } from './chip'

/**
 * What a developer sees for this question. The status line is exact -- it is the
 * contract's own composer at the chosen width. The band is drawn by Claude Code, so
 * this can only approximate its wrapping, and says so.
 */
@Component({
  selector: 'tk-question-preview',
  imports: [Chip],
  template: `
    <div class="mt-4 space-y-2 border-t border-ink-200 pt-4 dark:border-ink-700">
      <div class="flex flex-wrap items-center gap-4">
        <span class="text-small font-medium text-ink-800 dark:text-ink-100">Preview</span>
        <div role="group" aria-label="Where it appears" class="flex gap-2">
          <button type="button" tk-chip [selected]="surface() === 'status'" (click)="surface.set('status')">Status line</button>
          <button type="button" tk-chip [selected]="surface() === 'band'" (click)="surface.set('band')">Band</button>
        </div>
        <div role="group" aria-label="Terminal width in columns" class="flex gap-2">
          @for (w of widths; track w) { <button type="button" tk-chip [selected]="width() === w" (click)="width.set(w)">{{ w }}</button> }
        </div>
      </div>
      @if (preview(); as p) {
        <div class="min-w-0 overflow-x-auto" tabindex="0" role="region" [attr.aria-label]="regionLabel()" [class.opacity-60]="p.placeholder">
          @if (surface() === 'status' || !band()!.draws) {
            <pre data-preview-line class="w-max font-mono text-small text-ink-800 dark:text-ink-100" [style.maxWidth.ch]="width()">{{ status()!.line }}</pre>
          } @else {
            <pre data-preview-band class="w-max whitespace-pre-wrap font-mono text-small text-ink-800 dark:text-ink-100" [style.maxWidth.ch]="width()">{{ bandRows() }}</pre>
          }
        </div>
        <p data-preview-caption class="max-w-[68ch] text-small text-ink-600 dark:text-ink-400">The amount shown is what the developer earns per answer.</p>
        @if (surface() === 'status' && status()!.note) { <p data-preview-note class="max-w-[68ch] text-small text-ink-600 dark:text-ink-400">{{ status()!.note }}</p> }
        @if (surface() === 'band') {
          @if (!band()!.draws) { <p data-preview-note class="max-w-[68ch] text-small text-ink-600 dark:text-ink-400">{{ bandNote() }}</p> }
          <p class="max-w-[68ch] text-small text-ink-600 dark:text-ink-400">Approximate: Claude Code draws the band itself. Only developers with Claude Code's function hooks on see it.</p>
        }
      } @else {
        <p class="max-w-[68ch] text-small text-ink-600 dark:text-ink-400">Add at least two options to see a preview.</p>
      }
    </div>`,
  host: { class: 'block' },
})
export class QuestionPreview {
  preview = input<Previewable | null>(null)
  width = model<PreviewWidth>(80)
  surface = model<PreviewSurface>('status')
  widths = PREVIEW_WIDTHS

  status = computed(() => { const p = this.preview(); return p ? statusLinePreview(p.question, this.width()) : null })
  band = computed(() => { const p = this.preview(); return p ? bandPreview(p.question, this.width()) : null })
  bandRows = computed(() => { const b = this.band(); return b && b.draws ? b.rows.join('\n') : '' })
  regionLabel = computed(() => (this.surface() === 'band' && this.band()?.draws ? 'Band' : 'Status line') + ' preview, ' + this.width() + ' columns')
  bandNote = computed(() => { const b = this.band(); return b && !b.draws ? b.note : '' })
}
