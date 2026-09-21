import { Component, inject, signal } from '@angular/core'
import { FormsModule } from '@angular/forms'
import { Banner } from '../../ui/banner'
import { Button } from '../../ui/button'
import { Field } from '../../ui/field'
import { Input } from '../../ui/input'
import { PageHeader } from '../../ui/page-header'
import { Router } from '@angular/router'
import type { RouteMeta } from '@analogjs/router'
import { ApiService, ApiError } from '../../lib/api'
import { AuthState } from '../../lib/auth'
import { SITE_NAME } from '../../lib/page-meta'

// No guard: this is the page `adminGuard` sends a signed-out operator to.
export const routeMeta = { title: `${SITE_NAME} — Operator sign in` } satisfies RouteMeta

/**
 * What a rejected sign-in says. The server answers a wrong email, a wrong
 * password and a wrong code with a byte-identical 401 on purpose (no account or
 * password oracle), so this page must not narrow it either.
 */
const REJECTED = 'Wrong email, password, or code.'
/**
 * And what anything else says. Reporting an outage as bad credentials is the
 * failure this branch keeps landing on in the other direction: it sends the
 * operator to re-check a password that was never the problem. The server's own
 * status code is what separates the two, so saying which is not an oracle.
 */
const UNREACHABLE = "Couldn't reach the server. Nothing was signed in; try again."

@Component({
  imports: [FormsModule, PageHeader, Field, Input, Button, Banner],
  template: `
    <mw-page-header heading="Operator sign in" />
    <!-- The three boxes were labelled by their placeholders and nothing else, which
         design system 6.5 retires: a placeholder is gone the moment someone types,
         so it cannot be the only label, and on this form the third box is the one a
         person is most likely to be staring at with a phone in their other hand. -->
    <form class="mt-6 flex max-w-sm flex-col gap-4" (ngSubmit)="submit()">
      <mw-field label="Email">
        <input mw-input name="email" type="email" autocomplete="username" [(ngModel)]="email" />
      </mw-field>
      <mw-field label="Password">
        <input mw-input name="password" type="password" autocomplete="current-password" [(ngModel)]="password" />
      </mw-field>
      <mw-field label="Authenticator code" hint="The six digits from your authenticator app.">
        <input mw-input name="totp" inputmode="numeric" autocomplete="one-time-code" maxlength="6" [(ngModel)]="totp" />
      </mw-field>
      <button type="submit" data-signin mw-button class="self-start" [disabled]="busy()">Sign in</button>
      @if (error(); as why) { <mw-banner data-error tone="error">{{ why }}</mw-banner> }
    </form>`,
})
export default class AdminLoginPage {
  private api = inject(ApiService)
  private auth = inject(AuthState)
  private router = inject(Router)
  email = ''; password = ''; totp = ''
  busy = signal(false)
  error = signal<string | null>(null)

  /**
   * `AuthState.admin` is a root singleton and the guard is the only thing entitled
   * to set it true. Arriving here means no session has been proved — either the
   * guard just sent us, or the operator asked for the sign-in page — so the claim
   * left in the signal is unverified, and the layout was drawing admin chrome and a
   * sign-out button over it. A session whose cookie has expired but whose signal
   * still says "operator" is exactly the stale case. Cleared here; a real session
   * sets it back on the first guarded navigation.
   */
  constructor() { this.auth.admin.set(false) }

  async submit(): Promise<void> {
    // A TOTP code is good for one 30-second window, so a double submit is not a
    // harmless retry: the second request can arrive after the code has rolled and
    // be refused, overwriting a successful sign-in with a credentials error.
    if (this.busy()) return
    this.busy.set(true)
    this.error.set(null)
    try {
      await this.api.adminLogin({ email: this.email.trim(), password: this.password, totp: this.totp.trim() })
    } catch (e) {
      this.error.set(e instanceof ApiError && e.status === 401 ? REJECTED : UNREACHABLE)
      return
    } finally {
      this.busy.set(false)
    }
    this.auth.admin.set(true)
    await this.router.navigateByUrl('/admin')
  }
}
