import { Component, inject, signal } from '@angular/core'
import { FormsModule } from '@angular/forms'
import { DatePipe } from '@angular/common'
import type { RouteMeta } from '@analogjs/router'
import { ReviewDecision, type StudyView } from '@tickover/contract'
import { ApiService, ApiError } from '../../lib/api'
import { adminGuard } from '../../lib/auth'
import { SITE_NAME } from '../../lib/page-meta'
import { Money } from '../../ui/money'
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
  imports: [FormsModule, DatePipe, Money, Confirm, Banner, Button, Card, Empty, Input, Meta, PageHeader],
  template: `
    <mw-page-header heading="Review queue" />
    <!-- The reviewer needs the whole study to apply §4.7, so every question, every
         option and every context line is on the page rather than behind a link. -->
    <p class="mt-3 max-w-[68ch] text-small text-ink-600 dark:text-ink-400">Refuse a study for {{ policy.join(', ') }}. Everything else is approved.</p>
    @if (loadFailed()) { <mw-banner data-load-failed class="mt-3" tone="error">Could not load the queue, so what is below may be out of date and a study may be waiting that is not shown.</mw-banner> }
    @if (actionFailed(); as why) { <mw-banner data-failed class="mt-3" tone="error">{{ why }}</mw-banner> }

    @for (s of queue(); track s.id) {
      <section mw-card class="mt-4">
        <div class="flex flex-wrap items-baseline justify-between gap-2">
          <h2 class="text-h3 text-ink-900 dark:text-ink-50">{{ s.title }}</h2>
          <!-- Spacing rather than middle dots (design system 7), and the targeting
               line below is the same treatment now. It was exempted on the grounds
               that the string is built in TypeScript and is data the reviewer reads
               rather than chrome a template joins -- which is a fact about where the
               join happens and not about what a reader sees. What a reader saw was a
               dotted chain, which is the one device this product spends on the line
               it sells. -->
          <span mw-meta>
            <span>sponsor {{ s.sponsor }}</span>
            <span><mw-money [cents]="s.price_cents" /> a response, <mw-money [cents]="s.developer_cents" /> to the developer</span>
            <span>{{ s.target_count }} respondents</span>
            @if (s.at_cost) { <span>at cost</span> }
            <span>submitted {{ s.created_at | date: 'medium' }}</span>
          </span>
        </div>
        @if (s.targeting) {
          <p mw-meta class="mt-2 max-w-[68ch]">
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

        <div class="mt-3 flex flex-wrap items-center gap-2">
          <!-- The app's last filled green button. Design system 3.4 removed green
               from the palette, and approve is simply the primary action here. -->
          <button type="button" [attr.data-approve]="s.id" mw-button size="sm" [disabled]="busy()" (click)="arm({ id: s.id, decision: 'approve' })">Approve</button>
          <input mw-input size="sm" class="min-w-64 flex-1" [name]="'note' + s.id" [attr.name]="'note' + s.id" [attr.data-note]="s.id" [attr.aria-label]="'Rejection note for ' + s.title" [(ngModel)]="notes[s.id]" [attr.maxlength]="noteMax" placeholder="rejection note, shown to the buyer" />
          <button type="button" [attr.data-reject]="s.id" mw-button variant="danger" size="sm" [disabled]="busy() || !note(s.id)" (click)="arm({ id: s.id, decision: 'reject' })">Reject with note</button>
        </div>
        <!-- A rejection is the only thing the buyer is told, so it does not go out
             empty: the note is what their own study page renders back to them.
             (No backtick in these comments: one would end the template literal.) -->
        @if (!note(s.id)) { <p class="mt-2 max-w-[68ch] text-small text-ink-600 dark:text-ink-400">A rejection needs a note. The buyer sees it on their study page and it is all they are told.</p> }

        @if (armedFor(s.id, 'approve')) {
          <mw-confirm heading="Approve: this sends the study to developers now." action="Approve and go live" variant="primary" [busy]="busy()" (go)="decide(s.id, 'approve')" (cancel)="disarm()">
            <ul class="mt-1 list-disc space-y-1 pl-5">
              <li>Developers start being served these questions immediately, and are paid <mw-money [cents]="s.developer_cents" /> for each answer.</li>
              <li>A study can be reviewed once. There is no un-approve: the only way back is Close and settle, which charges the buyer for whatever has already been answered.</li>
              <li>The buyer's <mw-money [cents]="s.hold_cents" /> hold stays held; it is charged or returned when the study settles.</li>
            </ul>
          </mw-confirm>
        }
        @if (armedFor(s.id, 'reject')) {
          <mw-confirm heading="Reject: this refuses the study and refunds the buyer." action="Reject and refund" [busy]="busy()" (go)="decide(s.id, 'reject')" (cancel)="disarm()">
            <ul class="mt-1 list-disc space-y-1 pl-5">
              <li>The buyer gets <mw-money [cents]="s.hold_cents" /> back as credit, and reads this note: {{ note(s.id) }}</li>
              @if (s.at_cost) { <li>This study spent the buyer's one at-cost study; rejecting hands that entitlement back.</li> }
              <li>A study can be reviewed once. There is no un-reject.</li>
            </ul>
          </mw-confirm>
        }
      </section>
    } @empty {
      <!-- The empty rung is gated on both, and neither guard is decorative. Before
           this it painted "Nothing waiting for review." during the request and again
           beside the failure banner -- telling an operator a study is not waiting, at
           the two moments the page cannot know that (R359). -->
      @if (loading()) { <p data-loading class="py-3 text-small text-ink-600 dark:text-ink-400">Loading…</p> }
      @else if (!loadFailed()) { <mw-empty says="Nothing waiting for review." /> }
    }

    <h2 class="mt-10 text-h2 text-ink-900 dark:text-ink-50">Live</h2>
    @for (s of live(); track s.id) {
      <div mw-card pad="md" class="mt-3 text-small">
        <div class="flex items-center justify-between">
          <span class="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <span class="font-medium">{{ s.title }}</span>
            <span class="text-ink-600 dark:text-ink-400">{{ s.sponsor }}</span>
            <span class="text-ink-600 dark:text-ink-400">{{ s.respondents_completed }} / {{ s.target_count }} respondents</span>
            <span class="text-ink-600 dark:text-ink-400"><mw-money [cents]="s.hold_cents" /> held</span>
          </span>
          <button type="button" [attr.data-close]="s.id" mw-button variant="secondary" size="sm" [disabled]="busy()" (click)="arm({ id: s.id, decision: 'close' })">Close and settle</button>
        </div>
        @if (armedFor(s.id, 'close')) {
          <mw-confirm heading="Close and settle: this ends the study and moves the money." action="Close and settle" [busy]="busy()" (go)="close(s.id)" (cancel)="disarm()">
            <ul class="mt-1 list-disc space-y-1 pl-5">
              <li>Developers can no longer answer it, and any question already served expires unanswered.</li>
              <li>Every answer is judged now: valid ones release <mw-money [cents]="s.developer_cents" /> each to the developer, invalid ones are taken back.</li>
              <li>The buyer is charged for the valid answers out of the <mw-money [cents]="s.hold_cents" /> held, and the rest is returned to their credit.</li>
              <li>Settling is final. A settled study cannot be reopened.</li>
            </ul>
          </mw-confirm>
        }
      </div>
    } @empty {
      @if (loading()) { <p data-loading class="py-3 text-small text-ink-600 dark:text-ink-400">Loading…</p> }
      @else if (!loadFailed()) { <mw-empty says="No live studies." /> }
    }`,
})
export default class ReviewPage {
  private api = inject(ApiService)
  queue = signal<StudyView[]>([])
  live = signal<StudyView[]>([])
  /** Keyed by study id, and read straight back out by the confirmation panel. */
  notes: Record<string, string> = {}
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
      const [q, l] = await Promise.all([this.api.adminStudies('in_review'), this.api.adminStudies('live')])
      this.queue.set(q); this.live.set(l)
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
