import { Component, DestroyRef, inject, signal } from '@angular/core'
import { FormsModule } from '@angular/forms'
import { Router, RouterLink } from '@angular/router'
import type { RouteMeta } from '@analogjs/router'
import { LANGUAGES, PRICING, RULES, type AudienceEstimate, type StudyView } from '@tickover/contract'
import { ApiService, ApiError, newIdempotencyKey } from '../../../lib/api'
import { AuthState, buyerGuard } from '../../../lib/auth'
import { SITE_NAME } from '../../../lib/page-meta'
import {
  MAX_OPTIONS, MAX_QUESTIONS, MIN_OPTIONS, SPONSOR_MAX, TARGETING_CAPS, TITLE_MAX,
  emptyDraft, newQuestion, quoteFor, quoteForSaved, targetingOf, targetingSurcharge, toStudyInput, type StudyDraft,
} from '../../../lib/study-form'
import { Banner } from '../../../ui/banner'
import { Button, Link } from '../../../ui/button'
import { Card } from '../../../ui/card'
import { Chip } from '../../../ui/chip'
import { Field } from '../../../ui/field'
import { Input, Range } from '../../../ui/input'
import { Meta } from '../../../ui/meta'
import { Money } from '../../../ui/money'
import { PageHeader } from '../../../ui/page-header'

// Guarded per page, not on the layout -- see `app.page.ts`. `PAGE_META` is the
// prerender list and takes no other keys, so an app route names its tab here.
export const routeMeta = { title: `${SITE_NAME} — New study`, canActivate: [buyerGuard] } satisfies RouteMeta

/**
 * Long enough that a buyer clicking through four targeting chips asks the server
 * once rather than four times, short enough that the panel still feels attached to
 * the click. Exported so the test waits on this number rather than a copy of it.
 */
export const ESTIMATE_DEBOUNCE_MS = 400

