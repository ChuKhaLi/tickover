// The six primitives that give a screen its shape: `tk-card`, `tk-page-header`,
// `tk-stat`, `tk-empty`, `tk-async`, and the data-grid pair `tk-rows` / `tk-figure`.
//
// Separate from `primitives.spec.ts` only because that file is already 22 tests about
// controls and colour; these are about structure. What each of them is *coloured*
// with is asserted in `test/unit/tokens.spec.ts`, which enumerates roles from the
// source, so nothing here re-checks a contrast ratio.
//
// The weight of this file is on `tk-async`. The other five are shapes, and a shape
// that comes out wrong is visible; the ladder is a *rule*, it is invisible when wrong,
// and it is wrong in the direction that tells a developer they have earned nothing.
import { Component, signal, type Type } from '@angular/core'
import { TestBed } from '@angular/core/testing'
import { describe, it, expect } from 'vitest'
import { Async } from './async'
import { Chip } from './chip'
import { Card } from './card'
import { Empty } from './empty'
import { Identity } from './identity'
import { PageHeader } from './page-header'
import { Figure, Rows } from './rows'
import { Stat } from './stat'

function mount<T>(type: Type<T>) {
  TestBed.resetTestingModule()
  const fixture = TestBed.createComponent(type)
  fixture.detectChanges()
  return { fixture, el: fixture.nativeElement as HTMLElement }
}

const flat = (el: Element | null) => (el?.textContent ?? '').replace(/\s+/g, ' ').trim()

@Component({
  imports: [Card],
  template: `
    <article tk-card data-default>a panel</article>
    <li tk-card pad="none" rank="raised" class="list-none" data-bare>a row that pads itself</li>`,
})
class CardHost {}

describe('tk-card', () => {
  /**
   * The directive shape, tested the way `tk-button`'s is: a panel is an `<article>`,
   * a `<section>` or an `<li>` depending on what it holds, and a component that
   * wrapped one would both take that choice away and break the `<li>` case outright,
   * since a `<ul>` may only contain list items.
   */
  it('leaves the panel the element the caller chose', () => {
    const { el } = mount(CardHost)
    expect(el.querySelector('article[data-default]')).not.toBeNull()
    expect((el.querySelector('[data-bare]') as HTMLElement).tagName).toBe('LI')
  })

  it('applies the pad and rank asked for, and the caller keeps its own class', () => {
    const { el } = mount(CardHost)
    const bare = el.querySelector('[data-bare]') as HTMLElement
    expect(bare.className, 'pad="none" must add no padding at all').not.toMatch(/\bp-\d/)
    expect(bare.className).toContain('list-none')
    expect(bare.className, 'rank="raised" is the one background step design system 5 allows').toContain('bg-white')
    expect((el.querySelector('[data-default]') as HTMLElement).className).toContain('p-4')
  })
})

@Component({
  imports: [PageHeader],
  template: `
    <tk-page-header heading="Earnings">
      <span tk-header-aside data-aside>live</span>
      <button tk-header-action data-action>New study</button>
    </tk-page-header>`,
})
class HeaderHost {}

describe('tk-page-header', () => {
  it('puts the heading in an h1 and both slots where they were selected to go', () => {
    const { el } = mount(HeaderHost)
    const h1 = el.querySelector('h1')
    expect(flat(h1)).toBe('Earnings')
    // Selected by attribute rather than by order, so the aside lands beside the
    // heading even though the template wrote it before the action.
    expect(h1!.parentElement!.querySelector('[data-aside]'), 'the aside belongs beside the heading').not.toBeNull()
    expect(h1!.parentElement!.querySelector('[data-action]'), 'the action does not').toBeNull()
    expect(el.querySelector('[data-action]')).not.toBeNull()
  })

  /**
   * The gap under the heading is the header's, and this is what it replaced: thirteen
   * screens each setting their own, five different values between them, and no rule
   * that told them apart. A screen setting one again is the drift coming back, and
   * the one place it can be seen from is here.
   *
   * This test stands where a `lead` test used to. `lead` was an input with no caller
   * and no correct one available -- it rendered at `text-lead`, the role section 4
   * gives to the sentence under a *public* h1, on a component that is the app h1 --
   * and the test proved it drew once rather than twice, which was true of a feature
   * nothing asked for.
   */
  it('carries the gap below the heading itself, so no screen sets its own', () => {
    const { el } = mount(HeaderHost)
    const header = el.querySelector('tk-page-header') as HTMLElement
    expect(header.className, 'the gap is 16px, the middle of the app scale').toContain('mb-4')
    expect(header.className).toContain('block')
  })
})

