import { Component, DestroyRef, computed, inject, signal } from '@angular/core'
import { ActivatedRoute, RouterLink } from '@angular/router'
import type { RouteMeta } from '@analogjs/router'
import type { StudyResults, StudyView } from '@tickover/contract'
import { ApiService, ApiError } from '../../../lib/api'
import { AuthState, buyerGuard } from '../../../lib/auth'
import { SITE_NAME } from '../../../lib/page-meta'
import { SEGMENT_LABELS, optionRows, progressPct, segmentTables } from '../../../lib/results-view'
import { Money } from '../../../ui/money'
import { Banner } from '../../../ui/banner'
import { Bar } from '../../../ui/bar'
import { Button, Link } from '../../../ui/button'
import { Card } from '../../../ui/card'
import { PageHeader } from '../../../ui/page-header'
import { Meta } from '../../../ui/meta'
import { Figure, Rows } from '../../../ui/rows'
import { StateTrack, StudyBadge } from '../../../ui/study-badge'

// Guarded per page, not on the layout -- see `app.page.ts`.
export const routeMeta = { title: `${SITE_NAME} — Study`, canActivate: [buyerGuard] } satisfies RouteMeta

/**
 * How often a running study is re-read. The developer surface long-polls; this is
 * a buyer watching a counter, so ten seconds is soon enough to feel live and slow
 * enough that a tab left open all afternoon is not a load. Exported so the tests
 * advance this number rather than a copy of it.
 */
export const POLL_INTERVAL_MS = 10_000

/** The states that have answers behind them. A draft or a rejected study has none. */
const HAS_RESULTS = new Set<StudyView['state']>(['live', 'closed', 'settled'])

/**
 * Why the figures on screen stopped moving. Null while they are still moving.
 * `server` is a blip and keeps the timer; the other two are the server answering
 * definitely, and retrying a definite answer every ten seconds for the life of
 * the tab is noise the buyer cannot act on.
 */
type Stall = 'server' | 'signed_out' | 'gone'

/** Why there is nothing to show at all. Reloading cannot help with `gone`. */
type LoadFailure = 'error' | 'gone'