@Component({
  imports: [FormsModule, RouterLink, Banner, Button, Card, Chip, Field, Input, Link, Meta, Money, PageHeader, Range],
  template: `
    <mw-page-header heading="New study" />
    <form class="grid gap-8 lg:grid-cols-[1fr_20rem]" (ngSubmit)="submitForReview()">
      <!-- Locked once a study exists, and it has to be: the size, the targeting
           and the questions are settled at creation, so an edit made here can never
           reach the server. Leaving the fields live let the form describe one
           study while submit sent another. (No backticks in these comments: the
           template is a template literal and one would end it here, with the
           compiler pointing at the decorator instead.) -->
      <div class="space-y-8">
      <fieldset class="space-y-8" [disabled]="locked()">
        <section class="space-y-4">
          <mw-field label="Title (internal)">
            <input mw-input name="title" [(ngModel)]="draft.title" [attr.maxlength]="titleMax" />
          </mw-field>
          <mw-field label="Sponsor name shown to developers" hint="Shown in the status line with every question.">
            <input mw-input name="sponsor" [(ngModel)]="draft.sponsor" [attr.maxlength]="sponsorMax" />
          </mw-field>
        </section>

        <section class="space-y-6">
          <h2 class="text-h2 text-ink-900 dark:text-ink-50">Questions ({{ draft.questions.length }} of {{ maxQuestions }})</h2>
          @for (q of draft.questions; track $index; let qi = $index) {
            <div mw-card pad="lg">
              <!-- The character count is the field's hint, not part of its label.
                   It used to sit inside the label element, which means the
                   control's accessible name changed on every keystroke. -->
              <mw-field [label]="'Question ' + (qi + 1)" [hint]="q.text.length + ' of ' + maxQ + ' characters'">
                <input mw-input [name]="'q' + qi" [attr.name]="'q' + qi" [(ngModel)]="q.text" [attr.maxlength]="maxQ" />
              </mw-field>
              @for (o of q.options; track $index; let oi = $index) {
                <!-- An accessible name rather than a shown label: up to five rows a
                     question, and a label over each would be five headings for one
                     list. The placeholder keeps its one honest job. -->
                <div class="mt-2 flex items-center gap-3">
                  <input mw-input [name]="'q' + qi + 'o' + oi" [attr.name]="'q' + qi + 'o' + oi" [attr.aria-label]="'Option ' + (oi + 1) + ' of question ' + (qi + 1)" [(ngModel)]="q.options[oi]" [attr.maxlength]="maxO" placeholder="Option {{ oi + 1 }}" />
                  @if (q.options.length > minOptions) { <button type="button" mw-button variant="quiet" size="sm" (click)="removeOption(q, oi)">remove</button> }
                </div>
              }
              @if (q.options.length < maxOptions) { <button type="button" mw-button variant="quiet" size="sm" class="mt-2" (click)="q.options.push('')">+ option</button> }
              <mw-field class="mt-4" label="Context shown on rich surfaces (optional)" [hint]="q.context.length + ' of ' + maxC + ' characters'">
                <textarea mw-input [name]="'c' + qi" [attr.name]="'c' + qi" [(ngModel)]="q.context" [attr.maxlength]="maxC" rows="2"></textarea>
              </mw-field>
              @if (draft.questions.length > 1) { <button type="button" mw-button variant="quiet" size="sm" class="mt-3" (click)="draft.questions.splice(qi, 1)">remove question</button> }
            </div>
          }
          @if (draft.questions.length < maxQuestions) { <button type="button" mw-button variant="quiet" size="sm" (click)="addQuestion()">+ question</button> }
          <!-- The hold is price x questions x respondents, so a second question
               doubles the bill. Saying so beside the button is cheaper than a
               buyer discovering it in the quote. -->
          <p class="max-w-[68ch] text-small text-ink-600 dark:text-ink-400">Every respondent answers every question, and each answer is paid, so the hold rises with the question count.</p>
        </section>

        <section class="space-y-3">
          <!-- Not PRICING.TARGETING_CENTS: at cost the price is the developer
               share plus a flat fee, so only half the surcharge is billed. The
               figure below is the difference between this buyer's two quotes
               (R49 -- a price in copy comes from the contract, and from the right
               branch of it). -->
          <h2 class="text-h2 text-ink-900 dark:text-ink-50">Targeting (+<mw-money [cents]="surcharge()" /> per response)</h2>
          <div class="flex flex-wrap gap-2">
            @for (l of languages; track l) {
              <button type="button" mw-chip [selected]="draft.targeting.languages.includes(l)" (click)="toggleLanguage(l)" [disabled]="!draft.targeting.languages.includes(l) && draft.targeting.languages.length >= caps.languages">{{ l }}</button>
            }
          </div>
          <!-- The page offers 23 chips for a field the contract takes 10 of. Left
               unenforced the eleventh click is a 400 the audience panel cannot
               explain, so the cap is stated before it is reached and the chips
               past it are not clickable. The number comes from the schema. -->
          @if (draft.targeting.languages.length >= caps.languages) {
            <p class="max-w-[68ch] text-small text-ink-600 dark:text-ink-400">{{ draft.targeting.languages.length }} of {{ caps.languages }} languages selected. You can target at most {{ caps.languages }} languages, so deselect one to choose another.</p>
          }
          <mw-field class="max-w-md" label="Countries (ISO codes, comma separated)" [hint]="countriesOverCap() ? '' : 'At most ' + caps.countries + '.'" [error]="countriesOverCap() ? 'You can target at most ' + caps.countries + ' countries; the rest are ignored.' : ''">
            <input mw-input name="countries" [ngModel]="countriesText" (ngModelChange)="onCountries($event)" placeholder="US, GB" />
          </mw-field>
          <div class="flex flex-wrap gap-2">
            @for (t of tiers; track t) { <button type="button" mw-chip [selected]="draft.targeting.activityTiers.includes(t)" (click)="toggleTier(t)">{{ t }}</button> }
            @for (o of oses; track o) { <button type="button" mw-chip [selected]="draft.targeting.os.includes(o)" (click)="toggleOs(o)">{{ o }}</button> }
          </div>
        </section>

        <section>
          <label class="block max-w-md"><span class="text-small text-ink-600 dark:text-ink-400">Respondents: {{ draft.targetCount }}</span><input name="target" type="range" mw-range [min]="minR" [max]="maxR" step="10" [ngModel]="draft.targetCount" (ngModelChange)="onTargetCount($event)" class="mt-2 w-full" /></label>
          @if (estimate(); as e) {
            <p mw-meta class="mt-2"><span>{{ e.reachable_developers }} reachable developers</span><span>{{ e.estimated_fill_hours === null ? 'no estimate yet' : 'about ' + e.estimated_fill_hours + ' hours to fill' }}</span></p>
          } @else if (estimateFailed()) {
            <!-- Spec 6.7 puts this figure in front of the buyer before they pay.
                 A panel that just disappears is indistinguishable from the
                 feature not existing, which is the silent failure this branch
                 keeps rediscovering. -->
            <mw-banner class="mt-2" tone="error">Couldn't work out the reachable audience for this targeting. The study can still be saved and submitted.</mw-banner>
          }
        </section>
      </fieldset>

        <!-- Outside the fieldset on purpose. Save draft creates without the
             policy gate, and only the navigation carries the buyer off this page
             -- so a navigation that rejects or returns false would leave them
             locked in front of a submit button they could never enable. The tick
             is the one control that must survive the lock. (Still no backticks
             in these comments; one ends the template literal.) -->
        <!-- An ordinary card, where this was an amber panel. mw-banner is the kit's
             amber and it carries role=alert, which is wrong for a standing part of a
             form: it would be announced the moment the page loads, before there is
             anything to react to. And the gate is not the colour -- submit is
             disabled until the box is ticked -- so the tone was decoration, which
             R349 already removed from a more dangerous panel than this one. -->
        <section mw-card pad="lg">
          <h2 class="text-h3 text-ink-900 dark:text-ink-50">Review policy</h2>
          <label class="mt-3 flex items-start gap-3 text-small"><input type="checkbox" name="policy" [(ngModel)]="policyAccepted" class="mt-0.5 size-4 shrink-0 accent-signal-600 dark:accent-signal-400" /><span>This study does not harvest personal data, is not political or adult content, is not deceptively framed, and is not phrased as feedback about Claude Code or Anthropic. I understand that a person reviews it before it goes live and that the sponsor name is always shown to developers.</span></label>
        </section>
      </div>

      <aside mw-card pad="lg" class="h-fit text-small">
        <h2 class="text-h3 text-ink-900 dark:text-ink-50">Quote</h2>
        @if (quote(); as q) {
          <dl class="mt-3 space-y-1">
            <div class="flex justify-between gap-4"><dt>Per valid response</dt><dd><mw-money voice="data" [cents]="q.priceCents" /></dd></div>
            <div class="flex justify-between gap-4"><dt>Developer keeps</dt><dd><mw-money voice="data" [cents]="q.developerCents" /></dd></div>
            <div class="mt-2 flex justify-between gap-4 font-medium"><dt>Hold at submit</dt><dd><mw-money voice="data" [cents]="q.holdCents" /></dd></div>
            <div class="flex justify-between gap-4 text-ink-600 dark:text-ink-400"><dt>Credits available</dt><dd><mw-money voice="data" [cents]="auth.buyer()?.credit_cents ?? 0" /></dd></div>
          </dl>
          <!-- A line, not a panel. It was the last filled green in the application,
               and the tone it wanted -- mw-banner done -- is a live region, which is
               wrong for a statement that is simply true of this buyer on load. -->
          @if (q.atCost) { <p class="mt-3 text-signal-700 dark:text-signal-300">First study at cost: you pay the developers plus fees, we take $0.</p> }
        }
        <!-- The server re-quotes under the buyer's row lock at submit, and that
             number is what is charged. Saying so here keeps the panel a quote
             rather than a promise. -->
        <p class="mt-3 max-w-[68ch] text-small text-ink-600 dark:text-ink-400">Confirmed when the study is submitted; the hold is released for any response that never arrives.</p>
        @if (issues().length) { <ul class="mt-3 list-disc pl-5 text-rejected-fg dark:text-rejected-edge">@for (i of issues(); track i) { <li>{{ i }}</li> }</ul> }
        @if (needCents(); as n) { <mw-banner class="mt-3" tone="error">You need <mw-money [cents]="n" /> in credits to submit. <a mw-link routerLink="/app/credits">Buy credits</a></mw-banner> }
        <!-- Two failures, two sentences. One string covering both told a buyer
             whose study had been saved that it had not been, and the retry it
             invited created a second paid study. -->
        @if (createFailed()) { <mw-banner class="mt-3" tone="error">Couldn't save the study, and nothing was created. Try again.</mw-banner> }
        @if (submitFailed()) { <mw-banner class="mt-3" tone="error">Saved as a draft, but it couldn't be sent for review. Try again.</mw-banner> }
        @if (savedStudy(); as saved) {
          <p class="mt-3 max-w-[68ch] text-small text-ink-600 dark:text-ink-400">Saved as a draft of {{ saved.questions.length }} question(s) for {{ saved.target_count }} respondents, so the form above is locked and submitting again sends that draft rather than a second study — <a mw-link [routerLink]="['/app/studies', saved.id]">open the saved draft</a>.</p>
        }
        <div class="mt-4 flex flex-col gap-2">
          <button type="button" mw-button variant="secondary" (click)="saveDraft()" [disabled]="busy()">{{ locked() ? 'Open the saved draft' : 'Save draft' }}</button>
          <button type="submit" mw-button [disabled]="busy() || !policyAccepted">{{ locked() ? 'Send the saved draft for review' : 'Submit for review' }}</button>
        </div>
      </aside>
    </form>`,
})
export default class NewStudyPage {
  auth = inject(AuthState)
  private api = inject(ApiService)
  private router = inject(Router)

