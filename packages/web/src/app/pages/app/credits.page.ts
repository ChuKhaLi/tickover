import { Component, effect, inject, signal } from '@angular/core'
import type { RouteMeta } from '@analogjs/router'
import { SITE, type BuyerSelf, type PaymentView } from '@tickover/contract'
import type { z } from 'zod'
import { ApiService } from '../../lib/api'
import { AuthState, buyerGuard } from '../../lib/auth'
import { SITE_NAME } from '../../lib/page-meta'
import { Async } from '../../ui/async'
import { Link } from '../../ui/button'
import { Money } from '../../ui/money'
import { PageHeader } from '../../ui/page-header'
import { Figure, Rows } from '../../ui/rows'

// Guarded per page, not on the layout -- see `app.page.ts`.
export const routeMeta = { title: `${SITE_NAME} — Credits`, canActivate: [buyerGuard] } satisfies RouteMeta

type Buyer = z.infer<typeof BuyerSelf>

/**
 * No checkout any more (R500): a study the balance does not cover waits for an invoice on its own
 * page. Credit is what settlement refunds and overpayments leave behind, and it is spent first.
 */
@Component({
  imports: [Async, Figure, Link, Money, PageHeader, Rows],
  template: `
    <tk-page-header heading="Credits" />
    <p class="mt-3 max-w-[68ch] text-ink-800 dark:text-ink-100">
      @if (lastBuyer(); as b) { Balance: <tk-money [cents]="b.credit_cents" />. } @else { Balance unknown. }
      Credit comes from refunds for invalid or unfilled responses, and from any overpayment. It is used first on your next study.
    </p>
    <p class="mt-3 max-w-[68ch] text-small text-ink-600 dark:text-ink-400">Unused credit is refunded on request. Email <a tk-link [href]="'mailto:' + contact">{{ contact }}</a>.</p>

    <h2 class="mt-8 text-h3 text-ink-900 dark:text-ink-50">Payments received</h2>
    <tk-async
      class="mt-3"
      [failed]="paymentsFailed()"
      [loading]="paymentsList() === null"
      [empty]="(paymentsList() ?? []).length === 0"
      failedSays="Couldn't load your payments. Reload the page to try again."
      emptySays="No payments yet."
    >
      <!-- A record, not a list joined by punctuation: the middle dot belongs to
           the replica and nothing else (design system 7), and a row with three
           fields is what a column is for. -->
      <table tk-rows class="max-w-[68ch]">
        <thead><tr><th>Date</th><th>Reference</th><th tk-figure>Amount</th></tr></thead>
        <tbody>
          @for (p of paymentsList() ?? []; track p.id) {
            <tr data-payment><td>{{ p.recorded_at.slice(0, 10) }}</td><td>{{ p.reference }}</td><td tk-figure><tk-money voice="data" [cents]="p.cents" />@if (p.reversed_cents > 0) { refunded <tk-money voice="data" [cents]="p.reversed_cents" /> }</td></tr>
          }
        </tbody>
      </table>
    </tk-async>`,
})
export default class CreditsPage {
  auth = inject(AuthState)
  private api = inject(ApiService)
  contact = SITE.CONTACT_EMAIL
  paymentsList = signal<PaymentView[] | null>(null)
  paymentsFailed = signal(false)
  /** The last balance the server confirmed; survives a lost session (see the history of this page). */
  lastBuyer = signal<Buyer | null>(null)

  constructor() {
    this.lastBuyer.set(this.auth.buyer())
    effect(() => { const b = this.auth.buyer(); if (b) this.lastBuyer.set(b) })
    void this.api.payments().then((p) => this.paymentsList.set(p), () => this.paymentsFailed.set(true))
  }
}
