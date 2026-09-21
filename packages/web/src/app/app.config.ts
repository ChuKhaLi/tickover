import { provideHttpClient, withFetch } from '@angular/common/http'
import { ApplicationConfig, inject, provideBrowserGlobalErrorListeners } from '@angular/core'
import { RedirectCommand, Router, TitleStrategy, withInMemoryScrolling, withNavigationErrorHandler, type NavigationError } from '@angular/router'
import { provideFileRouter } from '@analogjs/router'
import { PageMetaTitleStrategy } from './lib/page-title'

/**
 * R48 held that a guard rejecting on a non-401 should fail loudly rather than
 * pretend the visitor is signed out, and left what they actually see to whichever
 * task first owned an error surface. Measured on the built artifact before this
 * existed: /app with the API answering 502 left the browser at `/` with no
 * document body at all and one line in the console. A blank page is not a loud
 * failure — it is the silent one R48 was written against — so the choice is made
 * here rather than passed on again.
 *
 * A `RedirectCommand` turns the rejected navigation into a redirect, carrying the
 * URL that failed so `error.page.ts` can offer it back. The principal is left
 * exactly as it was: only a 401 means signed out, and only a 401 clears it
 * (`lib/auth.ts`). Every route in the app inherits this, which is the point —
 * the developer and admin areas reject the same way.
 *
 * The self-redirect check is not defensive habit: without it, a failure raised
 * while going to /error would send the router back to /error for ever.
 *
 * The error is still written to the console. Returning a `RedirectCommand` stops
 * the router raising `NavigationError` at all — it emits a redirect cancellation
 * instead — so without this line the cause disappears, and R48's requirement was
 * that the failure not be swallowed. An API outage leaves its own 502 in the
 * console; a chunk that failed to load leaves nothing but this.
 */
export function redirectToErrorPage(e: NavigationError): RedirectCommand | undefined {
  console.error(`navigation to ${e.url} failed`, e.error)
  if (e.url.split('?')[0] === '/error') return undefined
  return new RedirectCommand(inject(Router).createUrlTree(['/error'], { queryParams: { from: e.url } }))
}

// No `provideZonelessChangeDetection()` and no `zone.js`: Angular 22 is zoneless
// by default, and `@analogjs/vitest-angular`'s test setup assumes the same (W9).
//
// `anchorScrolling` is what makes the buyers page's `fragment="waitlist"` call to
// action actually move to the form; without it the router sets the fragment and
// nothing scrolls. `provideFileRouter` forwards router features to `provideRouter`.
//
// `scrollPositionRestoration: 'top'` is not a default: RouterScroller normalises
// every option it is not given to 'disabled', so passing only `anchorScrolling`
// left a routed navigation holding the previous page's offset — clicking "For
// buyers" from the bottom of /developers landed 342px down the buyers page,
// measured on the built artifact.
//
// `PageMetaTitleStrategy` retitles the tab per route. Angular's default reads a
// `title` off the route data, which Analog's file routes do not set, so without this
// the tab keeps whichever prerendered title loaded first for the whole session.
//
// `withNavigationErrorHandler` is what stops a rejected guard rendering nothing;
// `redirectToErrorPage` above carries the reasoning.
export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideFileRouter(
      withInMemoryScrolling({ anchorScrolling: 'enabled', scrollPositionRestoration: 'top' }),
      withNavigationErrorHandler(redirectToErrorPage),
    ),
    provideHttpClient(withFetch()),
    { provide: TitleStrategy, useClass: PageMetaTitleStrategy },
  ],
}
