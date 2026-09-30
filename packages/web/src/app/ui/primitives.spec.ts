import { Component, signal, type Type } from '@angular/core'
import { TestBed } from '@angular/core/testing'
import { describe, it, expect } from 'vitest'
import { Banner } from './banner'
import { Button } from './button'
import { Field } from './field'
import { Input } from './input'
import { Money } from './money'
import { Meta } from './meta'
import { RecordList } from './record'
import { Range } from './input'
import { StateTrack, StudyBadge } from './study-badge'

function mount<T>(type: Type<T>) {
  TestBed.resetTestingModule()
  const fixture = TestBed.createComponent(type)
  fixture.detectChanges()
  return { fixture, el: fixture.nativeElement as HTMLElement }
}

@Component({
  imports: [Button],
  template: `
    <button tk-button type="submit" [disabled]="off()" class="self-start" data-primary>Email me a link</button>
    <button tk-button variant="danger" size="sm" data-danger>Delete my account</button>
    <a tk-button variant="quiet" href="/app" data-quiet>Load more</a>`,
})
class ButtonHost {
  off = signal(false)
}

describe('tk-button', () => {
  /**
   * The whole reason it is a directive: `/app/login` submits a native form and its
   * spec reads `.disabled` off `button[type=submit]`. A component that wrapped the
   * control would put an element between the two, and every such spec in this
   * package would have had to be rewritten around the wrapper — which is how a
   * design system ends up rewriting the tests that were guarding it.
   */
  it('leaves the control the platform element the caller asked for', () => {
    const { el } = mount(ButtonHost)
    const submit = el.querySelector('button[type=submit]') as HTMLButtonElement
    expect(submit).not.toBeNull()
    expect(submit.disabled).toBe(false)
    expect(el.querySelector('a[href="/app"]')).not.toBeNull()
  })

  /**
   * Load-bearing, and the reason this test exists rather than the assumption:
   * the directive sets the whole class list through a host `[class]` binding, and
   * every primitive after this one needs the caller to still be able to place the
   * element. If Angular replaced the template's classes instead of merging them,
   * `self-start` would be gone and layout would have to move to wrapper elements
   * everywhere.
   */
  it('keeps the caller class alongside the classes it applies itself', () => {
    const { el } = mount(ButtonHost)
    const submit = el.querySelector('[data-primary]') as HTMLElement
    expect(submit.className, 'the caller placed this element').toContain('self-start')
    expect(submit.className, 'and the directive styled it').toContain('bg-signal-400')
  })

  it('applies the variant and size asked for, not the defaults', () => {
    const { el } = mount(ButtonHost)
    const danger = (el.querySelector('[data-danger]') as HTMLElement).className
    expect(danger).toContain('bg-rejected-fg')
    expect(danger).toContain('min-h-9')
    expect(danger, 'the primary fill is not also applied').not.toContain('bg-signal-400')
    expect((el.querySelector('[data-quiet]') as HTMLElement).className).toContain('text-signal-600')
  })

  it('marks itself for the coarse-pointer floor', () => {
    // `styles.css` raises every `[data-tk-control]` to 44px under `pointer: coarse`.
    // Set by the directive so no screen has to remember to opt in.
    const { el } = mount(ButtonHost)
    expect(el.querySelectorAll('[data-tk-control]')).toHaveLength(3)
  })
})

@Component({
  imports: [Field, Input],
  template: `
    <tk-field label="Work email" [hint]="hint()" [error]="error()">
      <input tk-input type="email" />
    </tk-field>`,
})
class FieldHost {
  hint = signal('The address your team already uses.')
  error = signal('')
}

