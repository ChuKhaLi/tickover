import { Component, inject, signal } from '@angular/core'
import { RouterLink } from '@angular/router'
import { DatePipe } from '@angular/common'
import type { RouteMeta } from '@analogjs/router'
import type { StudyView } from '@tickover/contract'
import { ApiService } from '../../lib/api'
import { buyerGuard } from '../../lib/auth'
import { SITE_NAME } from '../../lib/page-meta'
import { Async } from '../../ui/async'
import { Button, Link } from '../../ui/button'
import { Money } from '../../ui/money'
import { PageHeader } from '../../ui/page-header'
import { Figure, Rows } from '../../ui/rows'
import { StudyBadge } from '../../ui/study-badge'

// The guard is per page, not on the layout route — see `app.page.ts` for why,
// and `app.page.spec.ts` for the check that every page here keeps one.
export const routeMeta = { title: `${SITE_NAME} — Studies`, canActivate: [buyerGuard] } satisfies RouteMeta

/**
 * The server sends these newest first already. Sorting again is not distrust of
 * it: it makes "newest first" a property of the page, testable against rows in
 * any order, rather than an arrangement two packages have to keep agreeing on.
 */
function newestFirst(studies: StudyView[]): StudyView[] {
  return [...studies].sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))
}

@Component({
  imports: [RouterLink, DatePipe, Async, Button, Link, Money, PageHeader, Figure, Rows, StudyBadge],
  template: `
    <tk-page-header heading="Studies">
      <a tk-header-action tk-button size="sm" routerLink="/app/studies/new">New study</a>
    </tk-page-header>

    <!-- The ladder is tk-async's rather than this page's, and the order is why: a
         rejected load leaves the list null, so a hand-rolled rung that asked
         "no studies?" first would tell a buyer they have none while the request
         was what failed. Seven screens each got that right separately. -->
    <tk-async
      class="mt-6"
      [failed]="failed()"
      [loading]="studies() === null"
      [empty]="(studies() ?? []).length === 0"
      failedSays="Couldn't load your studies. Reload the page to try again."
      emptySays="No studies yet."
    >
      <p tk-empty-action class="mt-1 text-small text-ink-600 dark:text-ink-400"><a tk-link routerLink="/app/studies/new">Create your first study</a>; it runs at cost.</p>
      <table tk-rows>
        <thead><tr><th>Title</th><th>State</th><th tk-figure>Per answer</th><th tk-figure>Respondents</th><th>Created</th></tr></thead>
        <tbody>
          @for (s of studies() ?? []; track s.id) {
            <tr>
              <td><a [routerLink]="['/app/studies', s.id]" class="font-medium hover:underline">{{ s.title }}</a></td>
              <td><tk-study-badge [state]="s.state" /></td>
              <td tk-figure><tk-money voice="data" [cents]="s.price_cents" /></td>
              <td tk-figure>{{ s.respondents_completed }} / {{ s.target_count }}</td>
              <td>{{ s.created_at | date: 'mediumDate' }}</td>
            </tr>
          }
        </tbody>
      </table>
    </tk-async>`,
})
export default class StudiesPage {
  private api = inject(ApiService)
  studies = signal<StudyView[] | null>(null)
  failed = signal(false)

  // A rejected load used to leave the page saying "Loading…" for as long as the
  // buyer was willing to wait for an answer that was never coming.
  constructor() {
    void this.api.buyerStudies().then(
      (s) => this.studies.set(newestFirst(s)),
      () => this.failed.set(true),
    )
  }
}
