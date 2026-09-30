import { Component, inject, signal } from '@angular/core'
import { FormsModule } from '@angular/forms'
import { DatePipe, NgTemplateOutlet } from '@angular/common'
import type { RouteMeta } from '@analogjs/router'
import { ReviewDecision, type StudyView, type AdminStudyView, type ManualPaymentMethod } from '@tickover/contract'
import { ApiService, ApiError } from '../../lib/api'
import { adminGuard } from '../../lib/auth'
import { SITE_NAME } from '../../lib/page-meta'
import { Money } from '../../ui/money'
import { formatCents } from '../../lib/money'
import { Banner } from '../../ui/banner'
import { Button } from '../../ui/button'
import { Card } from '../../ui/card'
import { Empty } from '../../ui/empty'
import { Confirm } from '../../ui/confirm'
import { Input } from '../../ui/input'
import { Meta } from '../../ui/meta'
import { PageHeader } from '../../ui/page-header'

export const routeMeta = { title: `${SITE_NAME} — Review queue`, canActivate: [adminGuard] } satisfies RouteMeta

/**
 * Spec §4.7's policy, on the screen where it is applied. It is the whole of the
 * rule: a study is refused for one of these five and approved otherwise. Kept as
 * data rather than markup so `index.page.spec.ts` can read it back — this is the
 * one place in the product where the policy is exercised, and a clause quietly
 * dropped from it is a study going live that should not have.
 */
export const POLICY = [
  'harvesting personal data',
  'political or adult content',
  'deceptive framing',
  'questions phrased as feedback about Claude Code or Anthropic',
  'a hidden sponsor',
] as const

/** The note bound the server will accept, asked of the schema rather than retyped. */
const NOTE_MAX = ReviewDecision.shape.note.unwrap().maxLength ?? 500

/** 0 for anything that is not an answer from the API, which no branch below claims. */
const status = (e: unknown): number => (e instanceof ApiError ? e.status : 0)

/**
 * The two ways a review decision fails because the study moved, not because the
 * request did. The server's claim is conditional on `in_review`: a study someone
 * else has already approved or rejected answers 409, one that is gone answers 404.
 */
const STALE: Record<number, string | undefined> = {
  409: 'Someone else already decided that study — it is no longer in review, so nothing you did changed it. The queue below is out of date and is being reloaded.',
  404: 'That study no longer exists. The queue below is out of date and is being reloaded.',
}

type Armed = { id: string; decision: 'approve' | 'reject' } | { id: string; decision: 'close' }

