import { Directive } from '@angular/core'

// Styles its own cells so a page writes plain th/td; the header stays in view in a scrolling main.
@Directive({
  selector: 'table[tk-table]',
  host: {
    class: 'w-full border-collapse text-small [&_th]:sticky [&_th]:top-0 [&_th]:z-10 [&_th]:bg-ink-50 [&_th]:px-2 [&_th]:py-1.5 [&_th]:text-left [&_th]:text-caption [&_th]:text-ink-600 [&_th]:border-b [&_th]:border-ink-300 [&_td]:px-2 [&_td]:py-1.5 [&_td]:border-b [&_td]:border-ink-200 [&_tbody_tr:hover]:bg-ink-100 dark:[&_th]:bg-ink-900 dark:[&_th]:text-ink-400 dark:[&_th]:border-ink-700 dark:[&_td]:border-ink-800 dark:[&_tbody_tr:hover]:bg-ink-800',
  },
})
export class Table {}