describe('tk-field', () => {
  it('gives the control a real label, which a placeholder is not', () => {
    const { el } = mount(FieldHost)
    const input = el.querySelector('input') as HTMLInputElement
    const label = el.querySelector('label') as HTMLLabelElement
    expect(label.textContent).toContain('Work email')
    expect(input.id, 'the field names the control so the label can point at it').toBeTruthy()
    expect(label.getAttribute('for')).toBe(input.id)
  })

  it('announces the hint through the control, not merely beside it', () => {
    const { el } = mount(FieldHost)
    const input = el.querySelector('input') as HTMLInputElement
    const described = input.getAttribute('aria-describedby')
    expect(described).toBeTruthy()
    expect((el.querySelector(`#${described}`) as HTMLElement).textContent).toContain('your team already uses')
    expect(input.getAttribute('aria-invalid'), 'nothing is wrong yet').toBeNull()
  })

  /**
   * The error replaces the hint rather than stacking with it: two descriptions on
   * one control is two things read out before the person can type, and while an
   * error is showing it is the one that matters.
   */
  it('replaces the hint with the error, and says so to assistive technology', () => {
    const { fixture, el } = mount(FieldHost)
    ;(fixture.componentInstance as FieldHost).error.set('That address is not an email.')
    fixture.detectChanges()

    const input = el.querySelector('input') as HTMLInputElement
    expect(input.getAttribute('aria-invalid')).toBe('true')
    const described = input.getAttribute('aria-describedby')!
    expect((el.querySelector(`#${described}`) as HTMLElement).textContent).toContain('not an email')

    // Asserted against the whole field, and by counting the elements that claim the
    // id, because the obvious version of this check is vacuous: rendering the hint
    // *as well* leaves two elements carrying `id`, `querySelector` returns the error
    // because it comes first in the template, and the assertion passes with the hint
    // still on screen. Mutation found that — the stacked version went green.
    // Two elements sharing one id is also its own defect: `aria-describedby`
    // resolves to exactly one of them and nothing says which.
    expect(el.querySelectorAll(`#${described}`), 'one element owns the description').toHaveLength(1)
    expect(el.textContent, 'the hint is gone, not stacked under the error').not.toContain('your team already uses')
  })

  it('drops the description entirely when there is neither', () => {
    const { fixture, el } = mount(FieldHost)
    ;(fixture.componentInstance as FieldHost).hint.set('')
    fixture.detectChanges()
    expect((el.querySelector('input') as HTMLInputElement).getAttribute('aria-describedby')).toBeNull()
  })
})

@Component({
  imports: [Field, Input],
  template: `
    <tk-field label="Kind">
      <select tk-input><option value="profile">profile</option></select>
    </tk-field>`,
})
class SelectHost {}

/**
 * A select is a control with the same problem an input has: its own surface is white
 * on a near-white page, so the edge is the whole of what says a control is here. The
 * directive covers it rather than each screen restating the class string -- and
 * `tk-field` finds it through the same content query, which is the half that would
 * break silently, because a field whose label points at nothing still renders.
 */
describe('tk-input on a select', () => {
  it('is styled and labelled exactly as the text controls are', () => {
    const { el } = mount(SelectHost)
    const select = el.querySelector('select') as HTMLSelectElement
    expect(select.className, 'the select carries no control edge').toMatch(/\bborder-ink-\d+\b/)
    expect(select.getAttribute('data-tk-control'), 'the coarse-pointer target floor skips it').toBe('')
    const label = el.querySelector('label') as HTMLLabelElement
    expect(select.id, 'tk-field did not find the select, so its label points at nothing').toBeTruthy()
    expect(label.getAttribute('for')).toBe(select.id)
  })
})

@Component({
  imports: [Banner],
  template: `
    <tk-banner tone="done" data-done>Check your email.</tk-banner>
    <tk-banner tone="error" data-error>Couldn't send the link.</tk-banner>`,
})
class BannerHost {}

describe('tk-banner', () => {
  /**
   * `alert` interrupts and `status` waits. An error the person has just caused is
   * worth interrupting for; a confirmation read out over whatever they were
   * listening to is the announcement being louder than the news.
   */
  it('interrupts for an error and waits for a confirmation', () => {
    const { el } = mount(BannerHost)
    expect((el.querySelector('[data-error]') as HTMLElement).getAttribute('role')).toBe('alert')
    expect((el.querySelector('[data-done]') as HTMLElement).getAttribute('role')).toBe('status')
  })

  it('carries no green, which is what the done tone replaced', () => {
    // Design system 3.4 took green out of the palette: money is set in ink, and the
    // ledger's entry types are types rather than sentiment. `done` is the accent.
    const done = (mount(BannerHost).el.querySelector('[data-done]') as HTMLElement).className
    expect(done).toContain('bg-signal-50')
    expect(done).not.toMatch(/green/)
  })

  it('can take focus, because actions move focus to it', () => {
    const { el } = mount(BannerHost)
    expect((el.querySelector('[data-done]') as HTMLElement).getAttribute('tabindex')).toBe('-1')
  })
})

@Component({
  imports: [Money],
  template: `
    <tk-money [cents]="2750" data-speech />
    <tk-money voice="data" [cents]="2750" data-data />`,
})
class MoneyHost {}