@Component({
  imports: [Money, Banner, Bar, Button, Card, Link, PageHeader, Figure, Meta, Rows, StudyBadge, StateTrack, RouterLink],
  template: `
    @if (failed() === 'gone') {
      <mw-banner tone="error">This study is not available. It may have been deleted, or this account may not have access to it. <a mw-link routerLink="/app">Back to your studies</a></mw-banner>
    } @else if (failed() === 'error') {
      <mw-banner tone="error">Couldn't load this study. Reload the page to try again.</mw-banner>
    } @else if (study(); as s) {
      <mw-page-header [heading]="s.title">
        <mw-study-badge mw-header-aside [state]="s.state" />
      </mw-page-header>
      <!-- The sequence design system 1 says is the one honest step indicator in this
           product. It answers the question the chip beside the heading cannot: not
           which state, but how far along. Nothing is drawn for a rejected study,
           which left the sequence rather than stopping inside it. -->
      <mw-state-track class="mb-4 max-w-md" [state]="s.state" />
      <!-- Every figure on this page is the server's. There is no price in the
           markup: what a response costs depends on targeting and on the at-cost
           entitlement, so a number written here would be wrong for three of the
           four configurations (R49, R58). -->
      <p mw-meta>
        <span>Sponsor {{ s.sponsor }}</span>
        <span><mw-money [cents]="s.price_cents" /> per response</span>
        @if (s.at_cost) { <span>your first study, at cost</span> }
      </p>

      @if (s.review_note) {
        <mw-banner class="mt-4" tone="warn">Reviewer note: {{ s.review_note }}</mw-banner>
      }

      @if (s.state === 'draft') {
        <button type="button" mw-button class="mt-4" (click)="submit(s.id)" [disabled]="submitting()">Submit for review</button>
        @if (needCents(); as n) { <mw-banner class="mt-2" tone="error">You need <mw-money [cents]="n" /> in credits to submit. <a mw-link routerLink="/app/credits">Buy credits</a></mw-banner> }
        @if (submitFailed()) { <mw-banner class="mt-2" tone="error">Couldn't send this study for review, and it is still a draft. Try again.</mw-banner> }
      }

      <section class="mt-6">
        <div class="flex justify-between text-small"><span>Respondents {{ s.respondents_completed }} / {{ s.target_count }}</span><span class="tabular-nums">{{ progress(s) }}%</span></div>
        <mw-bar data-progress class="mt-1 block" [pct]="progress(s)" />
        <p mw-meta class="mt-2">
          <span>Held <mw-money [cents]="s.hold_cents" /></span>
          <span>Charged <mw-money [cents]="s.charged_cents" /></span>
          <span>Refunded <mw-money [cents]="s.refunded_cents" /></span>
        </p>
      </section>

      <!-- A counter that has quietly stopped is worse than one that says it has.
           The figures above are the last the server sent either way, so neither
           branch throws them away. -->
      @if (stalled() === 'signed_out') {
        <mw-banner class="mt-3" tone="warn">Your sign-in has ended, so these figures stopped updating. <a mw-link routerLink="/app/login">Sign in</a> again to keep watching.</mw-banner>
      } @else if (stalled() === 'gone') {
        <mw-banner class="mt-3" tone="warn">This study is no longer available, so these figures stopped updating. It may have been deleted, or this account may have lost access to it.</mw-banner>
      } @else if (stalled() === 'server') {
        <!-- "Still trying" is claimed only where it is true. A study that is not
             live has no poll to retry with, and a page asserting that it is
             working on it is the reassuring label on a dead page. -->
        <mw-banner class="mt-3" tone="warn">These figures stopped updating because the server did not answer. They are the last it sent@if (s.state === 'live') {, and this page is still trying} @else {, and reloading the page is what will refresh them}.</mw-banner>
      }

      @if (results(); as r) {
        <!-- Answers, not people. The server counts one row per answer per
             question, so a three-question study reports three times the
             respondent count, and calling that "responses" beside "100 / 100"
             said the study had over-delivered threefold. It is also the figure
             the money is built from: settlement charges the study's price for
             each valid non-attention answer, so charged_cents is this number
             times the price above. -->
        <p mw-meta class="mt-8">
          <span>{{ r.valid_responses }} valid answers from {{ r.respondents_completed }} respondents</span>
          @if (s.state === 'settled') {
            <a mw-link [href]="csvUrl(s.id)">Download CSV</a>
          } @else {
            <span>CSV export opens when the study settles</span>
          }
        </p>

        <!-- Withheld and empty are the same four empty maps on the wire, so this
             reads the state the server sends rather than the data. Rendering
             nothing here would tell a buyer their study produced no breakdown
             when what happened is that it is not finished. -->
        @if (r.breakdown_state === 'withheld_until_settled') {
          <p class="mt-3 max-w-[68ch] text-small text-ink-600 dark:text-ink-400">Breakdowns by language, country, activity tier and operating system open when the study settles. Those four together can identify one respondent while the audience is still small, so the totals stay live and the segments wait.</p>
        }

        @for (q of questions(); track q.id) {
          <section mw-card pad="lg" class="mt-6">
            <h2 class="text-h3 text-ink-900 dark:text-ink-50">{{ q.heading }}</h2>
            <ul class="mt-3 space-y-2">
              @for (row of q.rows; track $index) {
                <li>
                  <!-- Two figures, spaced rather than joined: the middle dot that
                       used to separate them belongs to the status line (design
                       system 7), and with it gone "81 81%" read as one number. The
                       share is what lines up down the column, so it is the one
                       given a reserved width; the count is muted beside it.

                       R47's fifteenth firing was in this very comment, on the word
                       this sentence now avoids: it names a CSS position, and a
                       space after it is all Tailwind's scanner needs. -->
                  <div class="flex justify-between gap-4 text-small"><span>{{ row.option }}</span><span class="flex shrink-0 gap-4 tabular-nums"><span class="text-ink-600 dark:text-ink-400">{{ row.count }}</span><span class="w-12 text-right">{{ row.pct }}%</span></span></div>
                  <mw-bar class="mt-1 block" [pct]="row.pct" />
                </li>
              }
            </ul>
            @for (t of q.tables; track t.segment) {
              <details class="mt-4">
                <summary class="cursor-pointer text-small text-ink-600 dark:text-ink-400">By {{ labels[t.segment] }}</summary>
                <div class="overflow-x-auto">
                  <table mw-rows class="mt-2">
                    <thead><tr><th>{{ labels[t.segment] }}</th><th mw-figure>n</th>@for (o of q.options; track $index) { <th mw-figure>{{ o }}</th> }</tr></thead>
                    <tbody>
                      @for (row of t.rows; track row.key) {
                        <tr><td>{{ row.key }}</td><td mw-figure>{{ row.total }}</td>@for (c of row.cells; track $index) { <td mw-figure>{{ c }}%</td> }</tr>
                      }
                    </tbody>
                  </table>
                </div>
              </details>
            }
          </section>
        }
      }
    } @else { <p class="text-small text-ink-600 dark:text-ink-400">Loading…</p> }`,
})
export default class StudyPage {
  private api = inject(ApiService)
  private auth = inject(AuthState)
  private route = inject(ActivatedRoute)

