import { Component, inject, signal } from '@angular/core'
import { DatePipe } from '@angular/common'
import { FormsModule } from '@angular/forms'
import type { RouteMeta } from '@analogjs/router'
import { DeveloperStatusInput } from '@tickover/contract'
import { ApiError, ApiService, type AdminDeveloper } from '../../lib/api'
import { adminGuard } from '../../lib/auth'
import { SITE_NAME } from '../../lib/page-meta'
import { Banner } from '../../ui/banner'
import { Empty } from '../../ui/empty'
import { Button } from '../../ui/button'
import { Chip } from '../../ui/chip'
import { Input } from '../../ui/input'
import { PageHeader } from '../../ui/page-header'
import { Rows } from '../../ui/rows'
import { Confirm } from '../../ui/confirm'

export const routeMeta = { title: `${SITE_NAME} — Developers`, canActivate: [adminGuard] } satisfies RouteMeta

type Status = 'active' | 'flagged' | 'banned'

/** Stands in for a value the server holds nothing in, so nobody reads the word "null". */
const BLANK = '—'

/**
 * The bound the server enforces, read off the schema rather than retyped. Without
 * it the box takes any length and the save comes back a 400 the page reports as a
 * generic failure — after the operator has typed the reason twice.
 */
const REASON_MAX = DeveloperStatusInput.shape.reason.unwrap().maxLength ?? 200

@Component({
  imports: [FormsModule, DatePipe, Confirm, Chip, Banner, Button, Empty, Input, PageHeader, Rows],
  template: `
    <mw-page-header heading="Developers" />
    <!-- What each status actually does, because none of it is guessable from the
         word. Flagged in particular reads like a note-to-self and is not one: a
         payout batch only pays developers whose status is active, so flagging
         stops the money going out while the developer carries on answering and
         earning it. Settlement also flags on its own, for repeated attention-check
         failures. (No backtick in these comments: one would end the template
         literal, and the compiler would point at the decorator instead.) -->
    <p class="mt-3 max-w-[68ch] text-small text-ink-600 dark:text-ink-400">
      <span class="font-medium">Active</span> answers and is paid.
      <span class="font-medium">Flagged</span> still answers and still earns, but is left out of every payout run until reinstated — settlement flags on repeated attention-check failures.
      <span class="font-medium">Banned</span> cannot answer at all: the command-line token stops working and browser sessions end. A developer who deleted their own account is banned too, with the reason recorded as "deleted by user".
      A reason stays on the row after a reinstatement, marked as past, so the record of why survives it.
    </p>

    <div class="mt-3 flex gap-2">
      @for (t of tabs; track t) {
        <button type="button" mw-chip [selected]="tab() === t" [attr.data-tab]="t" (click)="load(t)">{{ t }}</button>
      }
    </div>

    @if (loadFailed()) { <mw-banner data-load-failed class="mt-3" tone="error">Could not load the {{ tab() }} developers, so this list may be out of date or incomplete.</mw-banner> }
    @if (actionFailed(); as why) { <mw-banner data-failed class="mt-3" tone="error">{{ why }}</mw-banner> }

    <table mw-rows class="mt-4">
      <thead><tr><th>Login</th><th>Status</th><th>Reason</th><th>Country</th><th>Tier</th><th>Last seen</th><th></th></tr></thead>
      <tbody>
        @for (d of rows(); track d.id) {
          <tr>
            <td>{{ d.github_login }}</td>
            <td>{{ d.status }}</td>
            <td [attr.data-reason-cell]="d.id">{{ reasonLabel(d) }}</td>
            <td>{{ d.country }}</td>
            <td>{{ d.activity_tier }}</td>
            <td>{{ (d.last_seen_at | date: 'medium') ?? blank }}</td>
            <!-- All three are quiet, including Ban. They arm a confirmation; they
                 do not do anything. The destructive treatment belongs to the button
                 that actually bans, which is inside the panel below, and painting
                 this one red as well says "destructive" twice for one act. -->
            <td class="text-right">
              <span class="inline-flex flex-wrap justify-end gap-3">
                @if (d.status !== 'active') { <button type="button" [attr.data-reinstate]="d.id" mw-button variant="quiet" size="sm" [disabled]="busy()" (click)="arm(d.id, 'active')">Reinstate</button> }
                @if (d.status !== 'flagged') { <button type="button" [attr.data-flag]="d.id" mw-button variant="quiet" size="sm" [disabled]="busy() || !reason(d.id)" (click)="arm(d.id, 'flagged')">Flag</button> }
                @if (d.status !== 'banned') { <button type="button" [attr.data-ban]="d.id" mw-button variant="quiet" size="sm" [disabled]="busy() || !reason(d.id)" (click)="arm(d.id, 'banned')">Ban</button> }
              </span>
            </td>
          </tr>
          <tr class="border-none">
            <td colspan="7" class="pb-3">
              <!-- One reason per developer, beside the developer. A single shared box
                   under the list is how the last person's wording ends up recorded
                   against this one. -->
              <!-- An accessible name rather than a shown label: the design system forbids
                   a placeholder being the only label, and fifty labels down a grid of rows
                   would be worse than the defect. The name says which developer, because
                   that is what a person reading it out of context needs.

                   Two words are avoided on purpose here, and the first draft of this
                   comment used both: the one for a shown element and the one for a grid
                   of rows are each a utility name, and Tailwind minted both (R47). -->
              <input mw-input size="sm" class="max-w-md" [name]="'reason' + d.id" [attr.name]="'reason' + d.id" [attr.data-reason]="d.id" [attr.aria-label]="'Reason, recorded against ' + d.github_login" [(ngModel)]="reasons[d.id]" [attr.maxlength]="reasonMax" placeholder="reason, recorded against this developer ({{ reasonMax }} characters)" />

              @if (armedFor(d.id, 'flagged')) {
                <mw-confirm heading="Flag {{ d.github_login }}: this quietly stops their payouts." action="Flag" [busy]="busy()" (go)="set(d.id, 'flagged', d.status)" (cancel)="disarm()">
                  <ul class="mt-1 list-disc space-y-1 pl-5">
                    <li>They go on answering and go on earning, and nothing on their earnings page says anything is wrong.</li>
                    <li>They are left out of every payout run for as long as they are flagged, so the money accumulates unpaid.</li>
                    <li>Recorded against them: {{ reason(d.id) }}</li>
                  </ul>
                </mw-confirm>
              }
              @if (armedFor(d.id, 'banned')) {
                <mw-confirm heading="Ban {{ d.github_login }}: this ends the account." action="Ban" [busy]="busy()" (go)="set(d.id, 'banned', d.status)" (cancel)="disarm()">
                  <ul class="mt-1 list-disc space-y-1 pl-5">
                    <li>Their command-line token stops working and every browser session ends, so they cannot answer again.</li>
                    <li>They are left out of every payout run, so anything they are owed stays unpaid until someone reinstates them.</li>
                    <li>Recorded against them: {{ reason(d.id) }}</li>
                  </ul>
                </mw-confirm>
              }
              @if (armedFor(d.id, 'active')) {
                <mw-confirm heading="Reinstate {{ d.github_login }}: this undoes the {{ d.status }}." action="Reinstate" variant="primary" [busy]="busy()" (go)="set(d.id, 'active', d.status)" (cancel)="disarm()">
                  <ul class="mt-1 list-disc space-y-1 pl-5">
                    <li>They answer and are paid again, including anything that accumulated while they were {{ d.status }}.</li>
                    <li>Read the reason before you do it: {{ d.flag_reason ?? blank }}</li>
                    <li>"deleted by user" is a developer who asked to be deleted, not a developer to bring back. Reinstating one puts an account they asked to close back into payout runs.</li>
                    <li>The reason is kept on the row afterwards, marked as past, so the record of why survives this.</li>
                  </ul>
                </mw-confirm>
              }
            </td>
          </tr>
        } @empty {
          <tr><td colspan="7">
            @if (loading()) { <p data-loading class="py-3 text-small text-ink-600 dark:text-ink-400">Loading…</p> }
            @else if (!loadFailed()) { <mw-empty says="No {{ tab() }} developers." /> }
          </td></tr>
        }
      </tbody>
    </table>`,
})
export default class DevelopersPage {
  private api = inject(ApiService)
  tabs: Status[] = ['flagged', 'banned', 'active']
  tab = signal<Status>('flagged')
  rows = signal<AdminDeveloper[]>([])
  reasons: Record<string, string> = {}
  armed = signal<{ id: string; status: Status } | null>(null)
  busy = signal(false)
  loadFailed = signal(false)
  actionFailed = signal<string | null>(null)
  blank = BLANK
  reasonMax = REASON_MAX