  draft: StudyDraft = emptyDraft()
  policyAccepted = false
  /** What the buyer typed, kept apart from the codes parsed out of it. */
  countriesText = ''

  languages = LANGUAGES
  tiers = ['light', 'regular', 'heavy'] as const
  oses = ['win32', 'darwin', 'linux'] as const
  maxQ = RULES.QUESTION_TEXT_MAX; maxO = RULES.OPTION_TEXT_MAX; maxC = RULES.CONTEXT_MAX
  titleMax = TITLE_MAX; sponsorMax = SPONSOR_MAX
  minOptions = MIN_OPTIONS; maxOptions = MAX_OPTIONS; maxQuestions = MAX_QUESTIONS
  minR = PRICING.MIN_RESPONDENTS; maxR = PRICING.MAX_RESPONDENTS
  caps = TARGETING_CAPS

  issues = signal<string[]>([])
  needCents = signal<number | null>(null)
  createFailed = signal(false)
  submitFailed = signal(false)
  busy = signal(false)
  estimate = signal<AudienceEstimate | null>(null)
  estimateFailed = signal(false)
  private estimateTimer: ReturnType<typeof setTimeout> | undefined

  /**
   * The study this form has already created, and from here on the only honest source
   * for the quote. It stops a retry minting a second paid study *while this page is
   * alive*; submit is where credits are held, so a second study is a second hold.
   */
  savedStudy = signal<StudyView | null>(null)
  private createInFlight: Promise<string> | null = null

