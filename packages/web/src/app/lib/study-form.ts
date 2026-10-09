import { ACTIVITY_TIER_THRESHOLDS, StudyInput, Targeting, isTargeted, quoteStudy, type StudyView } from '@tickover/contract'
import type { z } from 'zod'

/**
 * The wizard's editing model. It is deliberately *not* `StudyInput`: a form has
 * half-typed options, a country field holding one letter, and a question the buyer
 * is still writing, none of which the contract accepts. `toStudyInput` is the one
 * place the two meet, and it is the only thing that decides whether a draft may be
 * sent.
 */
export interface StudyDraft {
  title: string
  sponsor: string
  targetCount: number
  questions: Array<{ text: string; options: string[]; context: string }>
  targeting: { languages: string[]; countries: string[]; activityTiers: Array<'light' | 'regular' | 'heavy'>; os: Array<'win32' | 'darwin' | 'linux'> }
}

/**
 * Title and sponsor bounds live in `StudyInput` itself rather than in `RULES`, and
 * zod exposes them as public getters -- so they are read off the schema instead of
 * retyped into the template. `ZodArray` has no equivalent getter,
 * so the three counts below are declared here and held to the contract by
 * `test/unit/study-form.spec.ts`, which parses at and past each bound.
 */
export const TITLE_MAX = StudyInput.shape.title.maxLength
export const SPONSOR_MAX = StudyInput.shape.sponsor.maxLength
export const MIN_OPTIONS = 2
export const MAX_OPTIONS = 5
export const MAX_QUESTIONS = 5

/**
 * How many entries each targeting facet accepts, asked of the contract rather than
 * retyped. `ZodString` has a public `maxLength` getter; `ZodArray` has none, and
 * reading `_def.maxLength` reaches into zod's internals -- so the schema is
 * *probed* with lists of growing length and the answer is the last one it accepts.
 * Public API only, exact, and it cannot quietly return a wrong number: with no cap
 * declared it returns the ceiling, which `study-form.spec.ts` would catch.
 *
 * This matters because the page offers 23 language chips for a field that takes
 * 10. An unenforced cap fails at the server as a 400, which the audience panel had
 * no way to explain.
 */
function capOf(facet: 'languages' | 'countries' | 'activity_tiers' | 'os', sample: string): number {
  const CEILING = 64
  for (let n = 1; n <= CEILING; n++) {
    if (!Targeting.safeParse({ [facet]: Array.from({ length: n }, () => sample) }).success) return n - 1
  }
  return CEILING
}

export const TARGETING_CAPS = {
  languages: capOf('languages', 'typescript'),
  countries: capOf('countries', 'US'),
  activityTiers: capOf('activity_tiers', 'light'),
  os: capOf('os', 'win32'),
} as const

export function emptyDraft(): StudyDraft {
  return {
    title: '',
    sponsor: '',
    targetCount: 100,
    questions: [newQuestion()],
    targeting: { languages: [], countries: [], activityTiers: [], os: [] },
  }
}

export function newQuestion(): StudyDraft['questions'][number] {
  return { text: '', options: Array.from({ length: MIN_OPTIONS }, () => ''), context: '' }
}

/**
 * Exported because the audience estimate asks about the targeting *alone*, while
 * the rest of the draft is still empty. Deriving it from a whole-study parse would
 * send `undefined` until the title and question were written, so the panel would
 * report the entire population and silently ignore the chips just clicked.
 *
 * A facet that normalises to nothing is left off the object rather than sent as an
 * empty array: `{ languages: ['typescript'], countries: [] }` targets exactly what
 * `{ languages: ['typescript'] }` does, and only one of them says so.
 */
export function targetingOf(d: StudyDraft): Targeting | undefined {
  const t: Targeting = {}
  const countries = d.targeting.countries.map((c) => c.trim().toUpperCase()).filter((c) => c.length === 2)
  if (d.targeting.languages.length) t.languages = d.targeting.languages
  if (countries.length) t.countries = countries
  if (d.targeting.activityTiers.length) t.activity_tiers = d.targeting.activityTiers
  if (d.targeting.os.length) t.os = d.targeting.os
  return isTargeted(t) ? t : undefined
}

/** What a schema path is called on the form, and what it counts when it is a list. */
interface FieldName { label: string; unit: string }

