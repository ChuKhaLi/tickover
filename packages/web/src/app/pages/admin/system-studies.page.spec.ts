import { TestBed, type ComponentFixture } from '@angular/core/testing'
import { provideHttpClient } from '@angular/common/http'
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing'
import { provideRouter } from '@angular/router'
import { describe, it, expect } from 'vitest'
import { QuestionInput, RULES, SystemStudyInput } from '@tickover/contract'
import SystemStudiesPage, { routeMeta } from './system-studies.page'
import { adminGuard } from '../../lib/auth'

const URL = '/api/admin/system-studies'

const existing = {
  id: '8f0b0f2e-6f6a-4a3a-9c1f-0f1e2d3c4b5a', kind: 'profile', state: 'live', title: 'Model use', sponsor: 'Tickover',
  price_cents: 0, developer_cents: 0, at_cost: false, target_count: 0, respondents_completed: 0, hold_cents: 0,
  charged_cents: 0, refunded_cents: 0, targeting: null,
  questions: [{ id: '11111111-1111-4111-8111-111111111111', position: 0, text: 'Which model do you use most?', options: ['Opus', 'Sonnet'], context: null }],
  review_note: null, created_at: '2026-09-10T10:00:00.000Z', live_at: '2026-09-10T10:00:00.000Z', closed_at: null,
}

/** One macrotask drains every pending microtask; `whenStable()` alone does not. */
async function settle(fixture: ComponentFixture<unknown>) {
  await fixture.whenStable()
  await new Promise((ok) => setTimeout(ok, 0))
  fixture.detectChanges()
}

const drain = () => new Promise((ok) => setTimeout(ok, 0))
const squish = (s: string | null) => (s ?? '').replace(/\s+/g, ' ').trim()

async function mount(list: unknown[] | { status: number } = []) {
  TestBed.resetTestingModule()
  TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])] })
  const fixture = TestBed.createComponent(SystemStudiesPage)
  fixture.detectChanges()
  const http = TestBed.inject(HttpTestingController)
  const req = http.expectOne(URL)
  if (Array.isArray(list)) req.flush(list)
  else req.flush({ error: 'internal' }, { status: list.status, statusText: 'Server Error' })
  await settle(fixture)
  const el = fixture.nativeElement as HTMLElement
  const page = fixture.componentInstance
  return {
    fixture, http, el, page,
    text: () => squish(el.textContent),
    panel: () => squish((el.querySelector('[data-confirm]') as HTMLElement | null)?.textContent ?? null),
    click: (selector: string) => {
      const b = el.querySelector(selector) as HTMLButtonElement | null
      if (!b) throw new Error(`no ${selector} on the page`)
      if (b.disabled) throw new Error(`${selector} is disabled`)
      b.click()
    },
    issues: () => Array.from(el.querySelectorAll('[data-issues] li'), (li) => squish(li.textContent)),
    /** Types into a rendered input the way a person does, through the DOM. */
    typeInto: async (selector: string, value: string) => {
      const box = el.querySelector(selector) as HTMLInputElement | HTMLTextAreaElement | null
      if (!box) throw new Error(`no ${selector} on the page`)
      // What Chromium does with `maxlength`, which is the whole of the defect this
      // guards: anything past the attribute is dropped, so a maxlength of 0 takes
      // nothing at all and the field can never satisfy its own minimum.
      const cap = Number(box.getAttribute('maxlength') ?? Number.MAX_SAFE_INTEGER)
      box.value = value.slice(0, Number.isFinite(cap) ? cap : value.length)
      box.dispatchEvent(new Event('input'))
      await settle(fixture)
    },
    /** Marks a radio the way a person does. */
    choose: async (selector: string) => {
      const radio = el.querySelector(selector) as HTMLInputElement | null
      if (!radio) throw new Error(`no ${selector} on the page`)
      radio.click()
      await settle(fixture)
    },
    /**
     * Sets the form's model directly. **It does not repaint** — the draft is a plain
     * object, not a signal, so nothing marks the component dirty and the next
     * `detectChanges()` checks no view. Measured: with three options on the model
     * the page still rendered two inputs and no remove buttons.
     *
     * That is trap 1, and it is why this file was blind to a page that could not be
     * typed into. Use this only for what the page *sends*, which is read off the
     * model; anything asserted against the DOM has to arrive through `typeInto`,
     * `choose` or `click`, each of which is a real event and does repaint.
     */
    fill: async (over: { kind?: 'profile' | 'attention'; title?: string; text?: string; options?: string[]; context?: string; correct?: number | null }) => {
      if (over.kind) page.kind = over.kind
      if (over.title !== undefined) page.title = over.title
      const q = page.questions[0]!
      if (over.text !== undefined) q.text = over.text
      if (over.options !== undefined) q.options = over.options
      if (over.context !== undefined) q.context = over.context
      if (over.correct !== undefined) q.correct = over.correct
      await settle(fixture)
    },
  }
}

