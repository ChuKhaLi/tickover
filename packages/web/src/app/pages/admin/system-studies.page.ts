import { Component, inject, signal } from '@angular/core'
import { DatePipe } from '@angular/common'
import { FormsModule } from '@angular/forms'
import type { RouteMeta } from '@analogjs/router'
import { QuestionInput, RULES, SystemStudyInput, type StudyView } from '@tickover/contract'
import { ApiService } from '../../lib/api'
import { adminGuard } from '../../lib/auth'
import { SITE_NAME } from '../../lib/page-meta'
import { Banner } from '../../ui/banner'
import { Button } from '../../ui/button'
import { Card } from '../../ui/card'
import { Confirm } from '../../ui/confirm'
import { Empty } from '../../ui/empty'
import { Field } from '../../ui/field'
import { Input } from '../../ui/input'
import { PageHeader } from '../../ui/page-header'

export const routeMeta = { title: `${SITE_NAME} — System studies`, canActivate: [adminGuard] } satisfies RouteMeta

interface Q { text: string; options: string[]; context: string; correct: number | null }

const emptyQuestion = (): Q => ({ text: '', options: ['', ''], context: '', correct: null })

/**
 * Field bounds asked of the contract rather than retyped. `QuestionInput` is a
 * plain object schema, so its string bounds are public getters. `SystemStudyInput`
 * is a *refined* schema — the attention-study rule makes it a `ZodEffects`, which
 * has no `.shape` — but `innerType()` is public API and hands back the object it
 * wraps, so the title's bounds are read exactly rather than searched for.
 */
const FIELDS = SystemStudyInput.innerType().shape
const TITLE_MAX = FIELDS.title.maxLength ?? 80
const TITLE_MIN = FIELDS.title.minLength ?? 3
const TEXT_MAX = QuestionInput.shape.text.maxLength ?? RULES.QUESTION_TEXT_MAX
const OPTION_MAX = QuestionInput.shape.options.element.maxLength ?? RULES.OPTION_TEXT_MAX
const CONTEXT_MAX = QuestionInput.shape.context.unwrap().maxLength ?? RULES.CONTEXT_MAX
/**
 * The option-count bounds, asked of the schema rather than typed. Every other bound
 * on this page is read off the contract; these two were the survivors, and they are
 * what the add/remove buttons enable and disable -- so a contract that widened to six
 * options would leave this page unable to author one, silently.
 *
 * Both ends, and the whole range scanned: `options` has a minimum as well as a
 * maximum, and the version of the sibling probe that stopped at the first rejection
 * answered 0 for the title for exactly that reason (see `largestAccepted` below).
 */
function acceptedCounts(build: (n: number) => unknown, ceiling: number): number[] {
  const ok: number[] = []
  for (let n = 0; n <= ceiling; n++) if (SystemStudyInput.safeParse(build(n)).success) ok.push(n)
  // A probe that accepted nothing measured nothing, and there is no safe number to carry on
  // with. The branch review found the previous version handing back `?? 2` and `?? 5` -- the
  // very literals this replaced -- with the ceiling set to 0 and the whole 408-test web suite
  // green: the spec checked the *effective* numbers against the schema, and 2 and 5 are today's
  // true bounds, so it could not tell a working probe from a dead one. Failing at module load
  // is what makes the difference visible.
  if (!ok.length) throw new Error('option-count probe accepted no size at all; the schema or the ceiling is wrong')
  return ok
}
const OPTION_COUNTS = acceptedCounts(
  (n) => ({ kind: 'profile', title: 'A profile question', questions: [{ text: 'Which model do you use most?', options: Array.from({ length: n }, (_, i) => `Option ${i + 1}`) }] }),
  16,
)
const MIN_OPTIONS = OPTION_COUNTS[0]!
const MAX_OPTIONS = OPTION_COUNTS[OPTION_COUNTS.length - 1]!

const sample = { text: 'Which model do you use most?', options: ['Opus', 'Sonnet'] }