/**
 * A schema path is a fact about the schema, not about the form. `questions.0.text`
 * names nothing the buyer can see, and `String must contain at most 120
 * character(s)` states the machine's rule rather than theirs -- on the screen where
 * they commit money to text they cannot change after approval.
 */
function fieldFor(path: ReadonlyArray<string | number>): FieldName {
  const [head, index, leaf, item] = path
  if (head === 'title') return { label: 'Title', unit: '' }
  if (head === 'sponsor') return { label: 'Sponsor name', unit: '' }
  if (head === 'target_count') return { label: 'Respondents', unit: '' }
  if (head === 'targeting') {
    const facet = typeof index === 'string' ? index.replace('activity_tiers', 'activity tiers') : ''
    return { label: facet ? `Targeting by ${facet}` : 'Targeting', unit: facet.replace(/s$/, '') }
  }
  if (head === 'questions') {
    if (typeof index !== 'number') return { label: 'This study', unit: 'question' }
    const n = index + 1
    if (leaf === 'text') return { label: `Question ${n}`, unit: '' }
    if (leaf === 'context') return { label: `Question ${n} context`, unit: '' }
    if (leaf === 'options') {
      return typeof item === 'number'
        ? { label: `Question ${n}, option ${item + 1}`, unit: '' }
        : { label: `Question ${n}`, unit: 'option' }
    }
    return { label: `Question ${n}`, unit: '' }
  }
  return { label: 'This study', unit: '' }
}

const plural = (unit: string, n: number) => (n === 1 ? unit : `${unit}s`)

/**
 * The sentence is ours; **the number never is**. Every limit below comes off the
 * zod issue, which carries the bound the contract's own schema declared -- so
 * moving `RULES.QUESTION_TEXT_MAX` moves this message and nothing here needs
 * touching. Same principle as R49 on prices, applied to validation: naming a limit
 * as a literal is how copy comes to disagree with the rule it describes.
 */
function humanIssue(issue: z.ZodIssue): string {
  const f = fieldFor(issue.path)
  if (issue.code === 'too_small') {
    const n = Number(issue.minimum)
    if (issue.type === 'array') return `${f.label} must have at least ${n} ${plural(f.unit || 'entry', n)}.`
    if (issue.type === 'string') return issue.exact ? `${f.label} must be exactly ${n} characters.` : `${f.label} must be at least ${n} characters.`
    return `${f.label} must be at least ${n}.`
  }
  if (issue.code === 'too_big') {
    const n = Number(issue.maximum)
    if (issue.type === 'array') return `${f.label} must have at most ${n} ${plural(f.unit || 'entry', n)}.`
    if (issue.type === 'string') return issue.exact ? `${f.label} must be exactly ${n} characters.` : `${f.label} must be ${n} characters or fewer.`
    return `${f.label} must be ${n} or fewer.`
  }
  // zod 3 reports 75.5 as invalid_type (expected integer, received float) and NaN as
  // invalid_type (expected number, received nan): either way, a count that is not a whole number.
  if (issue.code === 'invalid_type' && (issue.expected === 'integer' || issue.expected === 'number')) return `${f.label} must be a whole number.`
  // Anything the map does not recognise still names the field rather than the
  // path, and still reads as a sentence.
  return `${f.label} is not valid.`
}

/**
 * Trims, drops the option rows the buyer left blank, and validates against the
 * contract. The issues come back as sentences naming the field and the limit --
 * never a schema path and never zod's own wording.
 */
export function toStudyInput(d: StudyDraft): { ok: true; input: StudyInput } | { ok: false; issues: FormIssue[] } {
  // Blank rows are dropped before validation, so a zod option index counts kept
  // rows. This maps it back to the row the buyer sees.
  const keptRows = d.questions.map((q) => q.options.flatMap((o, i) => (o.trim().length > 0 ? [i] : [])))
  const candidate = {
    title: d.title.trim(),
    sponsor: d.sponsor.trim(),
    target_count: Number(d.targetCount),
    questions: d.questions.map((q) => ({
      text: q.text.trim(),
      options: q.options.map((o) => o.trim()).filter((o) => o.length > 0),
      ...(q.context.trim() ? { context: q.context.trim() } : {}),
    })),
    targeting: targetingOf(d),
  }
  const r = StudyInput.safeParse(candidate)
  if (r.success) return { ok: true, input: r.data }
  // De-duplicated per field: `min(1)` on each option and `min(2)` on the list both
  // fire when a question is empty, and the buyer is told the same thing twice.
  const seen = new Set<string>()
  const issues: FormIssue[] = []
  for (const issue of r.error.issues) {
    const i: FormIssue = { path: fieldKey(issue.path), message: humanIssue(issue) }
    const [head, qi, leaf, oi] = issue.path
    if (head === 'questions' && leaf === 'options' && typeof qi === 'number' && typeof oi === 'number') {
      const row = keptRows[qi]?.[oi]
      if (row !== undefined) i.row = row
    }
    const k = `${i.path}|${i.message}`
    if (!seen.has(k)) { seen.add(k); issues.push(i) }
  }
  return { ok: false, issues }
}