@Component({
  imports: [Stat],
  template: `
    <tk-stat label="Pending" hint="Held until those studies close." data-full>$12.00</tk-stat>
    <tk-stat label="Today" data-no-hint>3 / 8</tk-stat>`,
})
class StatHost {}

describe('tk-stat', () => {
  it('draws label, projected value and hint, and omits the hint when there is none', () => {
    const { el } = mount(StatHost)
    const full = flat(el.querySelector('[data-full]'))
    expect(full).toContain('Pending')
    expect(full).toContain('$12.00')
    expect(full).toContain('Held until those studies close.')
    const bare = el.querySelector('[data-no-hint]') as HTMLElement
    expect(flat(bare)).toContain('Today')
    expect(flat(bare)).toContain('3 / 8')
    // The hint is the `@if`, so its absence is the thing to assert, not the text.
    // Angular strips whitespace between elements, so a text comparison here would be
    // asserting that rather than anything about this component.
    expect(bare.querySelectorAll('p'), 'no hint given, so no hint element').toHaveLength(0)
  })

  /**
   * The panel comes from `tk-card` rather than from a copy of its class string. If
   * that composition breaks, a tile keeps its text and silently loses its edge —
   * which is invisible to every other test here.
   */
  it('gets its panel from tk-card rather than from a copy of it', () => {
    const { el } = mount(StatHost)
    const panel = el.querySelector('[data-full] [tk-card]') as HTMLElement
    expect(panel, 'tk-stat must compose tk-card').not.toBeNull()
    expect(panel.className).toContain('rounded-card')
  })
})

@Component({
  imports: [Empty],
  template: `<tk-empty says="No answers yet."><button data-fix>Answer one</button></tk-empty>`,
})
class EmptyHost {}

describe('tk-empty', () => {
  it('says its sentence and projects the action that would fill it', () => {
    const { el } = mount(EmptyHost)
    expect(flat(el.querySelector('tk-empty'))).toContain('No answers yet.')
    expect(el.querySelector('[data-fix]')).not.toBeNull()
  })

  // The caller supplies no margin — eight hand-written empty states had six between
  // them. If this stops carrying the space, every caller silently loses it.
  it('carries its own vertical space', () => {
    const { el } = mount(EmptyHost)
    expect((el.querySelector('tk-empty') as HTMLElement).className).toMatch(/\bpy-\d/)
  })
})

@Component({
  imports: [Async],
  template: `
    <tk-async
      [failed]="failed()"
      [loading]="loading()"
      [empty]="empty()"
      failedSays="Couldn't load your history."
      emptySays="No answers yet."
    >
      <a tk-empty-action data-invite href="/app/studies/new">Create your first study</a>
      <p data-rows>two hundred answers</p>
    </tk-async>`,
})
class AsyncHost {
  failed = signal(false)
  loading = signal(false)
  empty = signal(false)
}

