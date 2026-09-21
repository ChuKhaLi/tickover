import { describe, it, expect } from 'vitest'
import { LANGUAGES, PRICING, QuestionInput, RULES, StudyInput, Targeting } from '@tickover/contract'
import {
  MAX_OPTIONS, MAX_QUESTIONS, MIN_OPTIONS, SPONSOR_MAX, TARGETING_CAPS, TITLE_MAX,
  emptyDraft, quoteFor, quoteForSaved, targetingOf, targetingSurcharge, toStudyInput,
} from '../../src/app/lib/study-form'

describe('study form', () => {
  it('validates and converts a draft', () => {
    const d = emptyDraft()
    d.title = 'Tagline test'; d.sponsor = 'Acme DB'; d.targetCount = 100
    d.questions[0]!.text = 'Which tagline?'; d.questions[0]!.options = ['Postgres, but faster', 'Your DB, cached', '']
    const r = toStudyInput(d)
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.input).toEqual({ title: 'Tagline test', sponsor: 'Acme DB', target_count: 100, questions: [{ text: 'Which tagline?', options: ['Postgres, but faster', 'Your DB, cached'] }], targeting: undefined })
  })

  // The brief asked for `path: message`. That is a fact about the schema, not
  // about the form: `questions.0.text` names nothing on screen, and `String must
  // contain at least 5 character(s)` states the machine's rule. This is the screen
  // where a buyer commits money to text they cannot change after approval.
  //
  // Every number below is a literal *here* and read off the zod issue *there*, so
  // moving a contract bound turns this red instead of moving both sides together.
  it('reports issues that name the field and the limit, in a sentence', () => {
    const d = emptyDraft()
    d.title = 'x'; d.sponsor = 'A'; d.targetCount = 10
    const r = toStudyInput(d)
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.issues).toContain('Title must be at least 3 characters.')
      expect(r.issues).toContain('Sponsor name must be at least 2 characters.')
      expect(r.issues).toContain('Respondents must be at least 50.')
      expect(r.issues).toContain('Question 1 must be at least 5 characters.')
      expect(r.issues).toContain('Question 1 must have at least 2 options.')
      // Said once, not once per empty option row.
      expect(r.issues).toHaveLength(new Set(r.issues).size)
      for (const issue of r.issues) {
        expect(issue, 'a schema path reached the buyer').not.toMatch(/questions\.\d|target_count|\btargeting\./)
        expect(issue, "zod's own wording reached the buyer").not.toMatch(/String must contain|Number must be|Array must contain/)
        expect(issue, 'not a sentence').toMatch(/^[A-Z].*\.$/)
      }
    }
  })

  it('names every question, option and limit the buyer could trip over', () => {
    const over = (n: number) => 'x'.repeat(n + 1)
    const d = emptyDraft()
    d.title = over(80); d.sponsor = over(30); d.targetCount = 900
    d.questions = [
      { text: 'Which tagline?', options: ['A', 'B'], context: '' },
      { text: over(RULES.QUESTION_TEXT_MAX), options: [over(RULES.OPTION_TEXT_MAX), 'B'], context: over(RULES.CONTEXT_MAX) },
    ]
    const r = toStudyInput(d)
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.issues).toContain('Title must be 80 characters or fewer.')
      expect(r.issues).toContain('Sponsor name must be 30 characters or fewer.')
      expect(r.issues).toContain('Respondents must be 500 or fewer.')
      // The second question is named as the second, not as index 1.
      expect(r.issues).toContain('Question 2 must be 120 characters or fewer.')
      expect(r.issues).toContain('Question 2, option 1 must be 40 characters or fewer.')
      expect(r.issues).toContain('Question 2 context must be 200 characters or fewer.')
      // The first question is fine and is not mentioned.
      expect(r.issues.some((i) => i.startsWith('Question 1'))).toBe(false)
    }
  })

  it('quotes with targeting and at-cost, and computes the hold', () => {
    const d = emptyDraft()
    d.targetCount = 100
    d.questions.push({ text: 'Second?', options: ['A', 'B'], context: '' })
    expect(quoteFor(d, true)).toEqual({ priceCents: 100, developerCents: 50, targeted: false, atCost: false, holdCents: 20000 })
    d.targeting.languages = ['typescript']
    expect(quoteFor(d, false)).toEqual({ priceCents: 80, developerCents: 75, targeted: true, atCost: true, holdCents: 16000 })
  })

  // Once a study exists it, not the form, is what will be charged: the size, the
  // targeting and the question count are fixed at creation. Quoting the form after
  // that showed a hold ten times under what the server takes.
  it('quotes a saved study from what the server stored, matching holdFor', () => {
    const saved = {
      targeting: null,
      target_count: 500,
      questions: [
        { id: 'a', position: 0, text: 'Which tagline?', options: ['A', 'B'], context: null },
        { id: 'b', position: 1, text: 'And which name?', options: ['A', 'B'], context: null },
      ],
    }
    // The server's `holdFor` is price x questionCount x targetCount
    // (`packages/server/src/domain/study-view.ts`). At cost that is 55 x 2 x 500.
    expect(quoteForSaved(saved, false)).toEqual({ priceCents: 55, developerCents: 50, targeted: false, atCost: true, holdCents: 55000 })
    expect(quoteForSaved(saved, true)).toEqual({ priceCents: 100, developerCents: 50, targeted: false, atCost: false, holdCents: 100000 })
    // Targeting is read off the stored study too, not off the form.
    expect(quoteForSaved({ ...saved, targeting: { languages: ['typescript'] } }, false).priceCents).toBe(80)

    // And it disagrees with the draft-side quote whenever the two have drifted,
    // which is the whole reason it exists.
    const drifted = emptyDraft()
    drifted.targetCount = 50
    expect(quoteFor(drifted, false).holdCents).not.toBe(quoteForSaved(saved, false).holdCents)
  })

  // Trimming is not cosmetic here: a sponsor name reaches the status line of every
  // respondent, and a title padded past the schema's 80 is rejected by the server
  // with a message the buyer cannot act on. The blank option is the one that would
  // otherwise reach the wire -- the schema's `min(1)` per option rejects the whole
  // study for a row the buyer left empty on purpose.
  it('trims what it sends, drops blank options, and carries a context only when there is one', () => {
    const d = emptyDraft()
    d.title = '  Tagline test  '; d.sponsor = '  Acme DB '; d.targetCount = 50
    d.questions[0] = { text: '  Which tagline?  ', options: ['  Postgres, but faster', '', 'Your DB, cached  '], context: '   ' }
    const bare = toStudyInput(d)
    expect(bare.ok).toBe(true)
    if (bare.ok) expect(bare.input.questions[0]).toEqual({ text: 'Which tagline?', options: ['Postgres, but faster', 'Your DB, cached'] })

    d.questions[0]!.context = '  Pick the clearer one  '
    const withContext = toStudyInput(d)
    expect(withContext.ok).toBe(true)
    if (withContext.ok) expect(withContext.input.questions[0]!.context).toBe('Pick the clearer one')
  })

  // `targetingOf` is what the audience estimate asks about while the rest of the
  // draft is still empty, so it has to stand on its own rather than fall out of a
  // whole-study parse.
  it('normalises targeting on its own, and reports no targeting as undefined', () => {
    const d = emptyDraft()
    expect(targetingOf(d)).toBeUndefined()

    d.targeting.countries = ['us', ' gb ', 'zzz']
    expect(targetingOf(d)).toEqual({ countries: ['US', 'GB'] })

    // A country field holding only junk is not targeting, and must not put an
    // empty `countries` array on the wire beside a language that is.
    d.targeting.countries = ['zzz']
    d.targeting.languages = ['typescript']
    expect(targetingOf(d)).toEqual({ languages: ['typescript'] })
  })

  // The surcharge a first-study buyer actually pays is the difference between two
  // at-cost quotes, not `PRICING.TARGETING_CENTS`: at cost the price is the
  // developer share plus a flat fee, so half the surcharge never reaches the bill.
  // Naming the wrong one on the form is an R49 copy defect on a money path.
  it('prices targeting as the difference the buyer would actually pay', () => {
    expect(targetingSurcharge(false)).toBe(50)
    expect(targetingSurcharge(true)).toBe(25)
    expect(targetingSurcharge(false)).toBe(PRICING.TARGETING_CENTS)
    // ... and at cost it is emphatically not that number.
    expect(targetingSurcharge(true)).not.toBe(PRICING.TARGETING_CENTS)
  })

  // The bounds the form draws its inputs from. Title and sponsor are read off the
  // schema; the counts have no getter to read, so the contract is asked directly
  // at and past each bound. Either way a contract change lands here, not on a
  // buyer's rejected study.
  it('takes every bound from the contract', () => {
    expect(TITLE_MAX).toBe(80)
    expect(SPONSOR_MAX).toBe(30)
    expect(StudyInput.shape.title.maxLength).toBe(TITLE_MAX)
    expect(StudyInput.shape.sponsor.maxLength).toBe(SPONSOR_MAX)

    const question = (n: number) => ({ text: 'Which tagline?', options: Array.from({ length: n }, () => 'a') })
    expect(QuestionInput.safeParse(question(MIN_OPTIONS)).success).toBe(true)
    expect(QuestionInput.safeParse(question(MIN_OPTIONS - 1)).success).toBe(false)
    expect(QuestionInput.safeParse(question(MAX_OPTIONS)).success).toBe(true)
    expect(QuestionInput.safeParse(question(MAX_OPTIONS + 1)).success).toBe(false)

    const study = (n: number) => ({ title: 'Tagline test', sponsor: 'Acme DB', target_count: PRICING.MIN_RESPONDENTS, questions: Array.from({ length: n }, () => question(MIN_OPTIONS)) })
    expect(StudyInput.safeParse(study(MAX_QUESTIONS)).success).toBe(true)
    expect(StudyInput.safeParse(study(MAX_QUESTIONS + 1)).success).toBe(false)

    // The starting draft is built from those bounds rather than from a literal.
    expect(emptyDraft().questions[0]!.options).toHaveLength(MIN_OPTIONS)
  })

  // The page offers 23 language chips for a field the contract takes 10 of, so an
  // unenforced cap is a 400 the audience panel cannot explain. The caps are probed
  // off `Targeting` rather than retyped; the literals are here so that moving one
  // in the contract turns this red instead of moving both sides together.
  it('reads each targeting cap off the contract', () => {
    expect(TARGETING_CAPS).toEqual({ languages: 10, countries: 20, activityTiers: 3, os: 3 })
    // Non-vacuous both ways: the schema accepts the cap and rejects one past it.
    const list = (n: number, v: string) => Array.from({ length: n }, () => v)
    expect(Targeting.safeParse({ languages: list(TARGETING_CAPS.languages, 'typescript') }).success).toBe(true)
    expect(Targeting.safeParse({ languages: list(TARGETING_CAPS.languages + 1, 'typescript') }).success).toBe(false)
    expect(Targeting.safeParse({ countries: list(TARGETING_CAPS.countries, 'US') }).success).toBe(true)
    expect(Targeting.safeParse({ countries: list(TARGETING_CAPS.countries + 1, 'US') }).success).toBe(false)
    // The page shows more chips than the cap, which is why the cap has to be enforced.
    expect(LANGUAGES.length).toBeGreaterThan(TARGETING_CAPS.languages)
  })

  // Over-long text is rejected by the contract, not by a number retyped in the
  // template: the maxlength attributes are a convenience, and a paste past them
  // still has to be caught.
  it('rejects text past the contract limits', () => {
    const over = (n: number) => 'x'.repeat(n + 1)
    const d = emptyDraft()
    d.title = 'Tagline test'; d.sponsor = 'Acme DB'; d.targetCount = 50
    d.questions[0] = { text: over(RULES.QUESTION_TEXT_MAX), options: ['A', 'B'], context: '' }
    const long = toStudyInput(d)
    expect(long.ok).toBe(false)
    if (!long.ok) expect(long.issues).toContain('Question 1 must be 120 characters or fewer.')

    d.questions[0] = { text: 'Which tagline?', options: [over(RULES.OPTION_TEXT_MAX), 'B'], context: over(RULES.CONTEXT_MAX) }
    const both = toStudyInput(d)
    expect(both.ok).toBe(false)
    if (!both.ok) {
      expect(both.issues).toContain('Question 1, option 1 must be 40 characters or fewer.')
      expect(both.issues).toContain('Question 1 context must be 200 characters or fewer.')
    }
  })
})
