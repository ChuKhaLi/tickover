import { Component, computed, inject, signal } from '@angular/core'
import { Router, RouterOutlet } from '@angular/router'
import { Identity } from '../ui/identity'
import { Shell } from '../ui/shell'
import { Money } from '../ui/money'
import { AuthState } from '../lib/auth'
import { ApiService } from '../lib/api'

// Analog makes this the layout route for everything in `pages/app/`, /app/login
// among them, so it carries no `canActivate` of its own: a guard here would send
// a signed-out buyer to a page it also guards. The guard sits on each child
// instead, and `app.page.spec.ts` is what keeps a later task from forgetting one.
//
// One `<tk-shell>` for the whole buyer area, which is also why no page under
// `pages/app/` renders chrome of its own.
const BUYER_LINKS = [
  { href: '/app', label: 'Studies' },
  { href: '/app/studies/new', label: 'New study' },
  { href: '/app/credits', label: 'Credits' },
]
// What a signed-out visitor sees, because /app/login renders inside this layout.
// Offering the three above would be offering three redirects back to where they
// already are.
const PUBLIC_LINKS = [
  { href: '/developers', label: 'For developers' },
  { href: '/buyers', label: 'For buyers' },
]

@Component({
  imports: [Shell, Identity, Money, RouterOutlet],
  template: `
    <tk-shell [links]="links()">
      @if (auth.buyer(); as b) {
        <tk-identity
          slot="right"
          [who]="b.email"
          [busy]="busy()"
          [failed]="failed()"
          failedSays="Couldn't sign you out. Try again."
          (signOut)="logout()"
        >
          <span>credits <tk-money [cents]="b.credit_cents" /></span>
        </tk-identity>
      }
      <router-outlet />
    </tk-shell>`,
})
export default class AppLayout {
  auth = inject(AuthState)
  private api = inject(ApiService)
  private router = inject(Router)
  busy = signal(false)
  failed = signal(false)
  links = computed(() => (this.auth.buyer() ? BUYER_LINKS : PUBLIC_LINKS))

  /**
   * The session is an httpOnly cookie, so only the server can end it. If the
   * request fails the buyer is still signed in, and clearing the principal here
   * would show them signed-out chrome over a session that still works — the same
   * mistake R48 took out of the guards, one layer up.
   */
  async logout(): Promise<void> {
    this.busy.set(true)
    this.failed.set(false)
    try {
      await this.api.buyerLogout()
    } catch {
      this.failed.set(true)
      return
    } finally {
      this.busy.set(false)
    }
    // Cleared before leaving: this signal is a root singleton, so whatever is
    // left in it is what the next account to sign in on this machine would see.
    this.auth.buyer.set(null)
    await this.router.navigateByUrl('/')
  }
}