  constructor() { void this.load('flagged') }

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

  async load(t: Status): Promise<void> {
    this.tab.set(t)
    this.armed.set(null)
    try {
      this.rows.set(await this.api.adminDevelopers(t))
      this.loadFailed.set(false)
    } catch {
      // Emptied, unlike the review queue: the header says which status this is, so
      // rows left from the previous tab would be shown under the wrong label.
      this.rows.set([])
      this.loadFailed.set(true)
    } finally {
      this.loading.set(false)
    }
  }

  /**
   * The server keeps `flag_reason` through a reinstatement now, so an active
   * developer can carry one. Unlabelled it would read as a live flag on a row
   * whose status column says active; "was" is what makes it a record rather than
   * a contradiction.
   */
  reasonLabel(d: AdminDeveloper): string {
    if (!d.flag_reason) return BLANK
    return d.status === 'active' ? `was: ${d.flag_reason}` : d.flag_reason
  }

  reason(id: string): string { return (this.reasons[id] ?? '').trim() }
  arm(id: string, status: Status): void { this.actionFailed.set(null); this.armed.set({ id, status }) }
  disarm(): void { this.armed.set(null) }
  armedFor(id: string, status: Status): boolean {
    const a = this.armed()
    return a !== null && a.id === id && a.status === status
  }

  /**
   * Reached only from the confirmation panel, and `expected` is the status on the row
   * that panel was opened from -- the optimistic-concurrency claim the server checks.
   * It cannot be derived from `status`: any status moves to any other here, so a claim
   * built from the target would always be true and the lost update would be back.
   *
   * A 409 is not a failed write, it is a stale view, and it is the one case where
   * "try again" is wrong advice: the same click would make the same claim.
   */
  async set(id: string, status: Status, expected: Status): Promise<void> {
    const reason = this.reason(id)
    if (status !== 'active' && !reason) return
    if (this.busy()) return
    this.busy.set(true)
    this.actionFailed.set(null)
    try {
      await this.api.adminSetStatus(id, status, expected, status === 'active' ? undefined : reason)
    } catch (e) {
      this.actionFailed.set(e instanceof ApiError && e.status === 409
        ? 'That developer changed since you loaded this list — someone else got there first. Nothing was changed; reload to see where they are now.'
        : `Could not set that developer to ${status}. Nothing was changed; reload and try again.`)
      return
    } finally {
      this.busy.set(false)
      this.armed.set(null)
    }
    await this.load(this.tab())
  }
}