/** One validation failure, filed under the form field that shows it. */
export interface FormIssue {
  path: string
  message: string
  /** For an option issue that came from one row: which row on screen. Absent when it came from the list. */
  row?: number
}

/**
 * Which on-screen field owns a schema path. Option rows share one error line
 * under the options list: five rows each carrying "must be at least 1 character"
 * is one mistake said five times.
 */
export function fieldKey(path: ReadonlyArray<string | number>): string {
  const [head, index, leaf] = path
  if (head === 'questions' && typeof index === 'number' && typeof leaf === 'string') return `questions.${index}.${leaf}`
  return String(head ?? '')
}

/** The sidebar's list: each sentence once, in the order the fields raised them. */
export function issueMessages(issues: FormIssue[]): string[] {
  return Array.from(new Set(issues.map((i) => i.message)))
}

/**
 * A preview only. The server re-quotes under the buyer's row lock at submit and
 * that number is the one that is charged -- `firstStudyUsed` in particular can
 * flip between this call and the submit, which is exactly why the entitlement is
 * read under the lock there. `holdCents` mirrors the server's `holdFor`:
 * price x questions x respondents.
 */
export function quoteFor(d: StudyDraft, firstStudyUsed: boolean) {
  const targeted = targetingOf(d) !== undefined
  const atCost = !firstStudyUsed
  const q = quoteStudy({ targeted, atCost })
  return { priceCents: q.priceCents, developerCents: q.developerCents, targeted, atCost, holdCents: q.priceCents * d.questions.length * Number(d.targetCount) }
}

/**
 * The same quote, taken from a study the server has already stored rather than
 * from the draft on screen.
 *
 * These are not interchangeable and the difference is money: `target_count`,
 * `targeting` and the question count are **settled at creation** -- there is no
 * route that edits a draft -- so once a study exists, the form is no longer a
 * description of what will be charged. Quoting the draft after that showed a hold
 * ten times under what the server would take.
 *
 * `at_cost` deliberately still comes from the buyer, not from the stored study:
 * the server re-decides it under the buyer's row lock at submit, so the live
 * entitlement is the better predictor of the charge than the provisional value
 * written at creation.
 */
export function quoteForSaved(
  s: Pick<StudyView, 'targeting' | 'target_count' | 'questions'>,
  firstStudyUsed: boolean,
) {
  const targeted = isTargeted(s.targeting)
  const atCost = !firstStudyUsed
  const q = quoteStudy({ targeted, atCost })
  return { priceCents: q.priceCents, developerCents: q.developerCents, targeted, atCost, holdCents: q.priceCents * s.questions.length * s.target_count }
}

/**
 * What targeting adds to *this* buyer's bill, which is not `PRICING.TARGETING_CENTS`
 * on a first study: at cost the price is the developer share plus a flat fee, so
 * half of the surcharge is never billed (55c to 80c, not 55c to $1.05). Quoting the
 * constant instead would overstate the first study a buyer is most likely to run by
 * 100% -- the R49 class of copy defect, on the form where the money is committed.
 */
export function targetingSurcharge(atCost: boolean): number {
  return quoteStudy({ targeted: true, atCost }).priceCents - quoteStudy({ targeted: false, atCost }).priceCents
}

/** The tier as a buyer reads it, bounds from the contract (R49). */
export function activityTierLabel(t: 'light' | 'regular' | 'heavy'): string {
  const { REGULAR_FROM, HEAVY_FROM } = ACTIVITY_TIER_THRESHOLDS
  if (t === 'light') return `Light (under ${REGULAR_FROM} turns a week)`
  if (t === 'regular') return `Regular (${REGULAR_FROM} to ${HEAVY_FROM - 1} turns a week)`
  return `Heavy (over ${HEAVY_FROM - 1} turns a week)`
}
