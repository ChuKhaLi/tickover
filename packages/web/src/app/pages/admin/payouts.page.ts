import { Component, inject, signal } from '@angular/core'
import { DatePipe } from '@angular/common'
import type { RouteMeta } from '@analogjs/router'
import type { z } from 'zod'
import { RULES, type PayoutBatchView } from '@tickover/contract'
import { ApiService } from '../../lib/api'
import { adminGuard } from '../../lib/auth'
import { SITE_NAME } from '../../lib/page-meta'
import { Money } from '../../ui/money'
import { Banner } from '../../ui/banner'
import { Button } from '../../ui/button'
import { Confirm } from '../../ui/confirm'
import { Empty } from '../../ui/empty'
import { PageHeader } from '../../ui/page-header'
import { Figure, Rows } from '../../ui/rows'

export const routeMeta = { title: `${SITE_NAME} — Payouts`, canActivate: [adminGuard] } satisfies RouteMeta

// `PayoutBatchView` reaches the contract's surface as a schema with no companion
// type (R45).
type Batch = z.infer<typeof PayoutBatchView>

/** Stands in for a date the server holds nothing in, so nobody reads the word "null". */
const BLANK = '—'

/**
 * Hands the operator a file. Replaced wholesale in the spec — jsdom has no
 * `createObjectURL`, and what matters is the bytes and the name, not the anchor.
 */
export type SaveAs = (name: string, csv: string) => void

const saveViaAnchor: SaveAs = (name, csv) => {
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }))
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  URL.revokeObjectURL(url)
}

@Component({
  imports: [Money, DatePipe, Confirm, Banner, Button, Empty, PageHeader, Figure, Rows],
  template: `
    <mw-page-header heading="Payouts">
      <button mw-header-action type="button" data-create mw-button size="sm" [disabled]="busy()" (click)="arm({ kind: 'create' })">Create batch</button>
    </mw-page-header>
    <!-- Every figure here comes from RULES. Both of these were literals in the
         draft of this page: the minimum and the account age are the same numbers
         the batch itself filters on, so a literal here is a rule the operator
         reads that the server does not apply (R49). (No backtick in these
         comments: one would end the template literal.) -->
    <p class="mt-3 max-w-[68ch] text-small text-ink-600 dark:text-ink-400">A batch takes every <span class="font-medium">active</span> developer who has saved a PayPal address, whose GitHub account is at least {{ minAgeMonths }} months old, and who has at least <mw-money [cents]="payoutMinCents" /> available. Flagged and banned developers are left out. Download the CSV, pay it by hand in PayPal, then mark the batch paid — or failed, which credits the money back.</p>

    @if (armedFor('create')) {
      <mw-confirm heading="Create a batch: this debits developers before any money moves." action="Create the batch" variant="primary" [busy]="busy()" (go)="create()" (cancel)="disarm()">
        <ul class="mt-1 list-disc space-y-1 pl-5">
          <li>Every developer in the batch has their available balance debited now, days before you pay it. Their earnings page reads <mw-money [cents]="0" /> available from this moment.</li>
          <li>Nothing is sent by us. The batch is a CSV you pay by hand in PayPal.</li>
          <li>If the payment does not go through, Mark failed credits it back. Do not leave a batch unmarked.</li>
        </ul>
      </mw-confirm>
    }

    @if (loadFailed()) { <mw-banner data-load-failed class="mt-3" tone="error">Could not load the batches, so this list may be out of date. Do not create another batch until it loads.</mw-banner> }
    @if (actionFailed(); as why) { <mw-banner data-failed class="mt-3" tone="error">{{ why }}</mw-banner> }

    <table mw-rows class="mt-4">
      <thead><tr><th>Batch</th><th mw-figure>Count</th><th mw-figure>Total</th><th>Created</th><th>Paid</th><th>Failed</th><th></th></tr></thead>
      <tbody>
        @for (b of batches(); track b.batch_id) {
          <tr>
            <td class="font-mono text-caption">{{ b.batch_id }}</td>
            <td mw-figure>{{ b.count }}</td>
            <td mw-figure><mw-money voice="data" [cents]="b.total_cents" /></td>
            <td>{{ b.created_at | date: 'medium' }}</td>
            <td [attr.data-paid-at]="b.batch_id">{{ b.paid_at ? (b.paid_at | date: 'medium') : blank }}</td>
            <td [attr.data-failed-at]="b.batch_id" class="text-rejected-fg dark:text-rejected-edge">{{ b.failed_at ? (b.failed_at | date: 'medium') : blank }}</td>
            <td class="text-right">
              <span class="inline-flex flex-wrap justify-end gap-3">
              @if (b.artifact) { <button type="button" [attr.data-csv]="b.batch_id" mw-button variant="quiet" size="sm" (click)="download(b)">CSV</button> }
              @else if (b.count > 0) { <span class="text-rejected-fg dark:text-rejected-edge">no CSV</span> }
              <!-- A batch is finished either way: paid closes it, failed credits it
                   back. Both claims only match payouts still exported, so offering
                   these on a finished batch offers two buttons that do nothing. -->
              @if (!b.paid_at && !b.failed_at && b.count > 0) {
                <button type="button" data-paid [attr.data-paid-for]="b.batch_id" mw-button variant="quiet" size="sm" [disabled]="busy()" (click)="arm({ kind: 'paid', id: b.batch_id })">Mark paid</button>
                <button type="button" [attr.data-failed-for]="b.batch_id" mw-button variant="quiet" size="sm" [disabled]="busy()" (click)="arm({ kind: 'failed', id: b.batch_id })">Mark failed</button>
              }
              </span>
            </td>
          </tr>
          @if (armedFor('paid', b.batch_id)) {
            <tr><td colspan="7">
              <mw-confirm heading="Mark paid: this records that you have already sent the money." action="Mark paid" variant="primary" [busy]="busy()" (go)="paid(b.batch_id)" (cancel)="disarm()">
                <ul class="mt-1 list-disc space-y-1 pl-5">
                  <li>Do this only once <mw-money [cents]="b.total_cents" /> has actually gone out to {{ b.count }} developers in PayPal.</li>
                  <li>It moves no money. The developers were debited when the batch was created; this closes the batch and cannot be undone.</li>
                </ul>
              </mw-confirm>
            </td></tr>
          }
          @if (armedFor('failed', b.batch_id)) {
            <tr><td colspan="7">
              <mw-confirm heading="Mark failed: this gives the money back to the developers." action="Mark failed" [busy]="busy()" (go)="failed(b.batch_id)" (cancel)="disarm()">
                <ul class="mt-1 list-disc space-y-1 pl-5">
                  <li>Every payout in this batch is credited back, so those developers are picked up by the next run. The batch totals <mw-money [cents]="b.total_cents" /> across {{ b.count }} developers.</li>
                  <li>Do this only if the payment did not go through. It cannot be undone, and paying the CSV afterwards would pay them twice.</li>
                </ul>
              </mw-confirm>
            </td></tr>
          }
        } @empty {
          <!-- "No batches yet." beside a live Create batch button, during the load
               that would have told the operator otherwise, is how a second batch gets
               created (R359). -->
          <tr><td colspan="7">
            @if (loading()) { <p data-loading class="py-3 text-small text-ink-600 dark:text-ink-400">Loading…</p> }
            @else if (!loadFailed()) { <mw-empty says="No batches yet." /> }
          </td></tr>
        }
      </tbody>
    </table>`,
})
export default class PayoutsPage {
  private api = inject(ApiService)
  batches = signal<Batch[]>([])
  armed = signal<{ kind: 'create' } | { kind: 'paid' | 'failed'; id: string } | null>(null)
  busy = signal(false)
  loadFailed = signal(false)
  actionFailed = signal<string | null>(null)
  blank = BLANK
  payoutMinCents = RULES.PAYOUT_MIN_CENTS
  minAgeMonths = RULES.GITHUB_MIN_AGE_MONTHS
  /** Overridden in the spec; see `SaveAs`. */
  saveAs: SaveAs = saveViaAnchor