/**
 * How many questions the schema accepts. `ZodArray` has no public bound getter, so
 * this is the one number that still has to be asked for rather than read: the
 * schema is offered candidates of growing size and the answer is **the largest n it
 * accepts**, scanning the whole range.
 *
 * Scanning rather than stopping at the first rejection is not a style preference.
 * The version of this that stopped at the first rejection was also used for the
 * *title*, which has a minimum as well as a maximum — so n=1 was rejected for being
 * too short and the answer came back **0**. The field rendered `maxlength="0"`,
 * Chromium refused both typing and pasting, `min(3)` could never be satisfied, and
 * the page could not author a study at all. All twelve tests here were green,
 * because every one of them filled the model instead of the input.
 *
 * What this guarantees, precisely: the largest n in 1..ceiling that the schema
 * accepts. It does **not** guarantee that every smaller n is accepted — a
 * non-contiguous bound would return the top of the range and say nothing about the
 * holes — and it returns 0 if nothing in the range parses. Neither failure is
 * silent: `system-studies.page.spec.ts` checks this value against the schema at and
 * past the bound, and checks every rendered `maxlength` against its own field's
 * minimum, which is the assertion the zero would have failed.
 */
function largestAccepted(build: (n: number) => unknown, ceiling: number): number {
  let best = 0
  for (let n = 1; n <= ceiling; n++) if (SystemStudyInput.safeParse(build(n)).success) best = n
  return best
}
const MAX_QUESTIONS = largestAccepted((n) => ({ kind: 'profile', title: 'A profile question', questions: Array.from({ length: n }, () => sample) }), 64)

