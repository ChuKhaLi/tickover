import { Component, DestroyRef, ElementRef, inject, signal } from '@angular/core'
import { FormsModule } from '@angular/forms'
import { Router, RouterLink } from '@angular/router'
import type { RouteMeta } from '@analogjs/router'
import { LANGUAGES, LANGUAGE_LABELS, OS_LABELS, PRICING, RULES, type AudienceEstimate, type StudyView } from '@tickover/contract'
import { ApiService, newIdempotencyKey } from '../../../lib/api'
import { AuthState, buyerGuard } from '../../../lib/auth'
import { SITE_NAME } from '../../../lib/page-meta'
import { previewQuestion, type PreviewSurface, type PreviewWidth } from '../../../lib/question-preview'
import {
  MAX_OPTIONS, MAX_QUESTIONS, MIN_OPTIONS, SPONSOR_MAX, TARGETING_CAPS, TITLE_MAX,
  activityTierLabel, emptyDraft, issueMessages, newQuestion, quoteFor, quoteForSaved, targetingOf, targetingSurcharge, toStudyInput, type FormIssue, type StudyDraft,
} from '../../../lib/study-form'
import { Banner } from '../../../ui/banner'
import { Button, Link } from '../../../ui/button'
import { Card } from '../../../ui/card'
import { Chip } from '../../../ui/chip'
import { CountryPicker } from '../../../ui/country-picker'
import { Field } from '../../../ui/field'
import { Input, Range } from '../../../ui/input'
import { Meta } from '../../../ui/meta'
import { Money } from '../../../ui/money'
import { QuestionPreview } from '../../../ui/question-preview'
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
  imports: [FormsModule, RouterLink, Banner, Button, Card, Chip, CountryPicker, Field, Input, Link, Meta, Money, PageHeader, QuestionPreview, Range],
  template: `
    <tk-page-header heading="New study" />
    <form class="grid gap-8 lg:grid-cols-[1fr_20rem]" (ngSubmit)="submitForReview()">
      <!-- Locked once a study exists, and it has to be: the size, the targeting
           and the questions are settled at creation, so an edit made here can never
           reach the server. Leaving the fields live let the form describe one
           study while submit sent another. (No backticks in these comments: the
           template is a template literal and one would end it here, with the
           compiler pointing at the decorator instead.) -->
      <div class="min-w-0 space-y-8">
      <fieldset class="min-w-0 space-y-8" [disabled]="locked()">
        <section class="space-y-4">
          <tk-field label="Title (internal)" [error]="errorFor('title')">
            <input tk-input name="title" [(ngModel)]="draft.title" [attr.maxlength]="titleMax" />
          </tk-field>
          <tk-field label="Sponsor name shown to developers" hint="Shown in the status line with every question." [error]="errorFor('sponsor')">
            <input tk-input name="sponsor" [(ngModel)]="draft.sponsor" [attr.maxlength]="sponsorMax" />
          </tk-field>
        </section>

        <section class="space-y-6">
          <h2 class="text-h2 text-ink-900 dark:text-ink-50">Questions ({{ draft.questions.length }} of {{ maxQuestions }})</h2>
          @for (q of draft.questions; track $index; let qi = $index) {
            <div tk-card pad="lg">
              <!-- The character count is the field's hint, not part of its label.
                   It used to sit inside the label element, which means the
                   control's accessible name changed on every keystroke. -->
              <tk-field [label]="'Question ' + (qi + 1)" [hint]="q.text.length + ' of ' + maxQ + ' characters'" [error]="errorFor('questions.' + qi + '.text')">
                <input tk-input [name]="'q' + qi" [attr.name]="'q' + qi" [(ngModel)]="q.text" [attr.maxlength]="maxQ" />
              </tk-field>
              @for (o of q.options; track $index; let oi = $index) {
                <!-- An accessible name rather than a shown label: up to five rows a
                     question, and a label over each would be five headings for one
                     list. The placeholder keeps its one honest job. -->
                <div class="mt-2 flex items-center gap-3">
                  <input tk-input [name]="'q' + qi + 'o' + oi" [attr.name]="'q' + qi + 'o' + oi" [attr.aria-label]="'Option ' + (oi + 1) + ' of question ' + (qi + 1)" [attr.aria-invalid]="oi === optionsErrorRow(qi) && errorFor('questions.' + qi + '.options') ? 'true' : null" [attr.aria-describedby]="oi === optionsErrorRow(qi) && errorFor('questions.' + qi + '.options') ? 'q' + qi + '-options-error' : null" [(ngModel)]="q.options[oi]" [attr.maxlength]="maxO" placeholder="Option {{ oi + 1 }}" />
                  @if (q.options.length > minOptions) { <button type="button" tk-button variant="quiet" size="sm" (click)="removeOption(q, oi)">Remove</button> }
                </div>
              }
              @if (errorFor('questions.' + qi + '.options'); as oe) {
                <p class="mt-1.5 max-w-[68ch] text-small text-rejected-fg dark:text-rejected-edge" [id]="'q' + qi + '-options-error'" [attr.data-options-error]="qi">{{ oe }}</p>
              }
              @if (q.options.length < maxOptions) { <button type="button" tk-button variant="quiet" size="sm" class="mt-2" (click)="q.options.push('')">+ Add option</button> }
              <tk-question-preview [preview]="preview(qi)" [(width)]="previewWidth" [(surface)]="previewSurface" />
              <tk-field class="mt-4" label="Context (optional)" [hint]="['Shown in the Tickover pane and the VS Code extension, not in the status line or the band.', q.context.length + ' of ' + maxC + ' characters']" [error]="errorFor('questions.' + qi + '.context')">
                <textarea tk-input [name]="'c' + qi" [attr.name]="'c' + qi" [(ngModel)]="q.context" [attr.maxlength]="maxC" rows="2"></textarea>
              </tk-field>
              @if (draft.questions.length > 1) { <button type="button" tk-button variant="quiet" size="sm" class="mt-3" (click)="draft.questions.splice(qi, 1)">Remove question</button> }
            </div>
          }
          @if (draft.questions.length < maxQuestions) { <button type="button" tk-button variant="quiet" size="sm" (click)="addQuestion()">+ Add question</button> }
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
          <h2 class="text-h2 text-ink-900 dark:text-ink-50">Targeting (+<tk-money [cents]="surcharge()" /> per response)</h2>
          <p class="max-w-[68ch] text-small text-ink-600 dark:text-ink-400">Within a group a developer matches any choice; across groups they must match every group. Choosing an operating system leaves out developers whose system we don't know yet.</p>
          <div role="group" aria-labelledby="tg-languages" class="space-y-2">
            <h3 class="text-body font-semibold text-ink-900 dark:text-ink-50" id="tg-languages">Languages</h3>
            <div class="flex flex-wrap gap-2">
              @for (l of languages; track l) {
                <button type="button" tk-chip [selected]="draft.targeting.languages.includes(l)" (click)="toggleLanguage(l)" [disabled]="!draft.targeting.languages.includes(l) && draft.targeting.languages.length >= caps.languages">{{ languageLabels[l] }}</button>
              }
            </div>
            <!-- The page offers 23 chips for a field the contract takes 10 of. Left
                 unenforced the eleventh click is a 400 the audience panel cannot
                 explain, so the cap is stated before it is reached and the chips
                 past it are not clickable. The number comes from the schema. -->
            @if (draft.targeting.languages.length >= caps.languages) {
              <p class="max-w-[68ch] text-small text-ink-600 dark:text-ink-400">{{ draft.targeting.languages.length }} of {{ caps.languages }} languages selected. You can target at most {{ caps.languages }} languages, so deselect one to choose another.</p>
            }
          </div>
          <div role="group" aria-labelledby="tg-countries" class="space-y-2">
            <h3 class="text-body font-semibold text-ink-900 dark:text-ink-50" id="tg-countries">Countries</h3>
            <tk-country-picker [value]="draft.targeting.countries" (valueChange)="onCountries($event)" [cap]="caps.countries" [disabled]="locked()" />
          </div>
          <div role="group" aria-labelledby="tg-activity" class="space-y-2">
            <h3 class="text-body font-semibold text-ink-900 dark:text-ink-50" id="tg-activity">Activity</h3>
            <div class="flex flex-wrap gap-2">@for (t of tiers; track t) { <button type="button" tk-chip [selected]="draft.targeting.activityTiers.includes(t)" (click)="toggleTier(t)">{{ tierLabel(t) }}</button> }</div>
          </div>
          <div role="group" aria-labelledby="tg-os" class="space-y-2">
            <h3 class="text-body font-semibold text-ink-900 dark:text-ink-50" id="tg-os">Operating system</h3>
            <div class="flex flex-wrap gap-2">@for (o of oses; track o) { <button type="button" tk-chip [selected]="draft.targeting.os.includes(o)" (click)="toggleOs(o)">{{ osLabels[o] }}</button> }</div>
          </div>
        </section>

        <section>
          <div class="flex max-w-md flex-col gap-2">
            <label for="target-count" class="text-small font-medium text-ink-800 dark:text-ink-100">Respondents</label>
            <div class="flex items-center gap-3">
              <input name="target" type="range" tk-range aria-label="Respondents" [min]="minR" [max]="maxR" step="10" [ngModel]="draft.targetCount" (ngModelChange)="onTargetCount($event)" class="w-full" />
              <input id="target-count" tk-input size="sm" name="targetCount" type="number" inputmode="numeric" [min]="minR" [max]="maxR" step="1" [ngModel]="draft.targetCount" (ngModelChange)="onTargetTyped($event)" [attr.aria-invalid]="errorFor('target_count') ? 'true' : null" [attr.aria-describedby]="errorFor('target_count') ? 'target-count-error' : null" class="w-24" />
            </div>
            @if (errorFor('target_count'); as te) { <p id="target-count-error" class="text-small text-rejected-fg dark:text-rejected-edge">{{ te }}</p> }
          </div>
          @if (estimate(); as e) {
            <p tk-meta class="mt-2"><span>{{ e.reachable_developers }} reachable developers</span><span>{{ e.estimated_fill_hours === null ? 'no estimate yet' : 'about ' + e.estimated_fill_hours + ' hours to fill' }}</span></p>
            @if (e.reachable_developers === 0) {
              <!-- A line, not tk-banner: banner is role=alert, and a standing state is not an interruption. -->
              <p data-zero-audience class="mt-2 max-w-[68ch] text-small text-review-fg dark:text-review-edge">{{ targeted() ? 'No developer matches this targeting right now, so the study would not fill.' : 'No developers are active on Tickover yet, so the study would not fill.' }}</p>
            }
          } @else if (estimateFailed()) {
            <!-- Spec 6.7 puts this figure in front of the buyer before they pay.
                 A panel that just disappears is indistinguishable from the
                 feature not existing, which is the silent failure this branch
                 keeps rediscovering. -->
            <tk-banner class="mt-2" tone="error">Couldn't work out the reachable audience for this targeting. The study can still be saved and submitted.</tk-banner>
          }
        </section>
      </fieldset>

        <!-- Outside the fieldset on purpose. Save draft creates without the
             policy gate, and only the navigation carries the buyer off this page
             -- so a navigation that rejects or returns false would leave them
             locked in front of a submit button they could never enable. The tick
             is the one control that must survive the lock. (Still no backticks
             in these comments; one ends the template literal.) -->
        <!-- An ordinary card, where this was an amber panel. tk-banner is the kit's
             amber and it carries role=alert, which is wrong for a standing part of a
             form: it would be announced the moment the page loads, before there is
             anything to react to. And the gate is not the colour -- submit is
             disabled until the box is ticked -- so the tone was decoration, which
             R349 already removed from a more dangerous panel than this one. -->
        <section tk-card pad="lg">
          <h2 class="text-h3 text-ink-900 dark:text-ink-50">Review policy</h2>
          <label class="mt-3 flex items-start gap-3 text-small"><input type="checkbox" name="policy" [(ngModel)]="policyAccepted" class="mt-0.5 size-4 shrink-0 accent-signal-600 dark:accent-signal-400" /><span>This study does not harvest personal data, is not political or adult content, is not deceptively framed, and is not phrased as feedback about Claude Code or Anthropic. I understand that a person reviews it before it goes live and that the sponsor name is always shown to developers.</span></label>
        </section>
      </div>

      <aside tk-card pad="lg" class="h-fit text-small lg:sticky lg:top-6">
        <h2 class="text-h3 text-ink-900 dark:text-ink-50">Quote</h2>
        @if (quote(); as q) {
          <dl class="mt-3 space-y-1">
            <div class="flex justify-between gap-4"><dt>Per valid response</dt><dd><tk-money voice="data" [cents]="q.priceCents" /></dd></div>
            <div class="flex justify-between gap-4"><dt>Developer keeps</dt><dd><tk-money voice="data" [cents]="q.developerCents" /></dd></div>
            <div class="mt-2 flex justify-between gap-4 font-medium"><dt>Hold at submit</dt><dd><tk-money voice="data" [cents]="q.holdCents" /></dd></div>
            <div class="flex justify-between gap-4 text-ink-600 dark:text-ink-400"><dt>Credits available</dt><dd><tk-money voice="data" [cents]="auth.buyer()?.credit_cents ?? 0" /></dd></div>
          </dl>
          <!-- A line, not a panel. It was the last filled green in the application,
               and the tone it wanted -- tk-banner done -- is a live region, which is
               wrong for a statement that is simply true of this buyer on load. -->
          @if (q.atCost) { <p class="mt-3 text-signal-700 dark:text-signal-300">First study at cost: you pay the developers plus fees, we take $0.</p> }
        }
        <!-- The server re-quotes under the buyer's row lock at submit, and that
             number is what is charged. Saying so here keeps the panel a quote
             rather than a promise. -->
        <p class="mt-3 max-w-[68ch] text-small text-ink-600 dark:text-ink-400">Confirmed when the study is submitted; the hold is released for any response that never arrives.</p>
        @if (issueList().length) { <ul class="mt-3 list-disc pl-5 text-rejected-fg dark:text-rejected-edge">@for (i of issueList(); track i) { <li>{{ i }}</li> }</ul> }
        <!-- Two failures, two sentences. One string covering both told a buyer
             whose study had been saved that it had not been, and the retry it
             invited created a second paid study. -->
        @if (createFailed()) { <tk-banner class="mt-3" tone="error">Couldn't save the study, and nothing was created. Try again.</tk-banner> }
        @if (submitFailed()) { <tk-banner class="mt-3" tone="error">Saved as a draft, but it couldn't be sent for review. Try again.</tk-banner> }
        @if (savedStudy(); as saved) {
          <p class="mt-3 max-w-[68ch] text-small text-ink-600 dark:text-ink-400">Saved as a draft of {{ saved.questions.length }} question(s) for {{ saved.target_count }} respondents, so the form above is locked and submitting again sends that draft rather than a second study — <a tk-link [routerLink]="['/app/studies', saved.id]">open the saved draft</a>.</p>
        }
        <div class="mt-4 flex flex-col gap-2">
          <button type="button" tk-button variant="secondary" (click)="saveDraft()" [disabled]="busy()">{{ locked() ? 'Open the saved draft' : 'Save draft' }}</button>
          <button type="submit" tk-button [disabled]="busy() || !policyAccepted">{{ locked() ? 'Send the saved draft for review' : 'Submit for review' }}</button>
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

  languages = LANGUAGES
  languageLabels = LANGUAGE_LABELS
  osLabels = OS_LABELS
  tierLabel = activityTierLabel
  tiers = ['light', 'regular', 'heavy'] as const
  oses = ['win32', 'darwin', 'linux'] as const
  maxQ = RULES.QUESTION_TEXT_MAX; maxO = RULES.OPTION_TEXT_MAX; maxC = RULES.CONTEXT_MAX
  titleMax = TITLE_MAX; sponsorMax = SPONSOR_MAX
  minOptions = MIN_OPTIONS; maxOptions = MAX_OPTIONS; maxQuestions = MAX_QUESTIONS
  minR = PRICING.MIN_RESPONDENTS; maxR = PRICING.MAX_RESPONDENTS
  caps = TARGETING_CAPS

  private host = inject(ElementRef<HTMLElement>)
  /** D2: one width and one surface for every card, so comparing questions is one click. */
  previewWidth = signal<PreviewWidth>(80)
  previewSurface = signal<PreviewSurface>('status')
  preview(qi: number) { return previewQuestion(this.draft.questions[qi]!, this.draft.sponsor, this.quote().developerCents) }

  /** Errors appear at fields only after the buyer has tried to save or submit. */
  attempted = signal(false)
  /** Submit was pressed with the review policy unticked; the sentence goes when the box is ticked. */
  private policyAttempted = signal(false)
  private issueCache: { key: string; issues: FormIssue[] } | undefined

  /**
   * R810: derived from the draft on every pass once the buyer has attempted, never a
   * snapshot of the last attempt. A snapshot keyed by question position left a corrected
   * field red and, when a question was removed, put its errors on the wrong question.
   * `toStudyInput` is pure, so this costs one parse per change of the draft.
   */
  issues(): FormIssue[] {
    const out: FormIssue[] = []
    if (this.attempted()) {
      const key = JSON.stringify(this.draft)
      if (this.issueCache?.key !== key) {
        const r = toStudyInput(this.draft)
        this.issueCache = { key, issues: r.ok ? [] : r.issues }
      }
      out.push(...this.issueCache.issues)
    }
    if (this.policyAttempted() && !this.policyAccepted) out.push({ path: 'policy', message: 'Accept the review policy before submitting.' })
    return out
  }

  errorFor(key: string): string {
    return this.issues().filter((i) => i.path === key).map((i) => i.message).join(' ')
  }
  /** The row that carries the flag: the offending one, or the first when the list itself is short. */
  optionsErrorRow(qi: number): number {
    return this.issues().find((i) => i.path === 'questions.' + qi + '.options' && i.row !== undefined)?.row ?? 0
  }
  issueList(): string[] { return issueMessages(this.issues()) }

  /** After the render that marks the fields invalid, not before it. */
  private focusFirstInvalid(): void {
    setTimeout(() => (this.host.nativeElement.querySelector('[aria-invalid="true"]') as HTMLElement | null)?.focus(), 0)
  }
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

  /** Whether the draft narrows the audience at all: with no targeting, "this targeting" names nothing. */
  targeted() { return targetingOf(this.draft) !== undefined }

  /** An unknown buyer is quoted the full price: overstating is the safe direction. */
  surcharge() { return targetingSurcharge(!(this.auth.buyer()?.first_study_used ?? true)) }

  toggleLanguage(l: string): void { this.toggleCapped(this.draft.targeting.languages, l, this.caps.languages) }
  toggleTier(t: StudyDraft['targeting']['activityTiers'][number]): void { this.toggleCapped(this.draft.targeting.activityTiers, t, this.caps.activityTiers) }
  toggleOs(o: StudyDraft['targeting']['os'][number]): void { this.toggleCapped(this.draft.targeting.os, o, this.caps.os) }

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

  onCountries(codes: string[]): void {
    this.draft.targeting.countries = codes
    this.refreshEstimate()
  }

  onTargetCount(count: number): void {
    this.draft.targetCount = Number(count)
    this.refreshEstimate()
  }

  /**
   * D5: a count outside the contract's range is a keystroke in progress, not a question for the server.
   * R813: and it stays as typed. Pressing Submit takes focus off this field first, so a clamp
   * when it lost focus rewrote the count and the hold was placed on a number the buyer never saw; now the field
   * shows its error and nothing is sent. A non-integer (75.5 pasted over 100) is stored too, not
   * skipped: skipping left the field showing 75.5 while the draft held 100, and the hold was
   * placed on the 100.
   */
  onTargetTyped(v: number | string): void {
    const n = Number(v)
    this.draft.targetCount = n
    if (Number.isInteger(n) && n >= this.minR && n <= this.maxR) this.refreshEstimate()
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
    // Every path that asks (chips, countries, the count field, the timer armed
    // before a later keystroke) comes through here, so the range is held here:
    // a count the buyer is still typing would only earn a 400 and the banner.
    const count = Number(this.draft.targetCount)
    if (!(Number.isInteger(count) && count >= this.minR && count <= this.maxR)) return
    const targeting = targetingOf(this.draft)
    try {
      this.estimate.set(await this.api.estimate({ targeting, target_count: count }))
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
    if (!r.ok) { this.attempted.set(true); this.focusFirstInvalid(); return null }
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
      this.policyAttempted.set(true)
      return
    }
    this.busy.set(true)
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
        // Submit is always a 200 now (R501): a study the balance does not cover
        // comes back `awaiting_payment` rather than a 402, and the study page --
        // where the navigation below lands -- is what shows the payment panel.
        await this.api.submitStudy(id)
        await this.router.navigate(['/app/studies', id])
      } catch {
        this.submitFailed.set(true)
      }
    } finally {
      this.busy.set(false)
    }
  }
}