const GOOD = { title: 'Model use', text: 'Which model do you use most?', options: ['Opus', 'Sonnet'] }

describe('admin SystemStudiesPage', () => {
  it('is behind the admin guard', () => {
    expect(routeMeta.canActivate).toEqual([adminGuard])
  })

  /**
   * The assertion this file did not have, and the reason the page shipped unable to
   * author anything: every other test here fills `page.title` through the model, so
   * the input's own `maxlength` was never exercised. It rendered `0` — the bound
   * probe walked up from n=1 and read the title's *minimum* rejection as the
   * maximum — and Chromium refuses every keystroke and every paste into a field
   * capped at zero, so `min(3)` could not be satisfied and the confirmation never
   * opened. Twelve green tests, one dead page.
   *
   * The general invariant, which does not depend on any particular number: a field
   * cannot be capped below what the schema demands of it. That is what a zero
   * fails, and it would still fail on any future bound read the wrong way round.
   */
  it('caps every input at its own schema bound, never below the minimum it must satisfy', async () => {
    const m = await mount([])
    const cap = (selector: string) => {
      const box = m.el.querySelector(selector)
      const raw = box?.getAttribute('maxlength')
      expect(box, `${selector} is not on the page`).not.toBeNull()
      expect(raw, `${selector} has no maxlength at all`).not.toBeNull()
      return Number(raw)
    }
    // Read off the contract, so a bound that moves moves this with it.
    const titleMin = SystemStudyInput.innerType().shape.title.minLength!
    expect(cap('[data-title]')).toBe(SystemStudyInput.innerType().shape.title.maxLength)
    expect(cap('[data-title]'), 'the title can never reach its own minimum').toBeGreaterThanOrEqual(titleMin)
    expect(cap('input[name="q0"]')).toBe(QuestionInput.shape.text.maxLength)
    expect(cap('input[name="q0"]')).toBeGreaterThanOrEqual(QuestionInput.shape.text.minLength!)
    expect(cap('input[name="q0o0"]')).toBe(QuestionInput.shape.options.element.maxLength)
    expect(cap('input[name="q0o0"]')).toBeGreaterThanOrEqual(QuestionInput.shape.options.element.minLength!)
    expect(cap('textarea[name="c0"]')).toBe(QuestionInput.shape.context.unwrap().maxLength)
  })

  /**
   * The whole authoring path through the rendered inputs, with nothing set on the
   * model. This is the test that would have failed on the shipped page: it types a
   * title the way a person does, and a field capped at zero drops every character.
   */
  it('authors a study from the rendered form alone', async () => {
    const m = await mount([])
    await m.typeInto('[data-title]', 'Model use')
    await m.typeInto('input[name="q0"]', 'Which model do you use most?')
    await m.typeInto('input[name="q0o0"]', 'Opus')
    await m.typeInto('input[name="q0o1"]', 'Sonnet')
    await m.typeInto('textarea[name="c0"]', 'Asked once a day.')

    m.click('[data-create]')
    await settle(m.fixture)
    expect(m.issues(), 'the form the operator filled in was refused').toEqual([])
    expect(m.el.querySelector('[data-confirm]'), 'the confirmation never opened').not.toBeNull()

    m.click('[data-confirm] [data-go]')
    await drain()
    const req = m.http.expectOne(URL)
    expect(req.request.body).toEqual({
      kind: 'profile', title: 'Model use',
      questions: [{ text: 'Which model do you use most?', options: ['Opus', 'Sonnet'], context: 'Asked once a day.' }],
    })
  })

  // The other half of the bound: the question cap is the one number `ZodArray` will
  // not hand over, so the page searches for it. This checks the answer against the
  // schema at and past the bound rather than trusting the search.
  it('finds the real question cap, at the bound and past it', async () => {
    const m = await mount([])
    const q = { text: 'Which model do you use most?', options: ['Opus', 'Sonnet'] }
    const many = (n: number) => ({ kind: 'profile', title: 'A profile question', questions: Array.from({ length: n }, () => q) })
    expect(m.page.maxQuestions).toBeGreaterThan(0)
    expect(SystemStudyInput.safeParse(many(m.page.maxQuestions)).success, 'the cap is below what the schema accepts').toBe(true)
    expect(SystemStudyInput.safeParse(many(m.page.maxQuestions + 1)).success, 'the cap is above what the schema accepts').toBe(false)
  })

  /**
   * Removing an option has to move the marked answer with it. A bare `splice` leaves
   * `correct` on an index that now holds a different option, so the study goes live
   * marking the wrong answer correct — and on an attention check that reverses the
   * answers of every developer who picked the right one, and flags them.
   *
   * Driven entirely through the DOM. The draft is a plain object, so writing it from
   * the test repaints nothing (see `fill`): a version of this that set the options on
   * the model found no remove buttons to click, because the page was still rendering
   * the two it started with.
   */
  async function threeMarkedOptions(correct: number) {
    const m = await mount([])
    const kind = m.el.querySelector('[data-kind]') as HTMLSelectElement
    kind.value = 'attention'
    kind.dispatchEvent(new Event('change'))
    await settle(m.fixture)
    expect(m.page.kind, 'the kind selector did not reach the model').toBe('attention')
    m.click('[data-add-option="0"]')
    await settle(m.fixture)
    await m.typeInto('input[name="q0o0"]', 'a')
    await m.typeInto('input[name="q0o1"]', 'b')
    await m.typeInto('input[name="q0o2"]', 'c')
    // Selected by a data attribute, not by `[value]`: Angular's radio accessor takes
    // `value` as a directive input, so nothing of it reaches the rendered attribute.
    await m.choose(`input[data-correct="0-${correct}"]`)
    expect(m.page.questions[0]!.options).toEqual(['a', 'b', 'c'])
    expect(m.page.questions[0]!.correct, 'the radio did not mark anything').toBe(correct)
    return m
  }

  it('keeps the correct answer on the same option when an earlier one is removed', async () => {
    const m = await threeMarkedOptions(2)
    m.click('[data-remove-option="0-0"]')
    await settle(m.fixture)
    expect(m.page.questions[0]!.options).toEqual(['b', 'c'])
    expect(m.page.questions[0]!.correct, 'the correct answer now points at a different option').toBe(1)
  })

  it('clears the mark rather than guessing when the correct option itself is removed', async () => {
    const m = await threeMarkedOptions(2)
    m.click('[data-remove-option="0-2"]')
    await settle(m.fixture)
    expect(m.page.questions[0]!.correct).toBeNull()
    // And the schema then refuses it, which is the loud version of "choose again".
    await m.typeInto('[data-title]', 'Attention')
    await m.typeInto('input[name="q0"]', 'Pick the third one.')
    m.click('[data-create]')
    await settle(m.fixture)
    m.http.expectNone(URL)
    expect(m.issues().join(' ')).toContain('correct_option')
  })

  it('leaves a mark before the removed option where it was', async () => {
    const m = await threeMarkedOptions(0)
    m.click('[data-remove-option="0-2"]')
    await settle(m.fixture)
    expect(m.page.questions[0]!.correct).toBe(0)
  })

  /**
   * The blank-option case, and it is the worst defect this page can have. Options
   * are filtered before sending; the marked index counted positions in the
   * *unfiltered* draft. So `["", "b", "c"]` with **b** marked went out as
   * `["b", "c"]` with `correct_option: 1` — which is **c**.
   *
   * Nothing catches it but this. The contract's refine accepts it, because 1 is a
   * valid index into two options. Nothing moves on screen, so the operator's own
   * check — the option I marked is still marked — is satisfied too. And the cost
   * lands on developers rather than the admin: an attention check with the wrong
   * answer marked reverses the settled answers of everyone who answered it
   * *correctly*, and flags them.
   *
   * Driven through the DOM with the exact case, because the request body is the
   * only place the desync is visible.
   */
  it('marks the option the operator marked, even with a blank option before it', async () => {
    const m = await mount([])
    const kind = m.el.querySelector('[data-kind]') as HTMLSelectElement
    kind.value = 'attention'
    kind.dispatchEvent(new Event('change'))
    await settle(m.fixture)
    m.click('[data-add-option="0"]')
    await settle(m.fixture)

    await m.typeInto('[data-title]', 'Attention')
    await m.typeInto('input[name="q0"]', 'Pick the letter b.')
    // The first box is left empty on purpose; b and c go in the second and third.
    await m.typeInto('input[name="q0o1"]', 'b')
    await m.typeInto('input[name="q0o2"]', 'c')
    await m.choose('input[data-correct="0-1"]')

    m.click('[data-create]')
    await settle(m.fixture)
    expect(m.issues()).toEqual([])
    m.click('[data-confirm] [data-go]')
    await drain()
    const sent = m.http.expectOne(URL).request.body as { questions: Array<{ options: string[]; correct_option: number }> }
    const q = sent.questions[0]!
    expect(q.options).toEqual(['b', 'c'])
    expect(q.correct_option, 'the index still counts the blank option that was dropped').toBe(0)
    // The assertion that survives a reindex: the marked answer is the text the
    // operator marked, whatever position it ends up in.
    expect(q.options[q.correct_option]).toBe('b')
  })

  it('refuses to guess when the marked option is the blank one', async () => {
    const m = await mount([])
    const kind = m.el.querySelector('[data-kind]') as HTMLSelectElement
    kind.value = 'attention'
    kind.dispatchEvent(new Event('change'))
    await settle(m.fixture)
    m.click('[data-add-option="0"]')
    await settle(m.fixture)

    await m.typeInto('[data-title]', 'Attention')
    await m.typeInto('input[name="q0"]', 'Pick the letter b.')
    await m.typeInto('input[name="q0o1"]', 'b')
    await m.typeInto('input[name="q0o2"]', 'c')
    await m.choose('input[data-correct="0-0"]')

    m.click('[data-create]')
    await settle(m.fixture)
    m.http.expectNone(URL)
    expect(m.issues().join(' ')).toContain('correct_option')
  })

  /**
   * A profile study has no right answer, and the kind selector is a `<select>` the
   * operator can move both ways. Marking an option as attention and then switching
   * back to profile leaves the mark on the draft with the radios no longer
   * rendered — so the only thing keeping it out of the request is the kind check in
   * `candidate()`. Reached the way an operator reaches it: mark, then switch back.
   *
   * A profile question carrying a right answer is inert today (nothing serves one
   * as an attention check), but it is stored data asserting something untrue about
   * a question whose answers are published.
   */
  it('sends no correct option for a profile study, even after one was marked as attention', async () => {
    const m = await mount([])
    const kind = m.el.querySelector('[data-kind]') as HTMLSelectElement
    const setKind = async (value: string) => {
      kind.value = value
      kind.dispatchEvent(new Event('change'))
      await settle(m.fixture)
    }
    await setKind('attention')
    m.click('[data-add-option="0"]')
    await settle(m.fixture)
    await m.typeInto('[data-title]', 'Model use')
    await m.typeInto('input[name="q0"]', 'Which model do you use most?')
    await m.typeInto('input[name="q0o0"]', 'Opus')
    await m.typeInto('input[name="q0o1"]', 'Sonnet')
    await m.typeInto('input[name="q0o2"]', 'Haiku')
    await m.choose('input[data-correct="0-2"]')
    expect(m.page.questions[0]!.correct, 'the mark this test depends on was never made').toBe(2)

    await setKind('profile')
    expect(m.el.querySelector('input[data-correct="0-2"]'), 'the radios are still rendered').toBeNull()

    m.click('[data-create]')
    await settle(m.fixture)
    m.click('[data-confirm] [data-go]')
    await drain()
    const sent = m.http.expectOne(URL).request.body as { kind: string; questions: Array<Record<string, unknown>> }
    expect(sent.kind).toBe('profile')
    expect(sent.questions[0]!['options']).toEqual(['Opus', 'Sonnet', 'Haiku'])
    expect(Object.hasOwn(sent.questions[0]!, 'correct_option'), 'a profile question went out with a right answer').toBe(false)
  })

  it('drops a blank option on a profile study too', async () => {
    const m = await mount([])
    m.click('[data-add-option="0"]')
    await settle(m.fixture)
    await m.typeInto('[data-title]', 'Model use')
    await m.typeInto('input[name="q0"]', 'Which model do you use most?')
    await m.typeInto('input[name="q0o1"]', 'Opus')
    await m.typeInto('input[name="q0o2"]', 'Sonnet')

    m.click('[data-create]')
    await settle(m.fixture)
    m.click('[data-confirm] [data-go]')
    await drain()
    const sent = m.http.expectOne(URL).request.body as { questions: Array<Record<string, unknown>> }
    expect(sent.questions[0]!['options']).toEqual(['Opus', 'Sonnet'])
  })

  it('lists the system studies that already exist, with their questions', async () => {
    const m = await mount([existing])
    expect(m.text()).toContain('Model use')
    expect(m.text()).toContain('Which model do you use most? [Opus | Sonnet]')
    expect(m.text()).toContain('profile')
  })

  it('says how often profile questions are asked, from the contract', async () => {
    const m = await mount([])
    expect(m.text()).toContain(`asked at most ${RULES.PROFILE_MAX_PER_DAY} a day per developer`)
  })

  // Submitting validates and stops. Nothing here can be created as a draft, so the
  // schema's complaints are answered before the consequences are read.
  it('reports what the contract refuses and sends nothing', async () => {
    const m = await mount([])
    await m.fill({ title: 'no', text: 'hi', options: ['only one'] })
    m.click('[data-create]')
    await settle(m.fixture)
    m.http.expectNone(URL)
    expect(m.el.querySelector('[data-confirm]')).toBeNull()
    const issues = m.issues().join(' ')
    expect(issues).toContain('title')
    expect(issues).toContain('questions.0.text')
    expect(issues).toContain('questions.0.options')
  })

  it('refuses an attention question with no correct option marked', async () => {
    const m = await mount([])
    await m.fill({ kind: 'attention', ...GOOD, correct: null })
    m.click('[data-create]')
    await settle(m.fixture)
    m.http.expectNone(URL)
    expect(m.issues().join(' ')).toContain('correct_option')
  })

  /**
   * A profile question and its answer counts are published at the public
   * aggregates endpoint, to anyone, with no sign-in — and that is not visible from
   * anything on this form. It is the consequence most worth stating before the
   * button is pressed.
   */
  it('warns that a profile question is published to the open internet', async () => {
    const m = await mount([])
    await m.fill(GOOD)
    m.click('[data-create]')
    await settle(m.fixture)
    m.http.expectNone(URL)
    expect(m.panel()).toContain('it goes live to developers now')
    expect(m.panel()).toContain('created live, not as a draft')
    expect(m.panel()).toContain('published at the public data page, with the question and its options, to anyone')
    expect(m.panel()).toContain('Do not ask anything here you would not publish')
  })

  /**
   * The attention consequence, in the contract's own number: a developer who fails
   * `ATTENTION_FAILS_TO_EXCLUDE` checks has every answer in the study being
   * settled reversed and is flagged, which stops their payouts. A wrong correct
   * option here takes money off real people.
   */
  it('warns what a wrong correct option costs, using the contract\'s threshold', async () => {
    const m = await mount([])
    await m.fill({ kind: 'attention', ...GOOD, correct: 0 })
    m.click('[data-create]')
    await settle(m.fixture)
    expect(m.panel()).toContain(`gets ${RULES.ATTENTION_FAILS_TO_EXCLUDE} attention checks wrong`)
    expect(m.panel()).toContain('the money is taken back')
    expect(m.panel()).toContain('is flagged, which stops their payouts')
    expect(m.panel()).toContain('costs real developers real money')
  })

  it('creates only on the confirmation, sends the parsed input, and clears the form', async () => {
    const m = await mount([])
    await m.fill({ kind: 'attention', ...GOOD, context: 'Pick the second one.', correct: 1 })
    m.click('[data-create]')
    await settle(m.fixture)
    m.http.expectNone(URL)

    m.click('[data-confirm] [data-go]')
    await drain()
    const req = m.http.expectOne(URL)
    expect(req.request.method).toBe('POST')
    expect(req.request.body).toEqual({
      kind: 'attention', title: 'Model use',
      questions: [{ text: 'Which model do you use most?', options: ['Opus', 'Sonnet'], context: 'Pick the second one.', correct_option: 1 }],
    })
    req.flush({ ...existing, kind: 'attention', title: 'Model use' })
    await drain()
    m.http.expectOne(URL).flush([{ ...existing, kind: 'attention', title: 'Model use' }])
    await settle(m.fixture)
    expect(m.page.title).toBe('')
    expect(m.page.questions).toEqual([{ text: '', options: ['', ''], context: '', correct: null }])
  })

  it('drops a blank option rather than sending it', async () => {
    const m = await mount([])
    await m.fill({ ...GOOD, options: ['Opus', 'Sonnet', '  '] })
    m.click('[data-create]')
    await settle(m.fixture)
    m.click('[data-confirm] [data-go]')
    await drain()
    const req = m.http.expectOne(URL)
    expect((req.request.body as { questions: Array<{ options: string[] }> }).questions[0]!.options).toEqual(['Opus', 'Sonnet'])
  })

  it('cancelling the confirmation sends nothing and keeps the form', async () => {
    const m = await mount([])
    await m.fill(GOOD)
    m.click('[data-create]')
    await settle(m.fixture)
    m.click('[data-confirm] [data-cancel]')
    await settle(m.fixture)
    m.http.expectNone(URL)
    expect(m.el.querySelector('[data-confirm]')).toBeNull()
    expect(m.page.title).toBe('Model use')
  })

  it('does not claim a study was created when the request failed', async () => {
    const m = await mount([])
    await m.fill(GOOD)
    m.click('[data-create]')
    await settle(m.fixture)
    m.click('[data-confirm] [data-go]')
    await drain()
    m.http.expectOne(URL).flush({ error: 'internal' }, { status: 500, statusText: 'Server Error' })
    await settle(m.fixture)
    m.http.expectNone(URL)
    expect(m.text()).toContain('it may have been created')
    expect(m.page.title, 'the form was cleared even though nothing was created').toBe('Model use')
  })

  it('warns that the existing list may be incomplete when it did not load', async () => {
    const m = await mount({ status: 500 })
    expect(m.text()).toContain('A question you are about to add may already be live')
  })
})