  /**
   * The other half, and the half this page could never provide on its own: the server
   * keys `POST /api/buyer/studies` on `Idempotency-Key`, so a create whose *response*
   * was lost after the server committed comes back as the study it committed rather
   * than as a second draft.
   *
   * Regenerated when the draft changes between attempts. A retry of the same study is
   * a replay and has to dedupe; a retry of an edited study is a different study, and
   * replaying the old key would hand back the study typed a minute ago -- which the
   * server refuses with a 409 rather than doing, so this is also what keeps that
   * status off this screen.
   */
  private idempotencyKey = newIdempotencyKey()
  private lastAttempt: string | null = null

  /** Once a study exists, nothing typed here can reach the server. */
  locked() { return this.savedStudy() !== null }

  constructor() {
    // A timer that outlives the page fires a request nobody is waiting for, into
    // a signal nobody reads.
    inject(DestroyRef).onDestroy(() => clearTimeout(this.estimateTimer))
    // Spec 6.7: the buyer sees the reachable audience and the fill time *before*
    // paying. Waiting for the first targeting click would leave a buyer who
    // targets nobody -- the default, and the widest audience there is -- with no
    // audience figure at all, on the screen where the study is bought. Not
    // debounced: nothing precedes it to coalesce with.
    void this.loadEstimate()
  }

