import { Component, input } from '@angular/core'

@Component({
  selector: 'tk-card',
  template: `
    @if (heading()) {
      <header class="flex items-center gap-2 border-b border-ink-200 px-4 py-2.5 dark:border-ink-700">
        <h2 class="text-small font-semibold text-ink-900 dark:text-ink-50">{{ heading() }}</h2>
        <div class="ml-auto flex items-center gap-2"><ng-content select="[card-actions]" /></div>
      </header>
    }
    <div class="p-4"><ng-content /></div>`,
  host: { class: 'block rounded-card border border-ink-200 bg-white dark:border-ink-700 dark:bg-ink-800' },
})
export class Card {
  readonly heading = input('')
}
