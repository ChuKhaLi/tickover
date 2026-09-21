import { ApplicationRef, Component } from '@angular/core'
import { TestBed } from '@angular/core/testing'
import { bootstrapApplication } from '@angular/platform-browser'
import { NavigationError, Router, provideRouter } from '@angular/router'
import { describe, it, expect, vi } from 'vitest'
import { App } from './app'
import { appConfig, redirectToErrorPage } from './app.config'
import { ApiError, ApiService } from './lib/api'
import { AuthState } from './lib/auth'
import { buyerGuard } from './lib/auth'
import ErrorPage, { routeMeta as errorRouteMeta } from './pages/error.page'

const BUYER = { id: '8f0b0f2e-6f6a-4a3a-9c1f-0f1e2d3c4b5a', email: 'pm@acme.test', org: null, credit_cents: 1234, first_study_used: false }

@Component({ template: '<h1>Studies</h1>' })
class Guarded {}

/**
 * The navigation error handler is a `provideRouter` feature, and TestBed supplying
 * its own `provideRouter` is green with the feature deleted from `app.config.ts` —
 * the same blind spot the scrolling and title tests in `landing.spec.ts` are
 * arranged around. So this boots the real config the way `main.ts` does.
 *
 * `ApiService` is replaced rather than the HTTP backend: that leaves `AuthState`,
 * `buyerGuard` and the handler all running for real, which is the chain the built
 * artifact was measured on.
 */
async function underRealAppConfig(
  buyerMe: () => Promise<unknown>,
  body: (ctx: { router: Router; auth: AuthState; host: HTMLElement; render: () => Promise<void> }) => Promise<void>,
) {
  document.body.appendChild(document.createElement('mw-root'))
  const app = await bootstrapApplication(App, {
    providers: [appConfig.providers, { provide: ApiService, useValue: { buyerMe } }],
  })
  try {
    const router = app.injector.get(Router)
    const appRef = app.injector.get(ApplicationRef)
    router.resetConfig([
      { path: 'app', component: Guarded, canActivate: [buyerGuard] },
      // A second guarded route, so a failure can arrive from somewhere other than
      // the first. Task 5 adds the real one; until then only this notices that the
      // error page is reused across the two.
      { path: 'app/credits', component: Guarded, canActivate: [buyerGuard] },
      { path: 'error', component: ErrorPage, ...errorRouteMeta },
    ])
    const render = async () => {
      await appRef.whenStable()
      await new Promise((ok) => setTimeout(ok, 0))
    }
    await body({ router, auth: app.injector.get(AuthState), host: document.querySelector('mw-root')!, render })
  } finally {
    app.destroy()
    document.querySelector('mw-root')?.remove()
  }
}

describe('app config', () => {
  // The measured failure this replaces: /app against a 502 left the browser at `/`
  // with an empty document and `ERROR Ct: api 502` in the console. Nothing on the
  // page said anything, which is why "the guard rejects loudly" was not true.
  it('sends a navigation the API broke to a page that says so', async () => {
    await underRealAppConfig(
      async () => { throw new ApiError(502, { error: 'bad_gateway' }) },
      async ({ router, auth, host, render }) => {
        auth.buyer.set(BUYER)
        await router.navigateByUrl('/app')
        await render()

        expect(router.url).toBe('/error?from=%2Fapp')
        expect(host.textContent).toContain('Tickover is not answering')
        // The guarded page must not have rendered behind the message.
        expect(host.textContent, 'the guarded page rendered anyway').not.toContain('Studies')
        // R48's other half: a 502 is not a sign-out, and the visitor must not be
        // told it was. The principal survives and the copy does not claim otherwise.
        expect(auth.buyer(), 'a 502 signed the buyer out').toMatchObject({ id: BUYER.id })
        expect(host.textContent).toContain('you have not been signed out')
        // The URL that failed comes back as something to click. Resolved, not the
        // attribute: under `bootstrapApplication` with no `<base>` the attribute is
        // written absolute, and an `a[href="/app"]` selector reads as "missing".
        const retry = Array.from(host.querySelectorAll('a')).find((a) => a.textContent?.includes('Try that page again'))
        expect(retry, 'no way back to the page that failed').toBeTruthy()
        expect(new URL(retry!.href).pathname).toBe('/app')
      },
    )
  })

  // Angular's default RouteReuseStrategy keeps the error page's component instance
  // across a second failure, because the routeConfig is the same. A `from` read once
  // in the constructor therefore goes stale: the address bar updates and the retry
  // link does not, so the visitor clicks "try again" and is sent to the page that
  // failed *before* the one they were on. One navigation cannot see this, which is
  // how it got past the four tests above.
  it('offers the page that just failed, not the one before it', async () => {
    await underRealAppConfig(
      async () => { throw new ApiError(502, { error: 'bad_gateway' }) },
      async ({ router, host, render }) => {
        const retryTarget = async () => {
          const link = Array.from(host.querySelectorAll('a')).find((a) => a.textContent?.includes('Try that page again'))
          expect(link, 'no retry link rendered').toBeTruthy()
          return new URL(link!.href).pathname
        }

        await router.navigateByUrl('/app')
        await render()
        expect(router.url).toBe('/error?from=%2Fapp')
        expect(await retryTarget()).toBe('/app')

        await router.navigateByUrl('/app/credits')
        await render()
        expect(router.url, 'the second failure did not reach the error page').toBe('/error?from=%2Fapp%2Fcredits')
        expect(await retryTarget(), 'the retry link is still pointing at the first failure').toBe('/app/credits')
      },
    )
  })

  // Non-vacuity for the test above: the same arrangement with a working API has to
  // reach the guarded page, or "did not render Studies" would mean nothing.
  it('leaves a navigation the API answered alone', async () => {
    await underRealAppConfig(
      async () => BUYER,
      async ({ router, host, render }) => {
        await router.navigateByUrl('/app')
        await render()
        expect(router.url).toBe('/app')
        expect(host.textContent).toContain('Studies')
        expect(host.textContent).not.toContain('Tickover is not answering')
      },
    )
  })

  // Returning a RedirectCommand stops the router raising NavigationError at all, so
  // the cause would otherwise vanish — R48 asked for a failure that is not
  // swallowed, and the page saying so is only half of that.
  it('writes the cause to the console on its way past', () => {
    TestBed.configureTestingModule({ providers: [provideRouter([])] })
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      const boom = new ApiError(502, { error: 'bad_gateway' })
      TestBed.runInInjectionContext(() => redirectToErrorPage(new NavigationError(1, '/app', boom)))
      expect(spy).toHaveBeenCalledWith('navigation to /app failed', boom)
    } finally {
      spy.mockRestore()
    }
  })

  // Without this the error page failing would send the router back to the error
  // page, for ever. Asserted on the handler directly because arranging a failure
  // inside the error page needs the loop it is there to prevent.
  it('does not redirect the error page at itself', () => {
    TestBed.configureTestingModule({ providers: [provideRouter([])] })
    const result = TestBed.runInInjectionContext(() =>
      redirectToErrorPage(new NavigationError(1, '/error?from=%2Fapp', new Error('boom'))),
    )
    expect(result).toBeUndefined()
    // And the ordinary case still redirects, so the check above is a check and not
    // a handler that has stopped doing anything.
    const ordinary = TestBed.runInInjectionContext(() =>
      redirectToErrorPage(new NavigationError(2, '/app/credits', new Error('boom'))),
    )
    expect(ordinary?.redirectTo.toString()).toBe('/error?from=%2Fapp%2Fcredits')
  })
})