  constructor() { void this.refresh() }

  /**
   * Armed once, at construction, and never re-armed. That is the whole of the
   * decision R359 records: the loading rung belongs to the first load, and a reload
   * triggered by an action holds the rows that are already on screen.
   *
   * Blanking the list after every approve, reject, ban or batch would lose the
   * operator's place in a queue they are working through, and the rows are still
   * true until the reply says otherwise. A reload that fails is already handled, and
   * better: `loadFailed` raises a banner that says what is below may be out of date,
   * with the rows left up beside it.
   */
  loading = signal(true)

  async refresh(): Promise<void> {
    try {
      this.batches.set(await this.api.adminBatches())
      this.loadFailed.set(false)
    } catch {
      this.loadFailed.set(true)
    } finally {
      this.loading.set(false)
    }
  }

  arm(a: { kind: 'create' } | { kind: 'paid' | 'failed'; id: string }): void {
    this.actionFailed.set(null)
    this.armed.set(a)
  }
  disarm(): void { this.armed.set(null) }
  armedFor(kind: 'create' | 'paid' | 'failed', id?: string): boolean {
    const a = this.armed()
    if (a === null || a.kind !== kind) return false
    return a.kind === 'create' || a.id === id
  }

  async create(): Promise<void> {
    await this.run(async () => { await this.api.adminCreateBatch() }, 'Could not create a batch. Reload before trying again: a batch may have been created and debited.')
  }

  async paid(id: string): Promise<void> {
    await this.run(async () => { await this.api.adminBatchPaid(id) }, 'Could not mark that batch paid. Reload and check whether it went through.')
  }

  async failed(id: string): Promise<void> {
    await this.run(async () => { await this.api.adminBatchFailed(id) }, 'Could not mark that batch failed. The developers may not have been credited back; reload and check.')
  }

  download(b: Batch): void { this.saveAs(`${b.batch_id}.csv`, b.artifact ?? '') }

  private async run(call: () => Promise<void>, whenFailed: string): Promise<void> {
    if (this.busy()) return
    this.busy.set(true)
    this.actionFailed.set(null)
    try {
      await call()
    } catch {
      this.actionFailed.set(whenFailed)
      return
    } finally {
      this.busy.set(false)
      this.armed.set(null)
    }
    await this.refresh()
  }
}
