import { Component, inject, signal } from '@angular/core'
import { DatePipe } from '@angular/common'
import { FormsModule } from '@angular/forms'
import { Router } from '@angular/router'
import type { RouteMeta } from '@analogjs/router'
import { RULES, type DataSummary } from '@tickover/contract'
import { ApiService, ApiError } from '../../lib/api'
import { AuthState, developerGuard } from '../../lib/auth'
import { DERIVED_LIST, NEVER_LIST, SENT_LIST } from '../../lib/disclosure'
import { SITE_NAME } from '../../lib/page-meta'
import { Banner } from '../../ui/banner'
import { Button } from '../../ui/button'
import { Card } from '../../ui/card'
import { Field } from '../../ui/field'
import { Input } from '../../ui/input'
import { Money } from '../../ui/money'
import { PageHeader } from '../../ui/page-header'
import { RecordList } from '../../ui/record'

export const routeMeta = { title: `${SITE_NAME} — Settings`, canActivate: [developerGuard] } satisfies RouteMeta

/** Stands in for a field the server holds nothing in, so nobody reads the word "null". */
const BLANK = '—'

@Component({
  imports: [Money, DatePipe, FormsModule, Banner, Button, Card, Field, Input, PageHeader, RecordList],
  template: `
    <mw-page-header heading="Settings" />

    <section class="">
      <h2 class="text-h2 text-ink-900 dark:text-ink-50">Payout</h2>
      <p class="mt-1 text-small text-ink-600 dark:text-ink-400">Paid by PayPal, monthly, once your available balance reaches <mw-money [cents]="payoutMinCents" />.</p>
      <!-- The label is new, and this was a placeholder-only control: the address a
           developer is paid at, with no accessible name at all once it had text in
           it. Design system 8 counts eleven of these; two of them were on this page.
           A label above the control means the button goes below it rather than
           beside it (R347). -->
      <form class="mt-3 flex max-w-md flex-col gap-3" (ngSubmit)="savePayout()">
        <mw-field label="PayPal email" [error]="saveFailed() ?? ''">
          <input mw-input name="paypal" type="email" autocomplete="email" [(ngModel)]="paypalEmail" placeholder="you@example.com" />
        </mw-field>
        <button type="submit" data-save mw-button class="self-start" [disabled]="!paypalEmail.trim() || saving()">Save</button>
      </form>
      @if (saved()) { <mw-banner class="mt-3 max-w-md" tone="done">Saved.</mw-banner> }
    </section>

    <section class="mt-10">
      <h2 class="text-h2 text-ink-900 dark:text-ink-50">Your data</h2>
      <!-- Spec §5.5's three lists, which the consent screen and this page have to
           carry identically. They now come from the contract's DISCLOSURE, the one
           source all four surfaces read; settings.page.spec.ts still reads
           this page and the public one and pins both against literals, because a
           spec built from the same constant would follow a narrowed list down.
           No backtick anywhere in here: one ends the template literal. -->
      <p class="mt-2 max-w-[68ch] text-small"><span class="font-medium">Sent from your machine:</span> your {{ sentList }}.</p>
      <p class="mt-2 max-w-[68ch] text-small"><span class="font-medium">Derived on our side, not sent by the plugin:</span> {{ derivedList }}. Buyers can target on both.</p>
      <p class="mt-2 max-w-[68ch] text-small"><span class="font-medium">Never collected:</span> {{ neverList }}.</p>

      @if (dataFailed()) {
        <mw-banner class="mt-3" tone="error">Couldn't load the values below. The three lists above still hold; reload the page to see what is in them.</mw-banner>
      } @else if (data(); as d) {
        <dl mw-record class="mt-3">
          <dt>GitHub login</dt><dd data-field="github_login">{{ d.github_login }}</dd>
          <dt>Operating system</dt><dd data-field="os">{{ d.os ?? blank }}</dd>
          <dt>Claude Code version</dt><dd data-field="tool_version">{{ d.tool_version ?? blank }}</dd>
          <dt>Country, from your IP</dt><dd data-field="country">{{ d.country }}</dd>
          <dt>Activity tier</dt><dd data-field="activity_tier">{{ tier() }}</dd>
          <dt>File-extension counts</dt><dd data-field="language_mix">@for (e of entries(d.language_mix); track e[0]) {<span class="mr-3 tabular-nums">{{ e[0] }}: {{ e[1] }}</span>} @empty { <span>{{ blank }}</span> }</dd>
          <dt>Turns recorded</dt><dd data-field="turns_recorded" class="tabular-nums">{{ d.turns_recorded }}</dd>
          <dt>Answers recorded</dt><dd data-field="answers_recorded" class="tabular-nums">{{ d.answers_recorded }}</dd>
          <dt>First seen</dt><dd data-field="first_seen_at">{{ d.first_seen_at | date: 'medium' }}</dd>
          <dt>Last seen</dt><dd data-field="last_seen_at">{{ (d.last_seen_at | date: 'medium') ?? blank }}</dd>
        </dl>
      } @else { <p class="mt-3 text-small text-ink-600 dark:text-ink-400">Loading…</p> }
    </section>

    <!-- The frame is the kit's ordinary card, and the red rectangle this panel used
         to wear is gone. R342 put the destructive weight on the control that does
         the thing rather than spreading it over the region around it, and here the
         region already says what it is six times over: a heading in the rejected
         ink, a sentence saying it cannot be undone, five bullets of consequence, a
         control that will not arm until the word is typed, and a red button. The
         frame was the sixth, and it was the one carrying no information. -->
    <section mw-card pad="lg" class="mt-10">
      <h2 class="text-h3 text-rejected-fg dark:text-rejected-edge">Delete my account</h2>
      <!-- What the server does is deleteDeveloperAccount, which anonymises: the
           answers, the ledger entries and the payouts stay, because a buyer has
           already been charged for them and the ledger is append-only. Two of the
           consequences below are irreversible and neither is obvious, so both are
           stated rather than left for someone to discover after the fact. -->
      <p class="mt-1 max-w-[68ch] text-small">This cannot be undone, and it is not the same as removing every trace of you.</p>
      <ul class="mt-2 max-w-[68ch] list-disc space-y-1 pl-5 text-small text-ink-600 dark:text-ink-400">
        <li data-removes><span class="font-medium">Removed:</span> your GitHub login, operating system, Claude Code version, country, activity tier, file-extension counts, last-seen time, the date your GitHub account was created, every turn we recorded, and your payout method.</li>
        <li data-keeps><span class="font-medium">Kept:</span> your answers, the ledger entries behind them, and any payout already made — accounting records a buyer has been charged for, left with nothing on them that names you. The account row stays too, emptied: an internal id, the date you first signed up, and your GitHub id, which is what stops the account being made again.</li>
        <li>Your command-line token stops working, every browser session ends, and any sign-in link still outstanding stops working.</li>
        <li>Your GitHub account cannot be used with Tickover again.</li>
        <li>Anything not yet paid out is forfeited: a deleted account is left out of every payout run. Payouts go monthly from <mw-money [cents]="payoutMinCents" />, so if you are owed money, wait for the next one.</li>
      </ul>
      <div class="mt-4 flex max-w-md flex-col gap-3">
        <mw-field label="Type delete to confirm">
          <input mw-input name="confirm" [(ngModel)]="confirmText" placeholder="delete" />
        </mw-field>
        <button type="button" data-delete mw-button variant="danger" class="self-start" (click)="remove()" [disabled]="!canDelete() || deleting()">Delete my account</button>
      </div>
      @if (deleteFailed()) { <mw-banner class="mt-3 max-w-md" tone="error">Couldn't delete your account. Nothing was removed; try again.</mw-banner> }
    </section>`,
})
export default class SettingsPage {
  private auth = inject(AuthState)
  private api = inject(ApiService)
  private router = inject(Router)