  study = signal<StudyView | null>(null)
  results = signal<StudyResults | null>(null)
  failed = signal<LoadFailure | null>(null)
  stalled = signal<Stall | null>(null)
  needCents = signal<number | null>(null)
  submitFailed = signal(false)
  submitting = signal(false)

  labels = SEGMENT_LABELS

  /**
   * Everything the results section draws, derived once per response rather than
   * per change-detection pass. `tables` is empty whenever the server says the
   * breakdown is withheld, so no view can draw one from data it was not given.
   */
  questions = computed(() => {
    const r = this.results()
    if (!r) return []
    const segmented = r.breakdown_state === 'available'
    return r.questions.map((q) => ({
      id: q.question_id,
      heading: `${q.position + 1}. ${q.text}`,
      options: q.options,
      rows: optionRows(q.options, q.counts),
      tables: segmented ? segmentTables(q) : [],
    }))
  })

  private timer: ReturnType<typeof setInterval> | undefined
  private destroyed = false
  /**
   * The study the URL names right now. The router keeps this component alive when
   * only `:id` changes — which is the whole reason the subscription below is a
   * subscription and not a snapshot read — so every await in `load` has to come
   * back and ask whether it is still working on the page the buyer is looking at.
   */
  private currentId: string | null = null
  /**
   * Which visit is current. Bumped by `open`, carried by every load and by the
   * interval's callback, and compared rather than the id — see `open` for the
   * A → B → A round trip an id comparison gets wrong.
   *
   * Why a stale tick cannot happen, which is the argument that lets `watch` skip
   * a `destroyed` check of its own: `watch` is the only place a timer is created
   * and it stops any existing one first, so at most one exists. It is only called
   * after a `current(gen)` check with no await in between, so the timer always
   * carries the current generation. And `open` is the only place the generation
   * moves, which it does in the same breath as stopping the timer.
   */
  private gen = 0
  /** One request at a time **for the current generation**: a server slower than the interval must not pile them up. */
  private loading = false

  constructor() {
    inject(DestroyRef).onDestroy(() => {
      this.destroyed = true
      this.stopPolling()
    })
    this.route.paramMap.subscribe((p) => {
      const id = p.get('id')
      if (id) this.open(id)
    })
  }

  /**
   * Point the page at a study. Everything on screen belongs to the last one, so
   * all of it goes: leaving one study's title, progress, money or results up
   * under another study's URL is the page showing a buyer the wrong purchase.
   *
   * The `stopPolling` below was deleted in fix round 1 as unreachable and put
   * back, because it is not. The reasoning that removed it — "every way out of
   * `load` ends in `watch` or the catch, both of which stop the timer" — was
   * false on one branch: the catch's non-definite case with a study on screen
   * stopped nothing, so leaving a live study for one whose results leg failed
   * left the *previous* study's interval running. Measured: one request for the
   * study the buyer had left, and then a gate stuck shut for the life of the page.
   *
   * That branch now arms its own timer, so this line and `watch` are the two
   * places a timer is stopped and `watch` is the only place one is started. Both
   * are pinned; see the report for why "no mutant killed it" was not evidence.
   */
  private open(id: string): void {
    // A repeated emission is a no-op. Angular re-emits `paramMap` on a navigation
    // to the same URL, and without this the page would blank itself and refetch.
    if (id === this.currentId) return
    this.currentId = id
    // A generation, not just the id: A → B → A gives the first visit and the
    // third the same id, so an id check calls the first visit's answer current
    // when it lands last. Measured: 44 / 100 on screen, replaced by 12 / 100.
    const gen = ++this.gen
    this.stopPolling()
    this.study.set(null)
    this.results.set(null)
    this.failed.set(null)
    this.stalled.set(null)
    this.needCents.set(null)
    this.submitFailed.set(false)
    // Not gated on `loading`: a request still out for the study just left must
    // never delay the one the URL now names. Its response is discarded below.
    this.loading = false
    void this.load(id, gen)
  }

  progress(s: StudyView): number { return progressPct(s.respondents_completed, s.target_count) }

