import { Component, inject, signal } from '@angular/core'
import { Router, RouterOutlet } from '@angular/router'
import { Identity } from '../ui/identity'
import { Shell } from '../ui/shell'
import { AuthState } from '../lib/auth'
import { ApiService } from '../lib/api'

// Analog makes this the layout route for everything in `pages/dev/`. Unlike
// `app.page.ts` it wraps no sign-in page — a developer arrives here from
// `tickover web`, which mints a session before the browser opens — so every child
// carries `developerGuard` and there is only one set of links to offer.
// `dev.page.spec.ts` is what keeps a later task from adding an unguarded one.
const DEV_LINKS = [
  { href: '/dev', label: 'Earnings' },
  { href: '/dev/settings', label: 'Settings' },
]

@Component({
  imports: [Shell, Identity, RouterOutlet],
  template: `
    <mw-shell [links]="links">
      @if (auth.developer(); as d) {
        <mw-identity
          slot="right"
          [who]="d.github_login"
          [busy]="busy()"
          [failed]="failed()"
          failedSays="Couldn't sign you out. Try again."
          (signOut)="logout()"
        />
      }
      <router-outlet />
    </mw-shell>`,
})
export default class DevLayout {
  auth = inject(AuthState)
  private api = inject(ApiService)
  private router = inject(Router)
  links = DEV_LINKS
  busy = signal(false)
  failed = signal(false)

  /**
   * The same treatment `app.page.ts` gives the buyer's sign-out, for the same
   * reason: the session is an httpOnly cookie, so only the server can end it, and
   * clearing the principal after a failed request would show signed-out chrome over
   * a session that still works — R48's mistake one layer up.
   */
  async logout(): Promise<void> {
    this.busy.set(true)
    this.failed.set(false)
    try {
      await this.api.devLogout()
    } catch {
      this.failed.set(true)
      return
    } finally {
      this.busy.set(false)
    }
    // Cleared before leaving: this signal is a root singleton, so whatever is left
    // in it is what the next developer to sign in on this machine would see.
    this.auth.developer.set(null)
    await this.router.navigateByUrl('/developers')
  }
}