describe('tk-async', () => {
  const rungs = (el: HTMLElement) => ({
    failed: el.querySelector('[data-load-failed]') !== null,
    loading: el.querySelector('[data-loading]') !== null,
    empty: el.querySelector('[data-empty]') !== null,
    data: el.querySelector('[data-rows]') !== null,
  })

  function set(host: AsyncHost, failed: boolean, loading: boolean, empty: boolean) {
    host.failed.set(failed)
    host.loading.set(loading)
    host.empty.set(empty)
  }

  /**
   * Every combination, because the ordering is the whole contract and the dangerous
   * cases are the ones with two flags set at once. `failed` with `empty` is not
   * hypothetical: a rejected request leaves the rows signal at `[]`, so **every**
   * caller that fails is also empty, and a ladder that checked `empty` first would
   * tell a developer they have answered nothing rather than that the request failed.
   *
   * Asserted as the full set of four rungs rather than as "the failure is shown", so
   * a ladder that showed two rungs at once fails here too.
   */
  it.each([
    // failed, loading, empty  ->  the one rung that must be showing
    [true, false, true, 'failed'],
    [true, true, true, 'failed'],
    [true, false, false, 'failed'],
    // The eighth combination, which was the one missing. `failed` with `loading` and
    // without `empty` is what a retry looks like: a request in flight over a previous
    // failure. The ladder must still show the failure, because the retry has not
    // answered yet and the old one did.
    [true, true, false, 'failed'],
    [false, true, true, 'loading'],
    [false, true, false, 'loading'],
    [false, false, true, 'empty'],
    [false, false, false, 'data'],
  ] as const)('with failed=%s loading=%s empty=%s it shows only the %s rung', (failed, loading, empty, expected) => {
    const { fixture, el } = mount(AsyncHost)
    set(fixture.componentInstance, failed, loading, empty)
    fixture.detectChanges()
    expect(rungs(el)).toEqual({
      failed: expected === 'failed',
      loading: expected === 'loading',
      empty: expected === 'empty',
      data: expected === 'data',
    })
  })

  it('says what failed in the error tone, and what empty means in the empty one', () => {
    const { fixture, el } = mount(AsyncHost)
    set(fixture.componentInstance, true, false, true)
    fixture.detectChanges()
    const banner = el.querySelector('[data-load-failed]') as HTMLElement
    expect(flat(banner)).toContain("Couldn't load your history.")
    // The tone is what makes it read as a failure rather than as a note, and
    // `tk-banner` carries `role=alert` only for the tones that interrupt.
    expect(banner.getAttribute('role')).toBe('alert')

    set(fixture.componentInstance, false, false, true)
    fixture.detectChanges()
    expect(flat(el.querySelector('[data-empty]'))).toContain('No answers yet.')
  })

  /**
   * The empty rung's invitation, and both halves matter. Dropping `select=` from the
   * slot does not make the link vanish -- it makes it land in the default slot, so it
   * renders with the *data*, on a page that has none. So this asserts where it is as
   * well as where it is not.
   */
  it('offers the empty rung its invitation, and only there', () => {
    const { fixture, el } = mount(AsyncHost)
    set(fixture.componentInstance, false, false, true)
    fixture.detectChanges()
    expect(el.querySelector('[data-empty] [data-invite]'), 'the empty state has nothing to act on').not.toBeNull()

    set(fixture.componentInstance, false, false, false)
    fixture.detectChanges()
    expect(el.querySelector('[data-invite]'), 'the empty-state invitation is shown beside the data it says is missing').toBeNull()
  })
})

@Component({
  imports: [Rows, Figure],
  template: `
    <table tk-rows>
      <thead><tr><th>When</th><th tk-figure>Amount</th></tr></thead>
      <tbody><tr><td>today</td><td tk-figure>$1.00</td></tr></tbody>
    </table>`,
})
class RowsHost {}

describe('tk-rows', () => {
  /**
   * The reason it is a directive and not a component taking column definitions:
   * seven existing specs in this package query `tbody tr`, `thead th` and
   * `td:nth-child(n)`. A component would have had to reproduce that structure
   * exactly anyway, so the only thing it would have added is a wrapper to break
   * them on.
   */
  it('is still a real table the existing specs can query', () => {
    const { el } = mount(RowsHost)
    expect(el.querySelectorAll('tbody tr')).toHaveLength(1)
    expect(el.querySelectorAll('thead th')).toHaveLength(2)
    expect(flat(el.querySelector('tbody tr td'))).toBe('today')
  })

  it('aligns a figure column on both the head and the cell', () => {
    const { el } = mount(RowsHost)
    // Both, deliberately: a right-aligned column under a left-aligned head reads as
    // a mistake, and it is the half of this that is easy to forget.
    for (const cell of el.querySelectorAll('[tk-figure]')) {
      expect(cell.className, `${cell.tagName} carries the figure treatment`).toContain('text-right')
      expect(cell.className).toContain('tabular-nums')
    }
    expect(el.querySelectorAll('[tk-figure]')).toHaveLength(2)
  })

  /**
   * The pin for a defect the test above cannot see. `tk-figure` puts a plain
   * `text-right` on the element; `tk-rows` aligned every head with `[&_th]:text-left`,
   * which is a *descendant* selector and outranks it -- so a figure column's header
   * rendered left-aligned over a right-aligned column, with both classes present and
   * correct. No DOM test here has a stylesheet, so this asserts the shape of the rule
   * instead: the head alignment has to exclude figure cells rather than beat them.
   */
  it('does not out-rank tk-figure when it aligns the head', () => {
    const host = mount(RowsHost).el.querySelector('table') as HTMLElement
    expect(host.className, 'an unscoped head rule silently wins over the element class')
      .not.toMatch(/\[&_th\]:text-(left|right|center)/)
    expect(host.className).toContain('[&_th:not([tk-figure])]:text-left')
  })
})

@Component({
  imports: [Chip],
  template: `
    @for (t of tabs; track t) {
      <button type="button" tk-chip [selected]="on() === t" [disabled]="t === 'banned'" [attr.data-tab]="t">{{ t }}</button>
    }`,
})
class ChipHost {
  tabs = ['active', 'flagged', 'banned'] as const
  on = signal<string>('flagged')
}