  /**
   * The export is the server's file, not one assembled here from the results
   * JSON. The server pseudonymises the respondent column per study and refuses
   * the whole thing with a 409 until settlement; a browser-built CSV would have
   * neither property and would be a second, unreviewed artifact.
   */
  csvUrl(id: string): string { return `/api/buyer/studies/${id}/results.csv` }

  async submit(id: string): Promise<void> {
    this.needCents.set(null)
    this.submitFailed.set(false)
    this.submitting.set(true)
    try {
      // The response is the updated study, so there is nothing to re-read: a
      // reload here would be a second request that can disagree with the first.
      this.study.set(await this.api.submitStudy(id))
      // The hold is taken at submit, so the credit figure in the chrome is stale
      // until the principal is read back. Failing to read it is not a failure to
      // submit, and reporting it as one would invite a second submit -- the
      // ambiguity that cost Task 5 a duplicate paid study (R60).
      await this.auth.refreshBuyer().catch(() => undefined)
    } catch (e) {
      const need = e instanceof ApiError && e.status === 402 ? (e.body as { required_cents?: unknown } | null)?.required_cents : undefined
      // A 402 whose body does not carry the amount is not something to render:
      // an undefined here reaches the money component and prints a dollar sign
      // with NaN after it.
      if (typeof need === 'number') this.needCents.set(need)
      else this.submitFailed.set(true)
    } finally {
      this.submitting.set(false)
    }
  }

  private stopPolling(): void {
    clearInterval(this.timer)
    this.timer = undefined
  }

  /**
   * The only place a timer is created, and it stops any existing one first, so at
   * most one is ever running. Re-armed after every answer rather than left alone,
   * so the interval follows the study: it starts when a live study is seen and
   * stops the moment one is not.
   *
   * No `destroyed` check of its own: both call sites reach it only after a
   * `current(gen)` check with no await in between, and `destroyed` cannot flip
   * inside synchronous code. A third call site would have to keep that true.
   */
  private watch(id: string, gen: number, live: boolean): void {
    this.stopPolling()
    if (live) this.timer = setInterval(() => void this.load(id, gen), POLL_INTERVAL_MS)
  }

  /** True while this call is still the visit the page is showing. */
  private current(gen: number): boolean { return !this.destroyed && gen === this.gen }

  private async load(id: string, gen: number): Promise<void> {
    if (this.loading) return
    this.loading = true
    try {
      const s = await this.api.buyerStudy(id)
      if (!this.current(gen)) return
      this.study.set(s)
      if (HAS_RESULTS.has(s.state)) {
        const r = await this.api.results(id)
        if (!this.current(gen)) return
        this.results.set(r)
      }
      // `failed` is deliberately not cleared here. It is only ever set in the
      // branch below that also stops the timer, so nothing retries afterwards and
      // the only way back is `open`, which clears it. A stale rejection cannot
      // set it either — the catch returns on `current(gen)` first. A line here
      // would be one no test could tell from a comment; `stalled` is cleared
      // because a poll really does recover from a blip, and a mutation proves it.
      this.stalled.set(null)
      this.watch(id, gen, s.state === 'live')
    } catch (e) {
      if (!this.current(gen)) return
      // 401 and 404 are the server answering, definitely: the session is over, or
      // this study is not this buyer's to read. Every later poll gets the same
      // answer, so the timer stops. Everything else may be a blip and is retried.
      const status = e instanceof ApiError ? e.status : 0
      const definite = status === 401 || status === 404
      const shown = this.study()
      if (shown) {
        // A refresh failed with figures already on screen. They stay, labelled.
        this.stalled.set(status === 401 ? 'signed_out' : status === 404 ? 'gone' : 'server')
        // This branch owns the timer, and used not to. A FIRST load whose study
        // leg succeeds and whose results leg fails never reaches `watch` at all,
        // so the page said it was still trying while nothing was armed and no
        // request went out again, ever — the reassuring label on a dead page.
        // `watch` is idempotent, so the ordinary poll-failure case, which already
        // has a timer, is unchanged.
        if (definite) this.stopPolling()
        else this.watch(id, gen, shown.state === 'live')
      } else {
        this.failed.set(status === 404 ? 'gone' : 'error')
        this.stopPolling()
      }
    } finally {
      // Only the call that owns the current generation may release the gate. A
      // superseded one clearing it would let a tick start a second request
      // alongside the load `open` has just begun.
      if (gen === this.gen) this.loading = false
    }
  }
}
