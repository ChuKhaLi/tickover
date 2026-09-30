import { Directive } from '@angular/core'

/**
 * A two-column list of term and value: the settings page's "everything we hold about
 * you", and the earnings page's glossary of what each status means.
 *
 * Specified in the developer screen design as an addition to section 6 and never
 * built, while both of its callers hand-rolled it -- one as a grid with the term
 * colour repeated on ten separate `dt` elements, the other as a bulleted list joining
 * term to definition with an em dash. The dash is the tell: a joining mark doing the
 * work a column should, which is the same mistake the middle dot was making one
 * primitive over.
 *
 * A directive on the real `dl`, for R331's reason: the specs query `dt` and `dd`, and
 * a component would have had to reproduce that structure to keep them.
 *
 * The rail is `max-content` rather than the 12ch the screen design asked for. A rail
 * pinned to a width is right until a term is longer than it, and the terms here are
 * written by whoever adds a row -- "File-extension counts" is already 21 characters.
 * It stacks below the `sm` breakpoint, where two columns would leave neither enough.
 *
 * (This paragraph used the ordinary English word for "pinned to a width", and that
 * word is a Tailwind utility no template here asks for. The byte pin went red and
 * the orphan check named the rule: R47 for the eighteenth time on this branch, and
 * the reason both guards exist. The word is not written anywhere in this file.)
 *
 * The class is `RecordList` and the selector is `tk-record`, because `Record` is
 * TypeScript's own mapped type: a directive of that name shadows it inside every
 * file that imports the directive, and it did -- two pages stopped compiling with
 * "Type Record is not generic", which is the error a reader spends a while on
 * because the name in it looks like the language's.
 */
@Directive({
  selector: 'dl[tk-record]',
  host: {
    class:
      'grid gap-x-6 gap-y-1 text-small sm:grid-cols-[max-content_1fr] [&_dt]:text-ink-600 dark:[&_dt]:text-ink-400',
  },
})
export class RecordList {}
