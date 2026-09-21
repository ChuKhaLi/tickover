import { Component, input } from '@angular/core'

/**
 * The h1, whatever sits beside it, and whatever acts on the page from the right.
 *
 * Four layouts and four heading sizes become one. The sizes were the worse half: 14
 * screens set their h1 at one stock step and 6 at the one above it, with nothing
 * distinguishing
 * the two groups except which was written first, so a person moving between two admin
 * pages saw the page title change size for no reason they could name. `text-h1-app` is
 * the role token from design system 4 and carries its line height and tracking with
 * it, which is what stops the next copy of this from drifting a third of the way.
 *
 * **The gap below belongs here, not to the page.** Thirteen screens set their own,
 * and between them they set five: `mt-3` on six, `mt-4`, `mt-6` on two, `mt-8`, and
 * nothing at all on three. Nothing distinguished the groups -- a stat grid does not
 * want the title further away than a paragraph does -- so it was the same drift the
 * four heading sizes were, one level up. 16px is the middle of section 5's app scale.
 *
 * There was also a `lead` input, and it is gone. It had no caller and could not have
 * had a correct one: it rendered at `text-lead`, which section 4 gives to the sentence
 * under a *public* h1, and this component is the app h1 -- every app screen's
 * explanatory sentence is `text-small` and quieter than its content on purpose. Its
 * justification argued the shape a feature should take -- "an input rather than a slot
 * because design system 4 allows exactly one per page and an input can be counted; a
 * slot invites two" -- which is a good argument about a thing nobody had asked for.
 * Section 6.5's own rule, that a primitive with no caller is a guess, applies to a
 * primitive's inputs too.
 *
 * Both projections are `select`ed by attribute, so the caller writes ordinary elements
 * and their order in the template does not decide where they land -- a badge written
 * after the action still renders beside the heading.
 */
@Component({
  selector: 'mw-page-header',
  template: `
    <div class="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2">
      <div class="flex items-center gap-3">
        <h1 class="text-h1-app text-ink-900 dark:text-ink-50">{{ heading() }}</h1>
        <ng-content select="[mw-header-aside]" />
      </div>
      <ng-content select="[mw-header-action]" />
    </div>
  `,
  host: { class: 'mb-4 block' },
})
export class PageHeader {
  heading = input.required<string>()
}
