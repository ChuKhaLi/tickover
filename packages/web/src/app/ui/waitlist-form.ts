import { Component, InjectionToken, inject, input, signal } from '@angular/core'
import { FormsModule } from '@angular/forms'
import { submitWaitlist, WAITLIST_ENDPOINT } from '../lib/waitlist'
import { Banner } from './banner'
import { Button } from './button'
import { Field } from './field'
import { Input } from './input'

// The endpoint and the fetch are injected rather than closed over so a test can
// watch the wire. Reading the component's `audience` input instead leaves a
// hardcoded `audience: 'buyer'` here green, and the mis-tag is unrecoverable: a
// third-party form endpoint keeps only what it was sent.
export const WAITLIST_URL = new InjectionToken<string>('waitlist.url', {
  providedIn: 'root',
  factory: () => WAITLIST_ENDPOINT,
})
export const WAITLIST_FETCH = new InjectionToken<typeof fetch>('waitlist.fetch', {
  providedIn: 'root',
  factory: () => globalThis.fetch.bind(globalThis),
})

@Component({
  selector: 'mw-waitlist-form',
  imports: [FormsModule, Banner, Button, Field, Input],
  template: `
    @if (state() === 'ok') {
      <mw-banner tone="done">You're on the list. We'll email you when it opens.</mw-banner>
    } @else {
      <!-- Stacked rather than one row, and the label is why. This was a
           placeholder-only control -- one of the eleven design system 8 counts, and
           the reason mw-field exists: once someone has typed, a placeholder is gone
           and the control has no accessible name at all. A label people can read,
           sitting above the control, is what a form on a public page should have --
           and a label above an input no longer lines up with a button beside it.

           R47 fired here on the draft of this very sentence, on the adjective for
           something one can see. It is a utility name, and a space after it is all
           the scanner needs.

           The placeholder stays as an example of the shape wanted, which is the only
           job it is allowed to do. -->
      <form class="flex max-w-sm flex-col gap-3" (ngSubmit)="submit()">
        <mw-field label="Email" [error]="state() === 'invalid' ? invalidSays : ''">
          <input mw-input name="email" type="email" required autocomplete="email" [(ngModel)]="email" placeholder="you@company.com" />
        </mw-field>
        <button type="submit" mw-button class="self-start" [disabled]="state() === 'sending'">Join the waitlist</button>
      </form>
      @if (state() === 'failed') { <mw-banner class="mt-3 max-w-sm" tone="error">Couldn't send. Email hello&#64;tickover.dev instead.</mw-banner> }
    }`,
})
export class WaitlistForm {
  private endpoint = inject(WAITLIST_URL)
  private fetchFn = inject(WAITLIST_FETCH)
  audience = input.required<'developer' | 'buyer'>()
  email = ''
  /** Held here rather than written into the template: an apostrophe inside an
   *  Angular string inside this template literal closes the wrong quote. */
  invalidSays = "That email doesn't look right."
  state = signal<'idle' | 'sending' | 'ok' | 'invalid' | 'failed'>('idle')
  async submit(): Promise<void> {
    this.state.set('sending')
    this.state.set(await submitWaitlist(this.fetchFn, this.endpoint, { email: this.email.trim(), audience: this.audience() }))
  }
}