describe('tk-money', () => {
  /**
   * Money in a sentence is the interface speaking; money in a column is the machine
   * reporting (R325). Both render the same figure, and only one of them is set in
   * mono at raised weight — the distinction §4 already draws between speech and data.
   */
  it('sets a figure differently when it is data than when it is speech', () => {
    const { el } = mount(MoneyHost)
    const speech = (el.querySelector('[data-speech]') as HTMLElement).className
    const data = (el.querySelector('[data-data]') as HTMLElement).className

    expect(speech, 'figures align in both voices').toContain('tabular-nums')
    expect(data).toContain('tabular-nums')

    expect(data, 'data is the machine reporting').toContain('font-mono')
    expect(data).toContain('font-semibold')
    expect(speech, 'speech inherits the sentence it sits in').not.toContain('font-mono')
    expect(speech, 'and its weight').not.toContain('font-semibold')
  })

  it('renders the same figure whichever voice it is in', () => {
    const { el } = mount(MoneyHost)
    expect((el.querySelector('[data-speech]') as HTMLElement).textContent).toBe('$27.50')
    expect((el.querySelector('[data-data]') as HTMLElement).textContent).toBe('$27.50')
  })
})

@Component({
  imports: [StudyBadge],
  template: `@for (s of states; track s) { <tk-study-badge [state]="s" [attr.data-state]="s" /> }`,
})
class BadgeHost {
  states: Array<'draft' | 'in_review' | 'live' | 'closed' | 'settled' | 'rejected'> = [
    'draft', 'in_review', 'live', 'closed', 'settled', 'rejected',
  ]
}

function chipOf(el: HTMLElement, state: string): HTMLElement {
  return el.querySelector(`[data-state=${state}] span`) as HTMLElement
}

describe('tk-study-badge', () => {
  it('names every state in words, so colour never carries the meaning alone', () => {
    const { el } = mount(BadgeHost)
    expect(chipOf(el, 'draft').textContent).toBe('draft')
    expect(chipOf(el, 'in_review').textContent, 'the underscore is not shown to a buyer').toBe('in review')
    expect(chipOf(el, 'live').textContent).toBe('live')
    expect(chipOf(el, 'settled').textContent).toBe('settled')
    expect(chipOf(el, 'rejected').textContent).toBe('rejected')
  })

  /**
   * The structural guard, and the one that would have caught the defect R325 fixed:
   * every state had a light fill and **no `dark:` treatment at all**, which made this
   * the only element in the application that ignored the theme. Asserting each hex
   * would pin the palette twice; asserting that a themed fill exists is the claim.
   *
   * `live` is the exception, and it is asserted *as* an exception rather than skipped,
   * because a later reader will otherwise see a missing `dark:` and "fix" it: the
   * accent fill with near-black ink reads in both themes, exactly as the primary
   * button does, so a dark twin would be a second way to draw one thing.
   */
  it.each(['draft', 'in_review', 'closed', 'settled', 'rejected'])('gives %s a dark treatment', (state) => {
    const cls = chipOf(mount(BadgeHost).el, state).className
    expect(cls, `${state} has a fill`).toMatch(/(^|\s)bg-/)
    expect(cls, `${state} has no dark fill, so on the dark ground it renders as a pale block`).toMatch(/dark:bg-/)
  })

  it('leaves live alone in both themes, on purpose', () => {
    const cls = chipOf(mount(BadgeHost).el, 'live').className
    expect(cls, 'the accent fill').toContain('bg-signal-400')
    expect(cls, 'near-black ink on it, which reads in both themes').toContain('text-ink-950')
    expect(cls, 'so a dark twin would be a second way to draw one thing').not.toMatch(/dark:/)
  })

  it('carries no green anywhere, which live used to', () => {
    const { el } = mount(BadgeHost)
    for (const s of ['draft', 'in_review', 'live', 'closed', 'settled', 'rejected']) {
      expect(chipOf(el, s).className, `${s} paints with green`).not.toMatch(/green/)
    }
  })

  it('is a chip, not a pill', () => {
    // §5 gives radius a scale where it grows with how much the element contains, and
    // a chip contains one word. It was `rounded-full`.
    expect(chipOf(mount(BadgeHost).el, 'draft').className).toContain('rounded-chip')
  })
})

@Component({
  imports: [StateTrack],
  template: `<tk-state-track [state]="state()" />`,
})
class TrackHost {
  state = signal<'draft' | 'in_review' | 'live' | 'closed' | 'settled' | 'rejected'>('draft')
}

