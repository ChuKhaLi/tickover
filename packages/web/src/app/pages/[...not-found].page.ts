import { Component } from '@angular/core'
import { RouterLink } from '@angular/router'
import { Link } from '../ui/button'
import { Shell } from '../ui/shell'

/**
 * R313, built. This rendered the words "Not found" and nothing else, inside a shell
 * it passed no links to -- so the one page in the product a visitor reaches by
 * mistake was also the only one with no way forward from it, and its header was
 * empty as well.
 *
 * Design system 2: an empty or failed state is a direction, not a mood. It says what
 * probably happened, in the interface's voice and without apologising, and then names
 * real destinations by what they are rather than offering a bare "go home".
 */
@Component({
  imports: [Shell, RouterLink, Link],
  template: `
    <tk-shell [links]="[{ href: '/data', label: 'Data' }, { href: '/buyers', label: 'For buyers' }, { href: '/app/login', label: 'Buyer sign in' }]">
      <h1 class="text-h1-public text-ink-900 dark:text-ink-50">That address is not a page here</h1>
      <p class="mt-3 max-w-[68ch] text-lead text-ink-600 dark:text-ink-400">It may be an old link, or a typo. Nothing has gone wrong with your account, and nothing you were doing has been lost.</p>
      <ul class="mt-6 max-w-[68ch] space-y-2">
        <li><a tk-link routerLink="/">What Tickover is</a></li>
        <li><a tk-link routerLink="/developers">Get paid to answer one question while Claude works</a></li>
        <li><a tk-link routerLink="/buyers">Ask AI-native developers while their agent works</a></li>
      </ul>
    </tk-shell>`,
})
export default class NotFoundPage {}
