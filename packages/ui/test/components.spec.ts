import { Component, signal, type Type } from '@angular/core'
import { TestBed } from '@angular/core/testing'
import { describe, expect, it } from 'vitest'
import { Badge } from '../src/badge'
import { Button } from '../src/button'

export function mount<T>(type: Type<T>) {
  TestBed.resetTestingModule()
  const fixture = TestBed.createComponent(type)
  fixture.detectChanges()
  return { fixture, el: fixture.nativeElement as HTMLElement }
}

@Component({
  imports: [Button],
  template: `<button tk-button [busy]="busy()" data-b>Send</button><button tk-button variant="danger" size="sm" data-d>Pause</button>`,
})
class ButtonHost { busy = signal(false) }

// R601: a caller's own [disabled] must combine with busy, not be erased by it.
@Component({
  imports: [Button],
  template: `<button tk-button [busy]="busy()" [disabled]="off()" data-c>Save</button>`,
})
class DisabledHost { busy = signal(false); off = signal(false) }

describe('tk-button', () => {
  it('stays the native button and carries the variant classes', () => {
    const { el } = mount(ButtonHost)
    const b = el.querySelector<HTMLButtonElement>('[data-b]')!
    expect(b.tagName).toBe('BUTTON')
    expect(b.className).toContain('bg-signal-400')
    expect(el.querySelector('[data-d]')!.className).toContain('bg-rejected-fg')
  })
  it('busy disables the control and says so to assistive tech', () => {
    const { fixture, el } = mount(ButtonHost)
    fixture.componentInstance.busy.set(true); fixture.detectChanges()
    const b = el.querySelector<HTMLButtonElement>('[data-b]')!
    expect(b.disabled).toBe(true)
    expect(b.getAttribute('aria-busy')).toBe('true')
  })
  it("combines a caller's [disabled] with busy", () => {
    const { fixture, el } = mount(DisabledHost)
    const b = el.querySelector<HTMLButtonElement>('[data-c]')!
    expect(b.disabled).toBe(false)
    fixture.componentInstance.off.set(true); fixture.detectChanges()
    expect(b.disabled).toBe(true)
    fixture.componentInstance.off.set(false); fixture.componentInstance.busy.set(true); fixture.detectChanges()
    expect(b.disabled).toBe(true)
    expect(b.getAttribute('aria-busy')).toBe('true')
    fixture.componentInstance.busy.set(false); fixture.detectChanges()
    expect(b.disabled).toBe(false)
    expect(b.hasAttribute('aria-busy')).toBe(false)
  })
})

@Component({ imports: [Badge], template: `<tk-badge tone="negative" data-x>bounced</tk-badge>` })
class BadgeHost {}

describe('tk-badge', () => {
  it('renders its text with the tone classes', () => {
    const { el } = mount(BadgeHost)
    const x = el.querySelector('[data-x]')!
    expect(x.textContent!.trim()).toBe('bounced')
    expect(x.className).toContain('bg-rejected-bg')
  })
})

import { Banner } from '../src/banner'
import { Card } from '../src/card'
import { Field } from '../src/field'

@Component({
  imports: [Banner],
  template: `<tk-banner kind="error" data-e>SMTP down</tk-banner>
             <tk-banner dismissible (dismissed)="n = n + 1" data-i>Moved 44 prospects</tk-banner>`,
})
class BannerHost { n = 0 }

describe('tk-banner', () => {
  it('an error is an alert, info is a status', () => {
    const { el } = mount(BannerHost)
    expect(el.querySelector('[data-e]')!.getAttribute('role')).toBe('alert')
    expect(el.querySelector('[data-i]')!.getAttribute('role')).toBe('status')
  })
  it('dismiss emits once per click and only when dismissible', () => {
    const { fixture, el } = mount(BannerHost)
    expect(el.querySelector('[data-e] [data-dismiss]')).toBeNull()
    el.querySelector<HTMLButtonElement>('[data-i] [data-dismiss]')!.click()
    expect(fixture.componentInstance.n).toBe(1)
  })
})

@Component({
  imports: [Card],
  template: `<tk-card heading="Gmail" data-c><button card-actions data-a>Test</button><p data-body>fields</p></tk-card>`,
})
class CardHost {}

describe('tk-card', () => {
  it('puts the heading and actions in the header and the rest in the body', () => {
    const { el } = mount(CardHost)
    expect(el.querySelector('[data-c] header')!.textContent).toContain('Gmail')
    expect(el.querySelector('[data-c] header [data-a]')).not.toBeNull()
    expect(el.querySelector('[data-c] header [data-body]')).toBeNull()
  })
})

@Component({
  imports: [Field],
  template: `<tk-field label="Gmail app password" hint="16 letters" [secretState]="state()" [error]="err()" data-f><input data-in></tk-field>`,
})
class FieldHost { state = signal<'set' | 'unset' | null>('unset'); err = signal('') }