  /**
   * A method, not a `computed`. The draft is a plain mutable object, so the only
   * signal a `computed` here would depend on is `auth.buyer()` -- it would cache
   * the first quote and go on showing the hold for a study the buyer had stopped
   * describing, which is the one number on this page they commit money against.
   * A method is re-evaluated on every change detection pass, which is what the
   * form's own events already trigger.
   */
  quote() {
    const firstStudyUsed = this.auth.buyer()?.first_study_used ?? true
    const saved = this.savedStudy()
    // The panel quotes what will actually be charged. After a study exists that
    // is the stored study, not the form: submit sends the saved one, and its
    // size and question count are what the server multiplies.
    return saved ? quoteForSaved(saved, firstStudyUsed) : quoteFor(this.draft, firstStudyUsed)
  }

  /** An unknown buyer is quoted the full price: overstating is the safe direction. */
  surcharge() { return targetingSurcharge(!(this.auth.buyer()?.first_study_used ?? true)) }

  toggleLanguage(l: string): void { this.toggleCapped(this.draft.targeting.languages, l, this.caps.languages) }
  toggleTier(t: StudyDraft['targeting']['activityTiers'][number]): void { this.toggleCapped(this.draft.targeting.activityTiers, t, this.caps.activityTiers) }
  toggleOs(o: StudyDraft['targeting']['os'][number]): void { this.toggleCapped(this.draft.targeting.os, o, this.caps.os) }

  /** Read off the field every time it is asked, so no later click can wipe it. */
  countriesOverCap(): boolean { return this.splitCodes(this.countriesText).length > this.caps.countries }

  /**
   * Deselecting is always allowed; selecting past the contract's cap is not.
   * The chips past the cap are disabled too, so this is the defensive half --
   * it is what holds if a caller reaches the model some other way.
   */
  private toggleCapped<T>(list: T[], v: T, cap: number): void {
    const i = list.indexOf(v)
    if (i >= 0) list.splice(i, 1)
    else if (list.length >= cap) return
    else list.push(v)
    this.refreshEstimate()
  }

  /**
   * Two ASCII letters, not any two characters: `U1` and `1!` are typos, and the
   * contract's `length(2)` accepts both. It still accepts `ZZ` and `QQ`, which
   * are real ISO user-assigned codes and target nobody -- narrowing that needs a
   * country list, which belongs in the contract rather than here.
   */
  splitCodes(s: string): string[] { return s.split(',').map((c) => c.trim().toUpperCase()).filter((c) => /^[A-Z]{2}$/.test(c)) }

  onCountries(typed: string): void {
    this.countriesText = typed
    this.draft.targeting.countries = this.splitCodes(typed).slice(0, this.caps.countries)
    this.refreshEstimate()
  }

  onTargetCount(count: number): void {
    this.draft.targetCount = Number(count)
    this.refreshEstimate()
  }

  addQuestion(): void { this.draft.questions.push(newQuestion()) }
  removeOption(q: StudyDraft['questions'][number], index: number): void { q.options.splice(index, 1) }

  /**
   * Asks about the targeting on its own rather than about a parsed `StudyInput`:
   * this panel is what a buyer reads while choosing who to ask, which is before
   * the title and the question exist. A whole-study parse fails on that draft and
   * would send `targeting: undefined`, so the estimate would report the entire
   * population and quietly ignore every chip just clicked.
   */
  private async loadEstimate(): Promise<void> {
    const targeting = targetingOf(this.draft)
    try {
      this.estimate.set(await this.api.estimate({ targeting, target_count: Number(this.draft.targetCount) }))
      this.estimateFailed.set(false)
    } catch {
      // Advisory, so it must not stop the buyer writing the study -- but it is
      // also spec 6.7's figure, so a failure is said out loud rather than
      // swallowed. A panel that silently vanishes reads as no feature at all.
      this.estimate.set(null)
      this.estimateFailed.set(true)
    }
  }

