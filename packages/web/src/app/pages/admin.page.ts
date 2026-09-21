import { Component, computed, inject, signal } from '@angular/core'
import { Router, RouterOutlet } from '@angular/router'
import { Identity } from '../ui/identity'
import { Shell } from '../ui/shell'
import { AuthState } from '../lib/auth'
import { ApiService } from '../lib/api'

// Analog makes this the layout route for everything in `pages/admin/`, and
// `/admin/login` renders inside it, so — like `app.page.ts` and unlike
// `dev.page.ts` — it carries no `canActivate` of its own: a guard here would send
// a signed-out operator to a page it also guards. Every child except the login
// page carries `adminGuard`, and `admin.page.spec.ts` is what keeps a later task
// from adding one that does not.
//
// Hoisted out of the template rather than written there as an array literal: a
// literal is a new array on every change-detection pass, and `links` is a signal
// input compared by reference, so it would report a new value forever. (Tailwind
// scans this comment and mints a utility from any word that is one, so it avoids
// the class names the obvious wording would use -- R47, R64.)
const ADMIN_LINKS = [
  { href: '/admin', label: 'Review' },
  { href: '/admin/system-studies', label: 'System studies' },
  { href: '/admin/developers', label: 'Developers' },
  { href: '/admin/payouts', label: 'Payouts' },
  { href: '/admin/invariants', label: 'Invariants' },
]

@Component({
  imports: [Shell, Identity, RouterOutlet],
  template: `
    <mw-shell [links]="links()">
      @if (auth.admin()) {
        <mw-identity
          slot="right"
          who="operator"
          [busy]="busy()"
          [failed]="failed()"
          failedSays="Couldn't sign you out, so the session is still live. Try again."
          (signOut)="logout()"
        />
      }
      <router-outlet />
    </mw-shell>`,
})
export default class AdminLayout {
  auth = inject(AuthState)
  private api = inject(ApiService)
  private router = inject(Router)
  busy = signal(false)
  failed = signal(false)
  // Nothing but the sign-in page is reachable signed out, so offering the five
  // links there is offering five redirects back to where the operator already is.
  // The signal is set by `adminGuard`, which is the only thing that knows.
  links = computed(() => (this.auth.admin() ? ADMIN_LINKS : []))

  /**
   * The same treatment the buyer's and developer's sign-outs get, and it matters
   * more here: this session approves studies, bans developers and marks money
   * paid. The session is an httpOnly cookie, so only the server can end it, and
   * clearing the principal after a failed request would show signed-out chrome
   * over a session that still works — R48's mistake one layer up.
   */
  async logout(): Promise<void> {
    this.busy.set(true)
    this.failed.set(false)
    try {
      await this.api.adminLogout()
    } catch {
      this.failed.set(true)
      return
    } finally {
      this.busy.set(false)
    }
    // Cleared before leaving: this signal is a root singleton, so whatever is left
    // in it is what the next person to open the admin area on this machine sees.
    this.auth.admin.set(false)
    await this.router.navigateByUrl('/admin/login')
  }
}
