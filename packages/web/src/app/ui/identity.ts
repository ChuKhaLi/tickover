import { Component, input, output } from '@angular/core'
import { Button } from './button'

/**
 * Who you are signed in as, whatever else the chrome shows about you, and the way
 * out. Three byte-near-identical copies in `app.page.ts`, `dev.page.ts` and
 * `admin.page.ts`, and the differences between them were all accidents rather than
 * decisions:
 *
 *   - only `admin` gave the button `disabled:opacity-60`, so on the other two the
 *     control that had just been pressed looked pressable while the request was in
 *     flight -- and the whole reason it is disabled is that the session is an
 *     httpOnly cookie, so a second press cannot help.
 *   - the failure sentence was announced by none of them. It is the one thing on this
 *     strip a person needs told rather than shown, because a failed sign-out leaves
 *     the session live, so it gets `role="alert"`.
 *
 * `failedSays` is an input rather than copy written here because `admin`'s sentence is
 * deliberately different -- it says the session is still live, which matters more for
 * an operator on a shared machine than for a buyer.
 *
 * **No middle dots.** The three copies joined their parts with them, and design
 * system 7 retires that: the middle dot is the status line's mark, put there by the
 * spec, and spending it on page chrome is spending the product's one distinctive
 * typographic device on decoration. Space and wrapping do the same job.
 *
 * The sign-out label stays lower-case `sign out`, which two specs read by text. Worth
 * saying because it looks like an oversight against the rest of this system: it is
 * chrome, not an action a person came to the page to take.
 */
@Component({
  selector: 'mw-identity',
  imports: [Button],
  template: `
    <span>{{ who() }}</span>
    <ng-content />
    <button type="button" data-signout mw-button variant="quiet" size="sm" [disabled]="busy()" (click)="signOut.emit()">sign out</button>
    @if (failed()) {
      <span role="alert" class="text-rejected-fg dark:text-rejected-edge">{{ failedSays() }}</span>
    }
  `,
  host: { class: 'flex flex-wrap items-center gap-x-3 gap-y-1' },
})
export class Identity {
  /** The principal as the person would name themselves: an email, a login, `operator`. */
  who = input.required<string>()
  busy = input(false)
  failed = input(false)
  failedSays = input.required<string>()
  signOut = output<void>()
}
