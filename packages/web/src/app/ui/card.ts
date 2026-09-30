import { Directive, computed, input } from '@angular/core'

export type CardPad = 'md' | 'lg' | 'none'
/** `quiet` is a hairline and nothing else; `raised` adds the one step design system 5 allows. */
export type CardRank = 'quiet' | 'raised'

const PAD: Record<CardPad, string> = {
  md: 'p-3',
  lg: 'p-4',
  // For a panel that holds its own padded parts -- a list whose rows pad themselves,
  // where padding here would double at every join.
  none: '',
}

const RANK: Record<CardRank, string> = {
  quiet: '',
  raised: 'bg-white dark:bg-ink-800',
}

const ALWAYS = 'rounded-card border border-ink-200 dark:border-ink-700'

/**
 * A directive, for the reason `button.ts` records: the element stays the caller's.
 * A panel is an `<article>`, a `<section>`, a `<li>` or a `<div>` depending on what
 * it holds, and a component that wrapped one would take that choice away and add a
 * host element to every layout that uses it.
 *
 * `rounded-card` is 10px, and that is the whole of what this retires: the app draws
 * this one idea at four different radii today -- the `md`, `lg`, `xl` and `2xl`
 * steps --
 * which reads as four ranks of panel where there is only one. Design system 5 gives
 * radius a scale that grows with how much the element contains, so a panel has one
 * value and a chip has another.
 *
 * There is no elevation prop and there will not be one. Design system 5 puts exactly
 * two levels above the page, a popover and a dialog, and a panel is neither.
 *
 * Both paragraphs above are worded around the utilities they describe rather than
 * naming them: this file is shipped source, Tailwind scans it as text, and the first
 * draft of these comments minted both of them into the bundle -- R47's eighth and
 * ninth firings, one of which dragged an `@property` block in with it. Naming them
 * here to warn about them is how the round before this one minted one of them twice.
 */
@Directive({
  selector: '[tk-card]',
  host: { '[class]': 'classes()' },
})
export class Card {
  pad = input<CardPad>('lg')
  rank = input<CardRank>('quiet')
  classes = computed(() => [ALWAYS, PAD[this.pad()], RANK[this.rank()]].filter(Boolean).join(' '))
}
