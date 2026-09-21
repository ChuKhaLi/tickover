import { Component, inject, signal } from '@angular/core'
import type { RouteMeta } from '@analogjs/router'
import { ApiService } from '../../lib/api'
import { SITE_NAME } from '../../lib/page-meta'
import { Banner } from '../../ui/banner'
import { Button } from '../../ui/button'
import { Field } from '../../ui/field'
import { PageHeader } from '../../ui/page-header'
import { Input } from '../../ui/input'

// No guard here, and none on the layout either: this page is a child of
// `app.page.ts`, and a guard on the parent would bounce a signed-out buyer at
// the page they were being sent to. Every other page under /app carries
// `canActivate: [buyerGuard]` of its own, which `app.page.spec.ts` enforces.
//
// `PAGE_META` is the prerender list and takes no other keys, so the tab title
// for an app route lives here and `PageMetaTitleStrategy` falls through to it.
export const routeMeta = { title: `${SITE_NAME} — Sign in` } satisfies RouteMeta

@Component({
  imports: [Banner, Button, Field, Input, PageHeader],
  template: `
    <!-- The page header, as the operator sign-in already does: this is a door into
         the app rather than a public document, so it takes the app h1 role and the
         heading comes from one place. No backtick in this comment -- one ends the
         template literal, and the compiler then points at the decorator. -->
    <mw-page-header heading="Sign in" />
    <!-- "30 minutes" mirrors LOGIN_LINK_MINUTES in the server's
         buyer-auth.controller.ts, which this package cannot import and no contract
         constant carries, so nothing turns red if the server changes it and this
         line goes on claiming the old TTL. Both ends are named here so the next
         person can find them; whether the value belongs in the contract is with
         the whole-branch review. -->
    @if (sent()) {
      <mw-banner tone="done" class="mt-5 max-w-md">Check your email for the sign-in link. It works once and expires in 30 minutes.</mw-banner>
    } @else {
      <p class="mt-2 max-w-[68ch] text-ink-800 dark:text-ink-100">We email you a link. There is no password to lose.</p>
      <form class="mt-6 flex max-w-md flex-col items-start gap-4" (submit)="submit($event, email.value)">
        <mw-field label="Work email" hint="The address your team already uses. We never sell it on." class="w-full">
          <input mw-input #email name="email" type="email" required autocomplete="email" placeholder="you@company.com" />
        </mw-field>
        <button mw-button type="submit" [disabled]="busy()">Email me a link</button>
      </form>
      @if (failed()) {
        <mw-banner tone="error" class="mt-4 max-w-md">Couldn't send the link. Try again in a minute.</mw-banner>
      }
    }`,
})
export default class LoginPage {
  private api = inject(ApiService)
  sent = signal(false)
  busy = signal(false)
  failed = signal(false)

  /**
   * Reads the address off the element rather than through `ngModel`: inside an
   * `<form>` the model is wired a microtask after the first render, so a submit
   * in that window sends an empty address, and the whole of `@angular/forms`
   * would be pulled into this chunk to no other end.
   *
   * This is also why `mw-input` is a directive rather than a component that wraps
   * an input: the template reference above has to land on the control itself.
   *
   * The message is the same whether or not the address has an account — the
   * endpoint answers `{ ok: true }` either way, and saying more here would give
   * anyone a way to ask whether a company has a Tickover account.
   */
  async submit(event: Event, email: string): Promise<void> {
    event.preventDefault()
    if (this.busy()) return
    this.busy.set(true)
    this.failed.set(false)
    try {
      // Lower-cased to match the server, which keys the buyer row on the
      // lower-cased address; sending it as typed mints a second, empty account.
      await this.api.requestBuyerLink(email.trim().toLowerCase())
      this.sent.set(true)
    } catch {
      this.failed.set(true)
    } finally {
      this.busy.set(false)
    }
  }
}
