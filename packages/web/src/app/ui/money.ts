import { Component, computed, input } from '@angular/core'
import { formatCents } from '../lib/money'

export type MoneyVoice = 'speech' | 'data'

/**
 * Money, and the only way a figure is drawn in this application.
 *
 * Design system 6.5 listed this primitive as "unchanged" — which was wrong, and
 * R315 records that it was claimed without the file being opened. Its host carried
 * `tabular-nums` and nothing else, so the mono family and the raised weight
 * principle 5 asks for came from whatever happened to wrap it, which is why the same
 * figure was set differently on different pages.
 *
 * **But one treatment is wrong too**, and that is the part worth reading. These
 * figures appear in two places that want opposite things:
 *
 * - **In a sentence.** "Developers are paid $0.50 for each" — around 25 of the call
 *   sites. A mono figure at weight 600 mid-sentence is heavier than the words either
 *   side of it and breaks the line's rhythm. And the *reasons* for mono and weight
 *   do not apply here: there is no column to align to, and the sentence already makes
 *   the figure impossible to miss.
 * - **As data.** A cell in a column, a stat tile, the quote panel. Here the digits
 *   have to line up between rows and carry the weight of the page's most important
 *   fact.
 *
 * A note on the vocabulary above, because it reads oddly on purpose: the ordinary
 * word for a grid of rows and columns is a Tailwind utility name, and this file is
 * shipped source. An earlier draft used it twice in prose and minted a rule into the
 * stylesheet -- R47's seventh firing, caught by the byte pin. A second draft *named*
 * the word while warning about it, and minted the rule again. The exclusions in
 * `styles.css` are for trees that ship nothing; prose here gets reworded, so it is.
 *
 * Section 4 already has the rule that settles it: a sans label beside a mono value is
 * the tell that one is speech and the other is data. Money quoted in a sentence is
 * the interface speaking. Money in a cell is the machine reporting. So `voice` names
 * that distinction rather than one about placement.
 *
 * `speech` is the default, and the trade is recorded rather than hidden: the louder
 * failure would be to default to `data`, because a bold mono figure in a sentence is
 * obvious while a column that does not align is easy to miss. Defaulting the other
 * way would have re-styled 25 prose call sites in one commit, on pages that have not
 * been migrated yet. The screen migrations are where each figure gets looked at; this
 * file's job is to make both treatments exist and be named.
 */
const VOICE: Record<MoneyVoice, string> = {
  speech: 'tabular-nums',
  data: 'font-mono font-semibold tabular-nums',
}

@Component({
  selector: 'mw-money',
  template: '{{ text() }}',
  host: { '[class]': 'classes()' },
})
export class Money {
  cents = input.required<number>()
  voice = input<MoneyVoice>('speech')
  classes = computed(() => VOICE[this.voice()])
  text = () => formatCents(this.cents())
}