/**
 * The option-count bounds were the last two numbers on this page typed in by hand
 * while every other bound was read off the schema. They are probed now, and a probe
 * that answered wrongly would be worse than a literal: `maxlength="0"` on the title
 * shipped once from exactly this idiom, and every test here was green because they
 * all filled the model instead of the input.
 *
 * So the probe is checked against the schema directly, at and past both ends, the
 * same way `study-form.spec.ts` checks the wizard's copy of these numbers.
 */
describe('the option-count bounds this page enforces', () => {
  const study = (options: number) => ({
    kind: 'profile' as const,
    title: 'A profile question',
    questions: [{ text: 'Which model do you use most?', options: Array.from({ length: options }, (_, i) => `Option ${i + 1}`) }],
  })

  it('are the bounds the contract actually applies', async () => {
    const { page } = await mount()
    expect(SystemStudyInput.safeParse(study(page.minOptions)).success, 'the minimum is refused by the schema').toBe(true)
    expect(SystemStudyInput.safeParse(study(page.minOptions - 1)).success, 'one below the minimum is accepted').toBe(false)
    expect(SystemStudyInput.safeParse(study(page.maxOptions)).success, 'the maximum is refused by the schema').toBe(true)
    expect(SystemStudyInput.safeParse(study(page.maxOptions + 1)).success, 'one above the maximum is accepted').toBe(false)
  })

  // A probe that returned 0, or a min above the max, would disable both buttons and
  // leave the operator unable to author anything -- the failure the title bound had.
  it('leave a usable range on the buttons', async () => {
    const { page } = await mount()
    expect(page.minOptions).toBeGreaterThan(0)
    expect(page.maxOptions).toBeGreaterThan(page.minOptions)
  })
})