describe('tk-state-track', () => {
  /**
   * The position, which is the question the chip beside it cannot answer. Asserted
   * as the index the step lands at rather than as "a step is marked", because a
   * track that marks the wrong step still marks one.
   */
  it('marks the step the study is at, and only that one', () => {
    const { fixture, el } = mount(TrackHost)
    for (const [state, at] of [
      ['draft', 0],
      ['in_review', 1],
      ['live', 2],
      ['closed', 3],
      ['settled', 4],
    ] as const) {
      fixture.componentInstance.state.set(state)
      fixture.detectChanges()
      const steps = [...el.querySelectorAll('li')]
      expect(steps, `${state} draws the whole sequence`).toHaveLength(5)
      expect(
        steps.findIndex((s) => s.getAttribute('aria-current') === 'step'),
        `${state} is step ${at + 1}`,
      ).toBe(at)
      expect(steps.filter((s) => s.getAttribute('aria-current') === 'step')).toHaveLength(1)
    }
  })

  /**
   * A rejected study left the sequence rather than stopping inside it, so there is
   * no honest place to mark. Drawing the track with nothing current, or wedging
   * rejected in as a sixth step, would both be inventing a position to keep the
   * picture tidy -- and design system 1 allows this indicator precisely because the
   * thing it draws really is a sequence.
   */
  it('draws nothing for a state that is not on the track', () => {
    const { fixture, el } = mount(TrackHost)
    fixture.componentInstance.state.set('rejected')
    fixture.detectChanges()
    expect(el.querySelectorAll('li'), 'rejected is not a step').toHaveLength(0)
    expect(el.querySelector('ol')).toBeNull()
  })

  it('says where it is in prose, since the bars are not read out', () => {
    const { fixture, el } = mount(TrackHost)
    fixture.componentInstance.state.set('live')
    fixture.detectChanges()
    expect(el.querySelector('ol')!.getAttribute('aria-label')).toBe('Study lifecycle: Live, step 3 of 5')
  })

  /**
   * State is carried by the words and their weight before it is carried by colour:
   * the step reached is the only one at raised weight, so the distinction survives
   * a reader who cannot separate the two bar colours.
   */
  it('does not leave the distinction to colour alone', () => {
    const { fixture, el } = mount(TrackHost)
    fixture.componentInstance.state.set('live')
    fixture.detectChanges()
    const bold = [...el.querySelectorAll('span')].filter((s) => s.className.includes('font-semibold'))
    expect(bold.map((s) => s.textContent)).toEqual(['Live'])
  })
})

@Component({
  imports: [Meta, Range, RecordList],
  template: `
    <p tk-meta data-meta><span>Sponsor Acme</span><span>100 respondents</span></p>
    <input type="range" tk-range data-range class="w-56" />
    <dl tk-record data-record><dt data-term>pending</dt><dd>held until that study closes.</dd></dl>`,
})
class TreatmentHost {}

describe('the treatments two screens each had written out by hand', () => {
  /**
   * Both of these retire a copy rather than add an idea, so what is asserted is the
   * part that was drifting: the meta line's spacing and type role, which six lines
   * gave three answers to, and the range's focus edge, which is the half of a
   * hand-copied control that is easy to leave off and impossible to notice missing.
   */
  it('puts the gap and the role on the meta line, in one place', () => {
    const { el } = mount(TreatmentHost)
    const cls = (el.querySelector('[data-meta]') as HTMLElement).className
    expect(cls, 'one gap, not three').toContain('gap-x-6')
    expect(cls, 'a note, not a column head').toContain('text-small')
    expect(cls).toContain('flex-wrap')
  })

  it('colours the terms of a record once, not on every term', () => {
    const { el } = mount(TreatmentHost)
    const cls = (el.querySelector('[data-record]') as HTMLElement).className
    // A descendant rule, so ten terms in a row carry no classes of their own -- which
    // is what the settings page had, ten times, before this existed.
    expect(cls).toContain('[&_dt]:text-ink-600')
    expect(cls, 'the dark half, which a hand-written copy is where it goes missing').toContain('dark:[&_dt]:text-ink-400')
    expect((el.querySelector('[data-term]') as HTMLElement).className, 'the term carries nothing itself').toBe('')
  })

  it('puts the focus edge on the range, in both themes', () => {
    const { el } = mount(TreatmentHost)
    const cls = (el.querySelector('[data-range]') as HTMLElement).className
    expect(cls).toContain('focus-visible:outline-signal-600')
    expect(cls, 'the dark half is the one a copy loses').toContain('dark:focus-visible:outline-signal-400')
    expect(cls, 'width stays the caller decision').toContain('w-56')
  })
})