@Component({
  imports: [FormsModule, DatePipe, Banner, Button, Card, Confirm, Empty, Field, Input, PageHeader],
  template: `
    <mw-page-header heading="System studies" />
    <!-- Both kinds are created live and shown to developers straight away; the
         admin API has no draft state for them and no way to take one down from
         here. What each kind then does is spelled out on the confirmation, because
         one of them publishes to the open internet and the other reverses money. -->
    <p class="mt-3 max-w-[68ch] text-small text-ink-600 dark:text-ink-400">Tickover is the sponsor and the questions are unpaid on this study's own row. Profile questions are asked at most {{ profilePerDay }} a day per developer and their answer counts are published on the public data page. Attention questions are injected into paid studies as a hidden check.</p>

    <form mw-card pad="lg" class="mt-4 block space-y-4" (ngSubmit)="ask()">
      <!-- Labels, not placeholders. This form authors a question shown to every
           developer on the panel, and a placeholder stops being a name the moment
           the operator types (design system 8, R347). -->
      <!-- The kind column is sized to its content, not to a guess. At 14rem the
           default option read "profile (unpaid, 1/day, publisl" -- clipped behind the
           native arrow, losing the one word that says this kind publishes to the open
           internet. R353 gave the select a full-width rule and recorded that the inherited
           rules were inert; that was the rule which was not (R362). -->
      <div class="grid gap-3 sm:grid-cols-[max-content_1fr]">
        <mw-field label="Kind">
          <select mw-input size="sm" name="kind" [attr.name]="'kind'" data-kind [(ngModel)]="kind">
            <option value="profile">profile (unpaid, {{ profilePerDay }}/day, published)</option>
            <option value="attention">attention (hidden check)</option>
          </select>
        </mw-field>
        <mw-field label="Title" [hint]="titleMin + ' to ' + titleMax + ' characters'">
          <input mw-input size="sm" name="title" [attr.name]="'title'" data-title [(ngModel)]="title" [attr.maxlength]="titleMax" />
        </mw-field>
      </div>

      @for (q of questions; track $index; let qi = $index) {
        <div mw-card pad="md">
          <mw-field [label]="'Question ' + (qi + 1)" [hint]="'at most ' + textMax + ' characters'">
            <input mw-input size="sm" [name]="'q' + qi" [attr.name]="'q' + qi" [(ngModel)]="q.text" [attr.maxlength]="textMax" />
          </mw-field>
          @for (o of q.options; track $index; let oi = $index) {
            <!-- The option boxes take an accessible name rather than a shown label:
                 five rows per question, and a label over each would be five headings
                 for one list. Same call as the developers screen made in batch 2. -->
            <div class="mt-2 flex items-center gap-3">
              <input mw-input size="sm" [name]="'q' + qi + 'o' + oi" [attr.name]="'q' + qi + 'o' + oi" [attr.aria-label]="'Option ' + (oi + 1) + ' of question ' + (qi + 1)" [(ngModel)]="q.options[oi]" [attr.maxlength]="optionMax" placeholder="option" />
              @if (kind === 'attention') { <label class="flex shrink-0 items-center gap-1 text-caption"><input type="radio" [name]="'correct' + qi" [attr.name]="'correct' + qi" [attr.data-correct]="qi + '-' + oi" [value]="oi" [(ngModel)]="q.correct" class="accent-signal-600 dark:accent-signal-400" /> correct</label> }
              @if (q.options.length > minOptions) { <button type="button" mw-button variant="quiet" size="sm" [attr.data-remove-option]="qi + '-' + oi" (click)="removeOption(q, oi)">remove</button> }
            </div>
          }
          <!-- The add button sits with the options it adds to, not after the
               context field: with the context field carrying a label of its own it
               read as belonging to that instead. -->
          @if (q.options.length < maxOptions) { <button type="button" mw-button variant="quiet" size="sm" class="mt-2" [attr.data-add-option]="qi" (click)="q.options.push('')">+ option</button> }
          <mw-field class="mt-3" label="Context (optional)" hint="Shown on rich surfaces only.">
            <textarea mw-input size="sm" [name]="'c' + qi" [attr.name]="'c' + qi" [(ngModel)]="q.context" [attr.maxlength]="contextMax" rows="2"></textarea>
          </mw-field>
          @if (questions.length > 1) { <button type="button" mw-button variant="quiet" size="sm" class="mt-3" [attr.data-remove-question]="qi" (click)="questions.splice(qi, 1)">remove question</button> }
        </div>
      }

      <div class="flex flex-wrap items-center gap-3">
        @if (questions.length < maxQuestions) { <button type="button" mw-button variant="quiet" size="sm" (click)="questions.push(blankQuestion())">+ question</button> }
        <button type="submit" data-create mw-button size="sm" class="ml-auto" [disabled]="busy()">Create</button>
      </div>
      @if (issues().length) { <ul data-issues class="list-disc pl-5 text-small text-rejected-fg dark:text-rejected-edge">@for (i of issues(); track i) { <li>{{ i }}</li> }</ul> }
      @if (actionFailed(); as why) { <mw-banner data-failed tone="error">{{ why }}</mw-banner> }
    </form>

    @if (armed()) {
      <mw-confirm heading="Create this {{ kind }} study: it goes live to developers now." action="Create and go live" variant="primary" [busy]="busy()" (go)="create()" (cancel)="disarm()">
        <ul class="mt-1 list-disc space-y-1 pl-5">
          <li>It is created live, not as a draft. Developers start being asked it immediately and this page has no way to take it down.</li>
          @if (kind === 'profile') {
            <li>Every answer count is published at the public data page, with the question and its options, to anyone — no sign-in. Do not ask anything here you would not publish.</li>
            <li>Developers are asked at most {{ profilePerDay }} profile question a day and are paid nothing for it.</li>
          } @else {
            <li>These are injected into paid studies without warning. A developer who gets {{ attentionFails }} attention checks wrong, ever, has every answer in the study being settled reversed — the money is taken back — and is flagged, which stops their payouts.</li>
            <li>So a question with the wrong correct option marked costs real developers real money. Check the marked option before creating it.</li>
          }
        </ul>
      </mw-confirm>
    }

    <h2 class="mt-10 text-h2 text-ink-900 dark:text-ink-50">Existing</h2>
    @if (loadFailed()) { <mw-banner data-load-failed class="mt-2" tone="error">Could not load the existing system studies, so this list may be incomplete. A question you are about to add may already be live.</mw-banner> }
    @for (s of list(); track s.id) {
      <!-- The meta run is spaced rather than joined by middle dots; design system 7
           keeps that mark for the status line. -->
      <div mw-card pad="md" class="mt-2 text-small">
        <p class="flex flex-wrap gap-x-4 gap-y-1">
          <span class="font-medium">{{ s.kind }}</span>
          <span>{{ s.title }}</span>
          <span class="text-ink-600 dark:text-ink-400">{{ s.state }}</span>
          <span class="text-ink-600 dark:text-ink-400">created {{ s.created_at | date: 'medium' }}</span>
        </p>
        <ul class="mt-1 max-w-[68ch] list-disc pl-5 text-ink-600 dark:text-ink-400">@for (q of s.questions; track q.id) { <li>{{ q.text }} [{{ q.options.join(' | ') }}]</li> }</ul>
      </div>
    } @empty {
      <!-- The component, not a hand-rolled paragraph: this was the last empty state in the
           application carrying its own margin, which is the one thing that
           component's own comment tells a caller not to do. No backtick in here: one
           ends the template literal, for the fifth time on this branch. -->
      @if (loading()) { <p data-loading class="py-3 text-small text-ink-600 dark:text-ink-400">Loading…</p> }
      @else if (!loadFailed()) { <mw-empty says="No system studies yet." /> }
    }`,
})
export default class SystemStudiesPage {
  private api = inject(ApiService)
  kind: 'profile' | 'attention' = 'profile'
  title = ''
  questions: Q[] = [emptyQuestion()]
  issues = signal<string[]>([])
  list = signal<StudyView[]>([])
  armed = signal(false)
  busy = signal(false)
  loadFailed = signal(false)
  actionFailed = signal<string | null>(null)
  blankQuestion = emptyQuestion
  titleMax = TITLE_MAX
  titleMin = TITLE_MIN
  textMax = TEXT_MAX
  optionMax = OPTION_MAX
  contextMax = CONTEXT_MAX
  minOptions = MIN_OPTIONS
  maxOptions = MAX_OPTIONS
  maxQuestions = MAX_QUESTIONS
  profilePerDay = RULES.PROFILE_MAX_PER_DAY
  attentionFails = RULES.ATTENTION_FAILS_TO_EXCLUDE