@Component({
  imports: [FormsModule, DatePipe, NgTemplateOutlet, Money, Confirm, Banner, Button, Card, Empty, Input, Meta, PageHeader],
  template: `
    <tk-page-header heading="Review queue" />
    <!-- The reviewer needs the whole study to apply §4.7, so every question, every
         option and every context line is on the page rather than behind a link. -->
    <p class="mt-3 max-w-[68ch] text-small text-ink-600 dark:text-ink-400">Refuse a study for {{ policy.join(', ') }}. Everything else is approved.</p>
    @if (loadFailed()) { <tk-banner data-load-failed class="mt-3" tone="error">Could not load the queue, so what is below may be out of date and a study may be waiting that is not shown.</tk-banner> }
    @if (actionFailed(); as why) { <tk-banner data-failed class="mt-3" tone="error">{{ why }}</tk-banner> }

    <!-- I-1: the body an owner needs to apply §4.7 -- sponsor/meta, targeting, every
         question with its options and context, the respondent target -- shared
         between the awaiting row above and the in_review card below rather than
         kept once and shown only to the reviewer. An awaiting study is invoiced
         from this same reading, so it cannot be a summary either.

         Spacing rather than middle dots (design system 7). It was exempted on the
         grounds that the string is built in TypeScript and is data the reviewer
         reads rather than chrome a template joins -- which is a fact about where
         the join happens and not about what a reader sees. What a reader saw was a
         dotted chain, which is the one device this product spends on the line it
         sells. -->
    <ng-template #studyBody let-s>
      <span tk-meta>
        <span>sponsor {{ s.sponsor }}</span>
        <span><tk-money [cents]="s.price_cents" /> a response, <tk-money [cents]="s.developer_cents" /> to the developer</span>
        <span>{{ s.target_count }} respondents</span>
        @if (s.at_cost) { <span>at cost</span> }
        <span>submitted {{ s.created_at | date: 'medium' }}</span>
      </span>
      @if (s.targeting) {
        <p tk-meta class="mt-2 max-w-[68ch]">
          <span>Targeting:</span>
          @for (f of facets(s.targeting); track f) { <span>{{ f }}</span> }
        </p>
      } @else { <p class="mt-2 text-caption text-ink-600 dark:text-ink-400">Targeting: none.</p> }
      <!-- The measure applies here more than anywhere in the product: this is the
           text a reviewer reads §4.7 against, and it is the one text on the page
           written by somebody outside it. The contract allows 120 characters of
           question and five options of 40, so one item can reach past 300 before
           the context line underneath, and the list had no cap at all. -->
      <ol class="mt-3 max-w-[68ch] list-decimal space-y-2 pl-5 text-small">
        @for (q of s.questions; track q.id) { <li>{{ q.text }} <span class="text-ink-600 dark:text-ink-400">[{{ q.options.join(' | ') }}]</span> @if (q.context) { <div class="text-ink-600 dark:text-ink-400">{{ q.context }}</div> } </li> }
      </ol>
    </ng-template>

    <!-- Money waiting comes before studies waiting: an unpaid at-cost study is the
         one thing on this page that is not the reviewer's decision to make, so it
         is not mixed into the queue below it. -->
    <h2 class="mt-8 text-h3 text-ink-900 dark:text-ink-50">Awaiting payment</h2>
    @if (paidNotice(); as n) { <tk-banner class="mt-3" tone="done">{{ n }}</tk-banner> }
    @for (s of awaiting(); track s.id) {
      <div tk-card class="mt-3" [attr.data-awaiting-row]="s.id">
        <p tk-meta>
          <span class="font-medium">{{ s.title }}</span>
          <span><tk-money [cents]="s.amount_due_cents" /> due</span>
          <span class="font-mono">{{ s.payment_reference }}</span>
          <span>{{ s.buyer_email }}</span>
        </p>
        <ng-container [ngTemplateOutlet]="studyBody" [ngTemplateOutletContext]="{ $implicit: s }" />
        <div class="mt-3 flex flex-wrap items-center gap-2">
          <!-- M-1: the value is cents, prefilled from the amount due, and "cents"
               used to live only in the aria-label, unread by a sighted operator
               most likely to type dollars. The unit is now on the page. -->
          <span class="flex items-center gap-2">
            <input tk-input size="sm" type="number" min="1" class="min-w-64 flex-1" [attr.aria-label]="'Amount received in cents for ' + s.title" [(ngModel)]="paidForm(s).cents" />
            <span class="text-caption text-ink-600 dark:text-ink-400">cents</span>
          </span>
          <select tk-input size="sm" class="min-w-64 flex-1" [attr.aria-label]="'Payment method for ' + s.title" [(ngModel)]="paidForm(s).method">
            @for (m of methods; track m) { <option [value]="m">{{ m.replace('_', ' ') }}</option> }
          </select>
          <input tk-input size="sm" class="min-w-64 flex-1" [attr.data-paid-reference]="s.id" [attr.aria-label]="'Payment reference for ' + s.title" placeholder="transfer reference" [(ngModel)]="paidForm(s).reference" />
          <button type="button" tk-button size="sm" [attr.data-mark-paid]="s.id" [disabled]="busy() || !paidForm(s).reference.trim()" (click)="markPaid(s)">Mark paid</button>
        </div>
        <div class="mt-3 flex flex-wrap items-center gap-2">
          <input tk-input size="sm" class="min-w-64 flex-1" [attr.data-note]="s.id" [attr.aria-label]="'Rejection note for ' + s.title" [(ngModel)]="notes[s.id]" [attr.maxlength]="noteMax" placeholder="rejection note, shown to the buyer" />
          <button type="button" [attr.data-reject]="s.id" tk-button variant="danger" size="sm" [disabled]="busy() || !note(s.id)" (click)="arm({ id: s.id, decision: 'reject' })">Reject with note</button>
        </div>
        @if (!note(s.id)) { <p class="mt-2 max-w-[68ch] text-small text-ink-600 dark:text-ink-400">A rejection needs a note. The buyer sees it on their study page and it is all they are told.</p> }
        @if (armedFor(s.id, 'reject')) {
          <!-- Task 5 lets a waiting study be refused; the heading says so rather
               than the queue's "and refunds the buyer" -- nothing was ever taken
               from this buyer to give back. -->
          <tk-confirm heading="Reject: this refuses the study. No payment was taken, so nothing is refunded." action="Reject" [busy]="busy()" (go)="decide(s.id, 'reject')" (cancel)="disarm()">
            <ul class="mt-1 list-disc space-y-1 pl-5">
              <li>The buyer reads this note on their study page: {{ note(s.id) }}</li>
              <li>A study can be reviewed once. There is no un-reject.</li>
            </ul>
          </tk-confirm>
        }
      </div>
    } @empty { <tk-empty says="Nothing awaiting payment." /> }

    @for (s of queue(); track s.id) {
      <section tk-card class="mt-4">
        <h2 class="text-h3 text-ink-900 dark:text-ink-50">{{ s.title }}</h2>
        <ng-container [ngTemplateOutlet]="studyBody" [ngTemplateOutletContext]="{ $implicit: s }" />

        <div class="mt-3 flex flex-wrap items-center gap-2">
          <!-- The app's last filled green button. Design system 3.4 removed green
               from the palette, and approve is simply the primary action here. -->
          <button type="button" [attr.data-approve]="s.id" tk-button size="sm" [disabled]="busy()" (click)="arm({ id: s.id, decision: 'approve' })">Approve</button>
          <input tk-input size="sm" class="min-w-64 flex-1" [name]="'note' + s.id" [attr.name]="'note' + s.id" [attr.data-note]="s.id" [attr.aria-label]="'Rejection note for ' + s.title" [(ngModel)]="notes[s.id]" [attr.maxlength]="noteMax" placeholder="rejection note, shown to the buyer" />
          <button type="button" [attr.data-reject]="s.id" tk-button variant="danger" size="sm" [disabled]="busy() || !note(s.id)" (click)="arm({ id: s.id, decision: 'reject' })">Reject with note</button>
        </div>
        <!-- A rejection is the only thing the buyer is told, so it does not go out
             empty: the note is what their own study page renders back to them.
             (No backtick in these comments: one would end the template literal.) -->
        @if (!note(s.id)) { <p class="mt-2 max-w-[68ch] text-small text-ink-600 dark:text-ink-400">A rejection needs a note. The buyer sees it on their study page and it is all they are told.</p> }

        @if (armedFor(s.id, 'approve')) {
          <tk-confirm heading="Approve: this sends the study to developers now." action="Approve and go live" variant="primary" [busy]="busy()" (go)="decide(s.id, 'approve')" (cancel)="disarm()">
            <ul class="mt-1 list-disc space-y-1 pl-5">
              <li>Developers start being served these questions immediately, and are paid <tk-money [cents]="s.developer_cents" /> for each answer.</li>
              <li>A study can be reviewed once. There is no un-approve: the only way back is Close and settle, which charges the buyer for whatever has already been answered.</li>
              <li>The buyer's <tk-money [cents]="s.hold_cents" /> hold stays held; it is charged or returned when the study settles.</li>
            </ul>
          </tk-confirm>
        }
        @if (armedFor(s.id, 'reject')) {
          <tk-confirm heading="Reject: this refuses the study and refunds the buyer." action="Reject and refund" [busy]="busy()" (go)="decide(s.id, 'reject')" (cancel)="disarm()">
            <ul class="mt-1 list-disc space-y-1 pl-5">
              <li>The buyer gets <tk-money [cents]="s.hold_cents" /> back as credit, and reads this note: {{ note(s.id) }}</li>
              @if (s.at_cost) { <li>This study spent the buyer's one at-cost study; rejecting hands that entitlement back.</li> }
              <li>A study can be reviewed once. There is no un-reject.</li>
            </ul>
          </tk-confirm>
        }
      </section>
    } @empty {
      <!-- The empty rung is gated on both, and neither guard is decorative. Before
           this it painted "Nothing waiting for review." during the request and again
           beside the failure banner -- telling an operator a study is not waiting, at
           the two moments the page cannot know that (R359). -->
      @if (loading()) { <p data-loading class="py-3 text-small text-ink-600 dark:text-ink-400">Loading…</p> }
      @else if (!loadFailed()) { <tk-empty says="Nothing waiting for review." /> }
    }

    <h2 class="mt-10 text-h2 text-ink-900 dark:text-ink-50">Live</h2>
    @for (s of live(); track s.id) {
      <div tk-card pad="md" class="mt-3 text-small">
        <div class="flex items-center justify-between">
          <span class="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <span class="font-medium">{{ s.title }}</span>
            <span class="text-ink-600 dark:text-ink-400">{{ s.sponsor }}</span>
            <span class="text-ink-600 dark:text-ink-400">{{ s.respondents_completed }} / {{ s.target_count }} respondents</span>
            <span class="text-ink-600 dark:text-ink-400"><tk-money [cents]="s.hold_cents" /> held</span>
          </span>
          <button type="button" [attr.data-close]="s.id" tk-button variant="secondary" size="sm" [disabled]="busy()" (click)="arm({ id: s.id, decision: 'close' })">Close and settle</button>
        </div>
        @if (armedFor(s.id, 'close')) {
          <tk-confirm heading="Close and settle: this ends the study and moves the money." action="Close and settle" [busy]="busy()" (go)="close(s.id)" (cancel)="disarm()">
            <ul class="mt-1 list-disc space-y-1 pl-5">
              <li>Developers can no longer answer it, and any question already served expires unanswered.</li>
              <li>Every answer is judged now: valid ones release <tk-money [cents]="s.developer_cents" /> each to the developer, invalid ones are taken back.</li>
              <li>The buyer is charged for the valid answers out of the <tk-money [cents]="s.hold_cents" /> held, and the rest is returned to their credit.</li>
              <li>Settling is final. A settled study cannot be reopened.</li>
            </ul>
          </tk-confirm>
        }
      </div>
    } @empty {
      @if (loading()) { <p data-loading class="py-3 text-small text-ink-600 dark:text-ink-400">Loading…</p> }
      @else if (!loadFailed()) { <tk-empty says="No live studies." /> }
    }`,
})
export default class ReviewPage {
  private api = inject(ApiService)
  queue = signal<StudyView[]>([])
  live = signal<StudyView[]>([])
  awaiting = signal<AdminStudyView[]>([])
  /** Keyed by study id, and read straight back out by the confirmation panel. */
  notes: Record<string, string> = {}
  /** Keyed by study id, populated on first read by `paidForm` below. */
  paid: Record<string, { cents: number; method: ManualPaymentMethod; reference: string }> = {}
  paidNotice = signal<string | null>(null)
  methods: ManualPaymentMethod[] = ['bank_transfer', 'wise', 'payoneer', 'other']
  armed = signal<Armed | null>(null)
  busy = signal(false)
  // Two signals, not one. A failed load and a failed decision are different
  // problems and can be true at once, and folding them together let the newer one
  // erase a warning the operator was still acting under.
  loadFailed = signal(false)
  actionFailed = signal<string | null>(null)
  policy = POLICY
  noteMax = NOTE_MAX

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
      const [q, l, w] = await Promise.all([this.api.adminStudies('in_review'), this.api.adminStudies('live'), this.api.adminStudies('awaiting_payment')])
      this.queue.set(q); this.live.set(l); this.awaiting.set(w)
      this.loadFailed.set(false)
    } catch {
      // The lists are left as they were rather than emptied: "nothing waiting for
      // review" and "the queue did not load" are otherwise the same picture, and
      // one of them means a study is sitting unreviewed.
      this.loadFailed.set(true)
    } finally {
      this.loading.set(false)
    }
  }

  /**
   * One facet per span, joined by the layout rather than by a mark. Each facet keeps
   * its own commas, which is why a comma could not have been the separator and why
   * the mark looked necessary: the answer is that the separator is a gap.
   */
  facets(t: NonNullable<StudyView['targeting']>): string[] {
    return [
      t.languages?.length ? `languages ${t.languages.join(', ')}` : '',
      t.countries?.length ? `countries ${t.countries.join(', ')}` : '',
      t.activity_tiers?.length ? `tiers ${t.activity_tiers.join(', ')}` : '',
      t.os?.length ? `os ${t.os.join(', ')}` : '',
    ].filter(Boolean)
  }

  note(id: string): string { return (this.notes[id] ?? '').trim() }
  /** `??=` so the operator's edits survive a re-render of the row they are on. */
  paidForm(s: AdminStudyView) { return (this.paid[s.id] ??= { cents: s.amount_due_cents, method: 'bank_transfer', reference: '' }) }
  arm(a: Armed): void { this.actionFailed.set(null); this.armed.set(a) }
  disarm(): void { this.armed.set(null) }
  armedFor(id: string, decision: Armed['decision']): boolean {
    const a = this.armed()
    return a !== null && a.id === id && a.decision === decision
  }

  /**
   * Reached only from the confirmation panel. Every one of these is a one-way
   * door — the server's review claim is conditional on `in_review`, so a second
   * call is refused rather than repeated — which is why the panel exists and why
   * a failure has to say so instead of leaving the row looking untouched.
   */
  async decide(id: string, decision: 'approve' | 'reject'): Promise<void> {
    const note = this.note(id)
    if (decision === 'reject' && !note) return
    await this.run(
      () => this.api.adminReview(id, decision, decision === 'reject' ? note : undefined),
      (e) => STALE[status(e)] ?? `Could not ${decision} that study. Nothing was changed; check the queue and try again.`,
    )
  }

  /**
   * R503: the server refuses a second record of one transfer and serialises two
   * clicks, so this only has to say which of the three outcomes happened.
   *
   * M-2: a 409 that is not `payment_already_recorded` means the study itself moved
   * -- a reject or a withdraw won the race -- not that this reference was reused.
   * `STALE[409]` is worded for the review queue's own conflict ("no longer in
   * review"); a study that was awaiting payment was never in review, so it gets its
   * own sentence rather than borrowing that one. A 404 is still the generic "gone",
   * shared with the rest of the page.
   */
  async markPaid(s: AdminStudyView): Promise<void> {
    const f = this.paidForm(s)
    if (!f.reference.trim()) return
    this.paidNotice.set(null)
    await this.run(
      async () => {
        const r = await this.api.adminMarkPaid(s.id, { cents: f.cents, method: f.method, reference: f.reference.trim() })
        this.paidNotice.set(r.submitted ? 'Payment recorded. The study is now in review.' : `Payment recorded, but ${formatCents(r.amount_due_cents)} is still due.`)
        delete this.paid[s.id]
      },
      (e) => (status(e) === 409
        ? ((e as ApiError).body && ((e as ApiError).body as { error?: string }).error === 'payment_already_recorded'
          ? 'That payment reference is already recorded, so nothing was added. Check the reference and try again.'
          : 'That study is no longer awaiting payment, so nothing was recorded. The list below is out of date and is being reloaded.')
        : STALE[status(e)] ?? 'Could not record that payment. Nothing was changed; try again.'),
    )
  }

  async close(id: string): Promise<void> {
    await this.run(
      () => this.api.adminClose(id),
      (e) => (status(e) === 409
        ? 'That study is no longer live — it was already closed and settled, here or by someone else. The list below is out of date and is being reloaded.'
        : status(e) === 404
          ? 'That study no longer exists. The list below is out of date and is being reloaded.'
          : 'Could not close that study. Check whether it settled before trying again.'),
    )
  }

  /**
   * A failed decision and a decision somebody else already made are different
   * situations with different next actions: one is retry, the other is re-read
   * the queue. The server's review claim is conditional on `in_review`, so it
   * answers 409 when the study has moved on and 404 when it is gone — the whole
   * distinction is in the status code, and reporting both as "the request failed"
   * sends an operator to retry something that is already decided.
   *
   * A stale-state failure also reloads, because the message says the list is out
   * of date and leaving a queue on screen after saying that is worse than the
   * flicker. The notice survives the reload: `refresh` does not clear it.
   */
  private async run(call: () => Promise<unknown>, whenFailed: (e: unknown) => string): Promise<void> {
    if (this.busy()) return
    this.busy.set(true)
    this.actionFailed.set(null)
    let stale = false
    try {
      await call()
    } catch (e) {
      this.actionFailed.set(whenFailed(e))
      stale = status(e) === 409 || status(e) === 404
      if (!stale) return
    } finally {
      this.busy.set(false)
      this.armed.set(null)
    }
    await this.refresh()
  }
}