  blank = BLANK
  payoutMinCents = RULES.PAYOUT_MIN_CENTS
  sentList = SENT_LIST
  derivedList = DERIVED_LIST
  neverList = NEVER_LIST

  paypalEmail = this.auth.developer()?.payout_method?.email ?? ''
  confirmText = ''
  saving = signal(false)
  saved = signal(false)
  saveFailed = signal<string | null>(null)

  data = signal<DataSummary | null>(null)
  dataFailed = signal(false)

  deleting = signal(false)
  deleteFailed = signal(false)

  constructor() {
    void this.api.devData().then(
      (d) => this.data.set(d),
      () => this.dataFailed.set(true),
    )
  }

  /** The tier is derived server-side and rides on the principal, not on `DataSummary`. */
  tier(): string { return this.auth.developer()?.activity_tier ?? BLANK }

  /** Biggest first: an unordered dump of thirty extensions buries the recognisable one. */
  entries(mix: Record<string, number>): Array<[string, number]> {
    return Object.entries(mix).sort((a, b) => b[1] - a[1])
  }

  canDelete(): boolean { return this.confirmText.trim().toLowerCase() === 'delete' }

  /**
   * The principal is replaced with the row the server sends back, not with a locally
   * assembled one: the response is `developerSelf`, so the balances and the cash-out
   * flag on it are the server's answer as of this write.
   */
  async savePayout(): Promise<void> {
    const email = this.paypalEmail.trim()
    if (!email || this.saving()) return
    this.saving.set(true)
    this.saved.set(false)
    this.saveFailed.set(null)
    try {
      this.auth.developer.set(await this.api.devPayoutMethod({ type: 'paypal', email }))
      this.saved.set(true)
    } catch (e) {
      // A 400 is the contract's own email check refusing the address, which is worth
      // saying, because the developer can fix it. Anything else is ours, and telling
      // them to correct an address that was fine would send them after the wrong thing.
      this.saveFailed.set(e instanceof ApiError && e.status === 400
        ? "Couldn't save that: PayPal needs a full email address."
        : "Couldn't save your payout email. Try again in a minute.")
    } finally {
      this.saving.set(false)
    }
  }

  /**
   * The second gate on an irreversible action. `[disabled]` is the first, and no
   * click can get past it — but a mis-wired binding would leave one stray click
   * deleting an account, so the check is made again where the request is issued.
   *
   * A failed request means the account is still there, so the principal stays and
   * the page says nothing was removed. Clearing it and leaving would show a
   * signed-out page over a live account and hide the failure entirely.
   */
  async remove(): Promise<void> {
    if (!this.canDelete() || this.deleting()) return
    this.deleting.set(true)
    this.deleteFailed.set(false)
    try {
      await this.api.devDelete()
    } catch {
      this.deleteFailed.set(true)
      return
    } finally {
      this.deleting.set(false)
    }
    this.auth.developer.set(null)
    await this.router.navigateByUrl('/developers')
  }
}