  /** Debounced, so four targeting clicks ask the server once. */
  refreshEstimate(): void {
    clearTimeout(this.estimateTimer)
    this.estimateTimer = setTimeout(() => void this.loadEstimate(), ESTIMATE_DEBOUNCE_MS)
  }

  /**
   * Idempotent for the life of this form. Once a draft exists on the server it is
   * never created again, whatever the buyer clicks next, and two concurrent calls
   * share one request rather than racing into two rows.
   *
   * This half closes the path the page itself invites -- a failed or credit-refused
   * submit, then a retry. The create whose *response* was lost after the server
   * committed is closed by the other half, the `Idempotency-Key` below: this page
   * never sees that response, so to it the retry is simply a second POST.
   */
  private async create(): Promise<string | null> {
    const already = this.savedStudy()?.id
    if (already) return already
    if (this.createInFlight) return this.createInFlight
    const r = toStudyInput(this.draft)
    if (!r.ok) { this.issues.set(r.issues); return null }
    this.issues.set([])
    // The contract input, not the draft: whitespace and blank option rows are already
    // gone, so two attempts that differ only in those are the same study and share a key.
    const attempt = JSON.stringify(r.input)
    if (this.lastAttempt !== null && this.lastAttempt !== attempt) this.idempotencyKey = newIdempotencyKey()
    this.lastAttempt = attempt
    this.createInFlight = this.api.createStudy(r.input, this.idempotencyKey).then((study) => {
      // The whole study, not just its id: from here the quote panel reads this
      // rather than the form, because this is what submit will send.
      this.savedStudy.set(study)
      return study.id
    })
    try {
      return await this.createInFlight
    } finally {
      this.createInFlight = null
    }
  }

  async saveDraft(): Promise<void> {
    this.busy.set(true)
    this.createFailed.set(false)
    this.submitFailed.set(false)
    try {
      const id = await this.create()
      if (id) await this.router.navigate(['/app/studies', id])
    } catch {
      this.createFailed.set(true)
    } finally {
      this.busy.set(false)
    }
  }

  async submitForReview(): Promise<void> {
    // The disabled submit button is what a buyer sees of this gate; this is the
    // half that holds when the form is submitted some other way. The tick is a
    // claim the buyer makes about the study, and a person reviews it against
    // exactly that claim.
    //
    // (Wording here is load-bearing for a second reason: Tailwind scans this file
    // and mints a utility from any word that is one. Two rules were shipped from
    // this comment before it was reworded -- see R47.)
    if (!this.policyAccepted) {
      this.issues.set(['Accept the review policy before submitting.'])
      return
    }
    this.busy.set(true)
    this.needCents.set(null)
    this.createFailed.set(false)
    this.submitFailed.set(false)
    try {
      // Two failures, kept apart. One `catch` around both told a buyer whose
      // study had just been saved that it had not been, and the retry that
      // message invited created a second one -- two holds for one intended study.
      let id: string | null
      try {
        id = await this.create()
      } catch {
        this.createFailed.set(true)
        return
      }
      if (!id) return
      try {
        await this.api.submitStudy(id)
        await this.router.navigate(['/app/studies', id])
      } catch (e) {
        // 402 is the one failure the buyer can act on from here. The study stays
        // a draft and the at-cost entitlement is not spent (the server rolls the
        // whole transaction back), so the balance is re-read and they are sent to
        // buy credits. Submitting again sends the draft above, not a new study.
        if (e instanceof ApiError && e.status === 402) {
          const b = e.body as { required_cents: number }
          this.needCents.set(b.required_cents)
          // A failure here is "cannot tell what the balance is", not "cannot
          // submit"; the amount they need is already on screen either way.
          try { await this.auth.refreshBuyer() } catch { /* keep the known balance */ }
        } else {
          this.submitFailed.set(true)
        }
      }
    } finally {
      this.busy.set(false)
    }
  }
}
