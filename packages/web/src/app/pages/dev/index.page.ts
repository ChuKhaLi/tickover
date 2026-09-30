import { Component, inject, signal } from '@angular/core'
import { DatePipe } from '@angular/common'
import { RouterLink } from '@angular/router'
import type { RouteMeta } from '@analogjs/router'
import { HistoryRow, RULES } from '@tickover/contract'
import { ApiService } from '../../lib/api'
import { AuthState, developerGuard } from '../../lib/auth'
import { SITE_NAME } from '../../lib/page-meta'
import { Money } from '../../ui/money'
import { Async } from '../../ui/async'
import { Banner } from '../../ui/banner'
import { Button, Link } from '../../ui/button'
import { PageHeader } from '../../ui/page-header'
import { Figure, Rows } from '../../ui/rows'
import { RecordList } from '../../ui/record'
import { Stat } from '../../ui/stat'

export const routeMeta = { title: `${SITE_NAME} — Earnings`, canActivate: [developerGuard] } satisfies RouteMeta

/**
 * What each status the contract can send means to the person being paid. A `Record`
 * over the enum rather than a lookup with a default, so a status added to
 * `HistoryRow` breaks this build instead of reaching a developer as a bare word
 * with nothing beside it — the `study-badge.ts` idiom, applied to money.
 *
 * `released` is the one that has to be careful, and being careful here does not
 * mean saying "not paid yet". A row's status is derived only from ledger entries
 * whose ref is `answer:<id>` (`developer-history.ts`); a payout writes
 * `payout:<id>`, so **a paid-out answer keeps reading `released` for ever**. Copy
 * saying released money is still waiting is therefore false the moment a payout
 * runs, and false in the worst direction: it tells someone who has been paid that
 * they are still owed. Measured against Postgres with a real admin batch —
 * available 2500 → 0 with the row's status unchanged.
 *
 * The first fix sent the developer to the Available balance instead, and that is
 * only true outside one window. `createPayoutBatch` debits `available` when the
 * batch is **exported**; `markBatchPaid` never touches the ledger. On the manual
 * CSV adapter those are days apart, so between them the balance reads zero for
 * money that has not been sent. Neither the column nor the balance answers "have
 * I been paid", and there is no developer payouts endpoint to ask — so the note
 * says all of that rather than picking whichever figure is wrong less often.
 *
 * `index.page.spec.ts` pins this note to the byte. It has been wrong twice; a
 * reword is a decision that has to be made in the test as well.
 */
const STATUS_NOTE: Record<HistoryRow['status'], string> = {
  pending: 'credited when you answered, and held until that study closes.',
  released: 'cleared out of pending when that study closed. The row goes on saying released once that money is in a payout run, so this column cannot tell you whether you have been paid — and nor can the Available balance above, which drops to zero as soon as a run is exported, days before the money is sent. This page does not show payout runs yet.',
  reversed: 'taken back when the study closed, because the answer did not pass its quality checks.',
  unpaid: 'nothing was owed: an unpaid profile question, or an answer with no entry against it yet.',
}