  constructor() { void this.refresh() }

  /**
   * Removing an option has to move the correct answer with it. A bare `splice`
   * leaves `correct` pointing at an index that now holds a *different* option, so
   * an attention question would go live marking the wrong answer correct — and a
   * developer who picks the right one has every answer in that study reversed and
   * is flagged, which stops their payouts. Removing the marked option clears the
   * mark rather than guessing; the schema then refuses the study until one is
   * chosen again, which is the loud version.
   */
  removeOption(q: Q, oi: number): void {
    q.options.splice(oi, 1)
    if (q.correct === null) return
    if (q.correct === oi) q.correct = null
    else if (q.correct > oi) q.correct -= 1
  }

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
      this.list.set(await this.api.adminSystemStudies())
      this.loadFailed.set(false)
    } catch {
      this.loadFailed.set(true)
    } finally {
      this.loading.set(false)
    }
  }

  /**
   * The draft as the contract would see it; the one place the form meets the schema.
   *
   * The list and the index into it are derived from the **same** filtered set, and
   * that is the whole point of the shape below. Sending `options.filter(Boolean)`
   * while `correct_option` still counted positions in the *unfiltered* draft shipped
   * attention checks with the wrong answer marked: options `["", "b", "c"]` with
   * `b` marked went out as `["b", "c"]` with `correct_option: 1`, which is `c`. The
   * contract's refine accepts it (1 is a valid index into two options), nothing
   * moves on screen, so the operator's own check — "the option I marked is still
   * marked" — cannot see it either. What it costs is not the admin's: a developer
   * who answers such a check *correctly* has every answer in the study being settled
   * reversed and is flagged, so money is taken back and a fraud signal raised
   * against someone who did the right thing.
   *
   * A marked option that is itself blank is filtered away and has no new index. It
   * is left off rather than guessed, so the schema refuses the study until one is
   * chosen again — the loud version, and the same choice `removeOption` makes.
   */
  candidate(): unknown {
    return {
      kind: this.kind,
      title: this.title.trim(),
      questions: this.questions.map((q) => {
        const kept = q.options.map((o, at) => ({ text: o.trim(), at })).filter((o) => o.text !== '')
        const correct = kept.findIndex((o) => o.at === q.correct)
        return {
          text: q.text.trim(),
          options: kept.map((o) => o.text),
          ...(q.context.trim() ? { context: q.context.trim() } : {}),
          ...(this.kind === 'attention' && correct !== -1 ? { correct_option: correct } : {}),
        }
      }),
    }
  }

  /**
   * Submit validates but does not send. Everything this creates is live the moment
   * it is created, so the schema errors are answered first and the consequences
   * are read second — a confirmation the operator reaches by fixing their form is
   * one they have actually looked at.
   */
  ask(): void {
    this.actionFailed.set(null)
    const r = SystemStudyInput.safeParse(this.candidate())
    if (!r.success) { this.issues.set(r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`)); this.armed.set(false); return }
    this.issues.set([])
    this.armed.set(true)
  }

  disarm(): void { this.armed.set(false) }

  /** Reached only from the confirmation panel. */
  async create(): Promise<void> {
    const r = SystemStudyInput.safeParse(this.candidate())
    if (!r.success || this.busy()) return
    this.busy.set(true)
    this.actionFailed.set(null)
    try {
      await this.api.adminCreateSystemStudy(r.data)
    } catch {
      this.actionFailed.set('Could not create that study. Check the list below before trying again: it may have been created.')
      return
    } finally {
      this.busy.set(false)
      this.armed.set(false)
    }
    this.title = ''
    this.questions = [emptyQuestion()]
    await this.refresh()
  }
}