describe('tk-field', () => {
  it('labels the control and describes it with the hint', () => {
    const { el } = mount(FieldHost)
    const input = el.querySelector<HTMLInputElement>('[data-in]')!
    const label = el.querySelector('label')!
    expect(label.getAttribute('for')).toBe(input.id)
    expect(el.querySelector(`#${input.getAttribute('aria-describedby')}`)!.textContent).toContain('16 letters')
  })
  it('shows the secret state as a badge and flips with it', () => {
    const { fixture, el } = mount(FieldHost)
    expect(el.querySelector('[data-f] tk-badge')!.textContent).toContain('not set')
    fixture.componentInstance.state.set('set'); fixture.detectChanges()
    expect(el.querySelector('[data-f] tk-badge')!.textContent).toContain('saved')
  })
  it('an error replaces the hint and marks the control invalid', () => {
    const { fixture, el } = mount(FieldHost)
    fixture.componentInstance.err.set('Required'); fixture.detectChanges()
    const input = el.querySelector<HTMLInputElement>('[data-in]')!
    expect(input.getAttribute('aria-invalid')).toBe('true')
    expect(el.querySelector(`#${input.getAttribute('aria-describedby')}`)!.textContent).toContain('Required')
  })
})

import { NavItem } from '../src/nav-item'
import { Segmented } from '../src/segmented'
import { Table } from '../src/table'

@Component({ imports: [Table], template: `<table tk-table data-t><thead><tr><th>A</th></tr></thead><tbody><tr><td>1</td></tr></tbody></table>` })
class TableHost {}
describe('tk-table', () => {
  it('stays a table and makes its header sticky', () => {
    const { el } = mount(TableHost)
    const t = el.querySelector('[data-t]')!
    expect(t.tagName).toBe('TABLE')
    expect(t.className).toContain('[&_th]:sticky')
  })
})

@Component({ imports: [NavItem], template: `<a tk-nav-item href="#" [count]="c()" data-n>Today</a>` })
class NavHost { c = signal<number | null>(31) }
@Component({ imports: [NavItem], template: `<a tk-nav-item href="#" alert data-a>Queue</a><a tk-nav-item href="#" data-b>Sent</a>` })
class NavAlertHost {}
describe('tk-nav-item', () => {
  it('shows a count, and none when the count is null or zero', () => {
    const { fixture, el } = mount(NavHost)
    expect(el.querySelector('[data-n] [data-count]')!.textContent!.trim()).toBe('31')
    fixture.componentInstance.c.set(0); fixture.detectChanges()
    expect(el.querySelector('[data-n] [data-count]')).toBeNull()
    fixture.componentInstance.c.set(null); fixture.detectChanges()
    expect(el.querySelector('[data-n] [data-count]')).toBeNull()
  })
  it('a bare alert attribute draws the dot, and its absence does not', () => {
    const { el } = mount(NavAlertHost)
    expect(el.querySelector('[data-a] [data-alert]')).not.toBeNull()
    expect(el.querySelector('[data-b] [data-alert]')).toBeNull()
  })
})

@Component({
  imports: [Segmented],
  template: `<tk-segmented label="Theme" [options]="opts" [value]="v()" (valueChange)="v.set($event)" data-s />`,
})
class SegHost {
  opts = [{ value: 'system', label: 'System' }, { value: 'light', label: 'Light' }, { value: 'dark', label: 'Dark' }]
  v = signal('system')
}
describe('tk-segmented', () => {
  it('is a radiogroup with exactly one checked radio', () => {
    const { el } = mount(SegHost)
    expect(el.querySelector('[data-s] [role=radiogroup]')!.getAttribute('aria-label')).toBe('Theme')
    expect([...el.querySelectorAll('[role=radio][aria-checked=true]')].map((b) => b.textContent!.trim())).toEqual(['System'])
  })
  it('click selects', () => {
    const { fixture, el } = mount(SegHost)
    ;[...el.querySelectorAll<HTMLButtonElement>('[role=radio]')][2]!.click(); fixture.detectChanges()
    expect(fixture.componentInstance.v()).toBe('dark')
  })
  it('ArrowRight moves to and selects the next option, wrapping at the end', () => {
    const { fixture, el } = mount(SegHost)
    const group = el.querySelector('[role=radiogroup]')!
    group.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })); fixture.detectChanges()
    expect(fixture.componentInstance.v()).toBe('light')
    fixture.componentInstance.v.set('dark'); fixture.detectChanges()
    group.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })); fixture.detectChanges()
    expect(fixture.componentInstance.v()).toBe('system')
  })
  it('focus follows the selection, including the wrap', async () => {
    const { fixture, el } = mount(SegHost)
    document.body.appendChild(el)
    const group = el.querySelector('[role=radiogroup]')!
    const radios = () => [...el.querySelectorAll<HTMLButtonElement>('[role=radio]')]
    group.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })); fixture.detectChanges()
    await Promise.resolve()
    expect(document.activeElement).toBe(radios()[1])
    fixture.componentInstance.v.set('dark'); fixture.detectChanges()
    group.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })); fixture.detectChanges()
    await Promise.resolve()
    expect(document.activeElement).toBe(radios()[0])
    el.remove()
  })
})
