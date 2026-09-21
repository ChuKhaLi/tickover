import { Component, input } from '@angular/core'
import { RouterLink } from '@angular/router'

@Component({
  selector: 'mw-shell',
  imports: [RouterLink],
  template: `
    <div class="min-h-screen flex flex-col">
      <header class="border-b border-ink-200 dark:border-ink-700">
        <nav class="mx-auto max-w-content flex items-center gap-6 px-4 py-3">
          <a routerLink="/" class="font-semibold">tickover</a>
          @for (l of links(); track l.href) { <a [routerLink]="l.href" class="text-small text-ink-600 hover:underline dark:text-ink-400">{{ l.label }}</a> }
          <span class="ml-auto text-small text-ink-600 dark:text-ink-400"><ng-content select="[slot=right]" /></span>
        </nav>
      </header>
      <!-- Two slots, and the outer one is the reason this changed. A page whose hero
           carries the lattice needs a band that reaches both page edges, and the ways
           of breaking out of a centred parent all measure the viewport -- 100vw, or a
           negative margin derived from it -- which on a page with a scrollbar is wider
           than the page and scrolls it sideways. That is the one thing section 6.1
           forbids. So the centring moves inward by one element and the band is simply
           a child of main at its natural width. The centring, the measure and the
           padding are the same values on the same box, one level in, so a page that
           uses only the default slot lays out exactly as before -- one more element
           in the tree, and no change to what it computes to. -->
      <main class="w-full flex-1">
        <ng-content select="[slot=band]" />
        <div class="mx-auto w-full max-w-content px-4 py-8"><ng-content /></div>
      </main>
      <!-- Spec §7's legal minimum is three pages, and a legal page nobody can
           find is not one. This footer is on every public page, so it is the
           only place all three are reachable from without knowing the URL.
           No backtick anywhere in here: one ends the template literal. -->
      <footer class="border-t border-ink-200 px-4 py-4 text-center text-caption text-ink-600 dark:border-ink-700 dark:text-ink-400">
        <!-- Two sentences, not a chain joined by the status line's mark. Design
             system 7 retires that chain: the mark is spec 5.4's, it belongs to the
             one line this product sells, and spending it on footer decoration spends
             the product's only distinctive typographic device. -->
        <p class="mx-auto max-w-[68ch]">The sponsor is shown with every paid question. Tickover never reads your prompts or files.</p>
        <p class="mt-1 flex justify-center gap-4">
          @for (l of legal; track l.href) { <a [routerLink]="l.href" class="hover:underline">{{ l.label }}</a> }
        </p>
      </footer>
    </div>`,
})
export class Shell {
  links = input<Array<{ href: string; label: string }>>([])
  /** Fixed, not an input: these three are on every page or they are on none. */
  legal = [
    { href: '/privacy', label: 'Privacy' },
    { href: '/terms/developers', label: 'Developer terms' },
    { href: '/terms/buyers', label: 'Buyer terms' },
  ]
}