describe('tk-chip', () => {
  /**
   * The defect it retires. Four sites drew this control by hand and **one** set
   * `aria-pressed`; on the other three the selected state was carried by colour
   * alone, so a screen reader announced three identical buttons. Both states are
   * asserted, because writing the attribute only when true is the same bug wearing
   * a plausible shape: without `aria-pressed="false"` the control does not announce
   * as a toggle at all.
   */
  it('announces its state in both directions', () => {
    const { el } = mount(ChipHost)
    expect(el.querySelector('[data-tab=flagged]')!.getAttribute('aria-pressed')).toBe('true')
    expect(el.querySelector('[data-tab=active]')!.getAttribute('aria-pressed')).toBe('false')
  })

  it('takes the accent fill when selected and the control edge when not', () => {
    const { el } = mount(ChipHost)
    const on = el.querySelector('[data-tab=flagged]') as HTMLElement
    const off = el.querySelector('[data-tab=active]') as HTMLElement
    expect(on.className).toContain('bg-signal-400')
    // No dark twin on the selected fill, on purpose: the accent with near-black ink
    // reads the same against either ground, as `primary` and the live badge do.
    expect(on.className).not.toContain('dark:bg-')
    expect(off.className, 'R326 put a control edge at 3.0, which is ink-500').toContain('border-ink-500')
    expect(off.className).toContain('dark:border-ink-400')
  })

  /**
   * `disabled` has to be the platform's. `/app/studies/new` disables the unselected
   * chips once the targeting cap is reached, and that cap is what keeps a study's
   * audience from being described so narrowly that no developer matches it.
   */
  it('leaves disabling to the platform', () => {
    const { el } = mount(ChipHost)
    expect((el.querySelector('[data-tab=banned]') as HTMLButtonElement).disabled).toBe(true)
    expect((el.querySelector('[data-tab=active]') as HTMLButtonElement).disabled).toBe(false)
  })
})

@Component({
  imports: [Identity],
  template: `
    <tk-identity
      who="buyer@example.com"
      [busy]="busy()"
      [failed]="failed()"
      failedSays="Couldn't sign you out, so the session is still live. Try again."
      (signOut)="pressed = pressed + 1"
    >
      <span data-extra>credits $4.00</span>
    </tk-identity>`,
})
class IdentityHost {
  busy = signal(false)
  failed = signal(false)
  pressed = 0
}

describe('tk-identity', () => {
  const out = (el: HTMLElement) => el.querySelector('[data-signout]') as HTMLButtonElement

  it('names the principal, keeps whatever else the chrome shows, and emits on the way out', () => {
    const { fixture, el } = mount(IdentityHost)
    expect(flat(el.querySelector('tk-identity'))).toContain('buyer@example.com')
    expect(el.querySelector('[data-extra]'), 'the buyer strip also shows credits').not.toBeNull()
    out(el).click()
    expect(fixture.componentInstance.pressed).toBe(1)
  })

  /**
   * Two of the three copies left the button looking pressable while the request was
   * in flight. It matters more than it looks: the session is an httpOnly cookie, so
   * only the server can end it, and a second press cannot help.
   */
  it('disables the way out while the request is in flight', () => {
    const { fixture, el } = mount(IdentityHost)
    expect(out(el).disabled).toBe(false)
    fixture.componentInstance.busy.set(true)
    fixture.detectChanges()
    expect(out(el).disabled).toBe(true)
    expect(out(el).className, 'and looks it — only admin used to').toContain('disabled:opacity-60')
  })

  /**
   * A failed sign-out leaves the session live, which is the one thing on this strip
   * a person has to be told rather than shown. None of the three copies announced it.
   */
  it('announces a failed sign-out rather than only showing it', () => {
    const { fixture, el } = mount(IdentityHost)
    expect(el.querySelector('[role=alert]')).toBeNull()
    fixture.componentInstance.failed.set(true)
    fixture.detectChanges()
    const alert = el.querySelector('[role=alert]')
    expect(alert, 'a live session has to be said out loud').not.toBeNull()
    expect(flat(alert)).toContain('the session is still live')
  })

  // Design system 7 retires the dotted meta chain: the middle dot is the status
  // line's mark, put there by the spec, and this is page chrome.
  it('joins its parts without borrowing the status line mark', () => {
    const { el } = mount(IdentityHost)
    expect(flat(el.querySelector('tk-identity'))).not.toContain('·')
  })
})
