import { Component, computed, inject } from '@angular/core'
import { toSignal } from '@angular/core/rxjs-interop'
import { ActivatedRoute, Router, RouterLink } from '@angular/router'
import type { RouteMeta } from '@analogjs/router'
import { Link } from '../ui/button'
import { Shell } from '../ui/shell'
import { SITE_NAME } from '../lib/page-meta'

export const routeMeta = { title: `${SITE_NAME} — Not answering` } satisfies RouteMeta

/**
 * Where `redirectToErrorPage` in `app.config.ts` sends a navigation the router
 * could not finish. Before this page existed, a guard rejecting on a 502 left the
 * browser at `/` with an empty document — measured on the built artifact — which
 * is the silent failure R48 was written against.
 *
 * The copy is careful about two things. It does not say "signed out", because a
 * non-401 is not one and `lib/auth` deliberately leaves the principal alone; and
 * it does not blame the visitor, because the measured cause is our service being
 * unreachable.
 */
@Component({
  imports: [Shell, RouterLink, Link],
  template: `
    <mw-shell [links]="[{ href: '/developers', label: 'For developers' }, { href: '/buyers', label: 'For buyers' }]">
      <h1 class="text-h1-public text-ink-900 dark:text-ink-50">Tickover is not answering</h1>
      <p class="mt-3 max-w-[68ch]">That page needs the Tickover service, and it did not respond. This is our side, not yours: you have not been signed out, and nothing you had entered has been sent anywhere.</p>
      @if (retry(); as target) {
        <p class="mt-4"><a mw-link [routerLink]="target">Try that page again</a></p>
      }
      <p class="mt-4 text-small text-ink-600 dark:text-ink-400">If it keeps happening, email hello&#64;tickover.dev.</p>
    </mw-shell>`,
})
export default class ErrorPage {
  private readonly router = inject(Router)
  private readonly route = inject(ActivatedRoute)

  /**
   * The query param as a signal, not `snapshot` read in the constructor. Angular's
   * default `RouteReuseStrategy` keeps this component instance across a second
   * navigation to the same `routeConfig`, so a constructor read leaves the retry
   * link pointing at whichever page failed *first* while the address bar shows the
   * second — measured, `/app` then `/app/credits` both offering `/app` back. That
   * is worse than offering nothing: it sends the visitor somewhere they did not ask
   * for and reports it as a retry.
   *
   * `computed` keeps the "parsed once" property that mattered: `parseUrl` returns a
   * fresh tree each call, so calling it per change detection would hand `routerLink`
   * a new input every cycle. It now runs once per value of `from` instead.
   *
   * A `from` naming somewhere off-site cannot become an open redirect — `routerLink`
   * navigates within the app, so the worst a hand-written one does is fail to match.
   */
  private readonly params = toSignal(this.route.queryParamMap, { initialValue: this.route.snapshot.queryParamMap })

  readonly retry = computed(() => {
    const from = this.params().get('from')
    return from ? this.router.parseUrl(from) : null
  })
}