@Component({
  imports: [Money, DatePipe, RouterLink, Async, Banner, Button, Link, PageHeader, Figure, Rows, Stat, RecordList],
  template: `
    @if (auth.developer(); as d) {
      <tk-page-header heading="Earnings" />
      <div class="grid gap-4 sm:grid-cols-3">
        <tk-stat label="Pending" hint="Answered, and held until those studies close.">
          <tk-money voice="data" [cents]="d.balance_pending_cents" />
        </tk-stat>
        <tk-stat label="Available" hint="Cleared, and waiting for the next monthly payout run.">
          <tk-money voice="data" [cents]="d.balance_available_cents" />
        </tk-stat>
        <tk-stat label="Today" hint="Paid answers today. The count starts again at 00:00 UTC.">
          {{ d.today_paid_answers }} / {{ maxPaid }}
        </tk-stat>
      </div>
      <!-- Both figures come from RULES, never typed in (R49): a payout minimum and
           an account-age rule are configuration, and copy that states them as
           literals goes on claiming the old ones after they change. -->
      <p class="mt-3 max-w-[68ch] text-small text-ink-600 dark:text-ink-400">Paid by PayPal, monthly, once your available balance reaches <tk-money [cents]="payoutMinCents" />.
        @if (!d.payout_method) { <a tk-link routerLink="/dev/settings">Set your PayPal email in Settings</a>. }
        @if (!d.can_cash_out) { Your GitHub account has to be {{ minAgeMonths }} months old before a first payout; earnings accrue until then. }
      </p>
      <!-- R515: neither balance above can describe this state -- it left pending when
           the study closed and left available when the run exported, so a payout
           PayPal could not deliver reads as zero on both cards unless a notice says
           where the money actually is. -->
      <!-- unclaimed_email is the address the money was actually sent to, frozen on the payout
           row at batch creation -- not payout_method.email, which is whatever address the
           developer has saved SINCE, and may no longer be where this money is sitting. -->
      @if (d.unclaimed_cents > 0 && d.unclaimed_email) {
        <tk-banner data-unclaimed class="mt-3 max-w-[68ch]" tone="info"><tk-money [cents]="d.unclaimed_cents" /> is waiting for you at PayPal under {{ d.unclaimed_email }}. Sign in to PayPal with that address, or create an account with it, within 30 days to receive it.</tk-banner>
      }
      @if (d.payout_method_needs_confirm) {
        <tk-banner data-needs-confirm class="mt-3 max-w-[68ch]" tone="error">PayPal could not deliver your last payout, so the money is back in your balance. <a tk-link routerLink="/dev/settings">Check your PayPal email and save it again</a> to receive the next run.</tk-banner>
      }

      <h2 class="mt-8 text-h2 text-ink-900 dark:text-ink-50">History</h2>
      <tk-async
        class="mt-2"
        [failed]="failed()"
        [loading]="loading()"
        [empty]="rows().length === 0"
        failedSays="Couldn't load your history. Reload the page to try again."
        emptySays="No answers yet. Answer a question in your status line and it shows up here."
      >
        <table tk-rows>
          <thead><tr><th>When</th><th>Sponsor</th><th>Study</th><th tk-figure>Amount</th><th>Status</th></tr></thead>
          <tbody>
            <!-- Keyed by position, not by content. Two answers can share a
                 millisecond -- that collision is the whole reason R36 made the cursor
                 compound -- and a buyer picks their own study title, so no pair of
                 the fields here is unique enough to key on. Rows only ever arrive by
                 being appended, so a position is stable for as long as one is drawn. -->
            @for (r of rows(); track $index) {
              <tr>
                <td>{{ r.answered_at | date: 'medium' }}</td>
                <td>{{ r.sponsor }}</td>
                <!-- Parentheses rather than the middle dot (design system 7). The mark belongs
                     to the line this product sells and to nothing else, and a cell with two
                     things in it is what a parenthesis is for. -->
                <td>{{ r.study_title }}@if (r.kind === 'profile') { <span class="text-ink-600 dark:text-ink-400"> (profile question)</span> }</td>
                <td tk-figure><tk-money voice="data" [cents]="r.cents" /></td>
                <td>{{ r.status }}</td>
              </tr>
            }
          </tbody>
        </table>
        @if (cursor()) {
          <button type="button" tk-button variant="secondary" size="sm" data-more class="mt-3" [disabled]="busy()" (click)="more()">Load more</button>
        }
        @if (moreFailed()) { <tk-banner class="mt-2" tone="error">Couldn't load the next page. Try again.</tk-banner> }
        <!-- A record, not a list joined by an em dash. The dash was a mark doing the
             work a column should do, which is the same mistake the middle dot was
             making one primitive over; and this is the most-read prose on the page,
             because it is where a developer finds out why money they are owed left a
             balance days before it arrived. -->
        <dl tk-record data-statuses class="mt-6 max-w-[68ch]">
          @for (s of statuses; track s) { <dt [attr.data-status]="s">{{ s }}</dt><dd>{{ note(s) }}</dd> }
        </dl>
      </tk-async>
    }`,
})
export default class EarningsPage {
  auth = inject(AuthState)
  private api = inject(ApiService)

  maxPaid = RULES.MAX_PAID_PER_DAY
  payoutMinCents = RULES.PAYOUT_MIN_CENTS
  minAgeMonths = RULES.GITHUB_MIN_AGE_MONTHS
  statuses = HistoryRow.shape.status.options
  note(status: HistoryRow['status']): string { return STATUS_NOTE[status] }

  rows = signal<HistoryRow[]>([])
  /** Whatever the last page's `next_cursor` was. Opaque (R36): never read, only returned. */
  cursor = signal<string | null>(null)
  loading = signal(true)
  failed = signal(false)
  busy = signal(false)
  moreFailed = signal(false)

  constructor() { void this.firstPage() }

  /**
   * A rejected load has to say so. Left to fall through, the page renders an empty
   * history, and "you have answered nothing" is a money claim on this screen —
   * the developer's own record of what they are owed.
   */
  private async firstPage(): Promise<void> {
    try {
      const h = await this.api.devHistory()
      this.rows.set(h.rows)
      this.cursor.set(h.next_cursor)
    } catch {
      this.failed.set(true)
    } finally {
      this.loading.set(false)
    }
  }

  /**
   * The in-flight check is not habit. `[disabled]` repaints a change-detection pass
   * later than the click that set it, so two quick clicks both reach here, both
   * fetch the same cursor, and both results are appended — the developer sees those
   * answers, and those amounts, listed twice.
   *
   * A failure leaves the cursor alone, so the button stays and the page says the
   * next page did not arrive rather than looking like the end of the history.
   */
  async more(): Promise<void> {
    const c = this.cursor()
    if (!c || this.busy()) return
    this.busy.set(true)
    this.moreFailed.set(false)
    try {
      const h = await this.api.devHistory(c)
      this.rows.update((rows) => [...rows, ...h.rows])
      this.cursor.set(h.next_cursor)
    } catch {
      this.moreFailed.set(true)
    } finally {
      this.busy.set(false)
    }
  }
}
