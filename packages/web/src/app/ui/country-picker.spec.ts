import { Component, signal } from '@angular/core'
import { TestBed } from '@angular/core/testing'
import { describe, it, expect, beforeEach } from 'vitest'
import { COUNTRY_CODES } from '@tickover/contract'
import { CountryPicker } from './country-picker'

@Component({
  imports: [CountryPicker],
  template: `<form (submit)="submitted = true; $event.preventDefault()"><tk-country-picker [(value)]="codes" [cap]="cap" [disabled]="off()" /></form>`,
})
class Host { codes: string[] = []; cap = 3; off = signal(false); submitted = false }

async function mount() {
  document.body.replaceChildren()
  TestBed.resetTestingModule()
  const f = TestBed.createComponent(Host)
  document.body.appendChild(f.nativeElement)
  f.detectChanges(); await f.whenStable(); f.detectChanges()
  const el = f.nativeElement as HTMLElement
  const input = el.querySelector('input[role=combobox]') as HTMLInputElement
  const type = async (v: string) => { input.value = v; input.dispatchEvent(new Event('input')); await f.whenStable(); f.detectChanges() }
  const key = async (k: string) => { const e = new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }); input.dispatchEvent(e); await f.whenStable(); f.detectChanges(); return e }
  return { f, el, input, type, key, host: f.componentInstance }
}

describe('CountryPicker', () => {
  beforeEach(() => TestBed.resetTestingModule())

  it('is an ARIA combobox over a listbox', async () => {
    const { el, input, type } = await mount()
    expect(input.getAttribute('aria-expanded')).toBe('false')
    await type('uni')
    expect(input.getAttribute('aria-expanded')).toBe('true')
    const list = el.querySelector(`#${input.getAttribute('aria-controls')}`)!
    expect(list.getAttribute('role')).toBe('listbox')
    expect(input.getAttribute('aria-activedescendant')).toBe(list.querySelector('[role=option]')!.id)
  })

  it('picks with the keyboard and never submits the form', async () => {
    const { el, type, key, host } = await mount()
    await type('uk')
    const enter = await key('Enter')
    expect(host.codes).toEqual(['GB'])
    // jsdom runs no default action for a synthetic keydown, so the claim is asserted on the event
    expect(enter.defaultPrevented, 'Enter would submit the form').toBe(true)
    expect(host.submitted, 'Enter reached the form').toBe(false)
    expect(el.textContent).toContain('United Kingdom')
    await type('ger'); await key('ArrowDown'); await key('ArrowUp'); await key('Enter')
    expect(host.codes).toEqual(['GB', 'DE'])
  })

  it('removes by chip button and by Backspace in an empty field', async () => {
    const { el, type, key, host, f } = await mount()
    await type('gb'); await key('Enter'); await type('us'); await key('Enter')
    ;(el.querySelector('button[aria-label="Remove United Kingdom"]') as HTMLButtonElement).click()
    f.detectChanges()
    expect(host.codes).toEqual(['US'])
    await type(''); await key('Backspace')
    expect(host.codes).toEqual([])
  })

  it('refuses a code past the cap and says so', async () => {
    const { el, type, key, host } = await mount()
    for (const c of ['gb', 'us', 'de']) { await type(c); await key('Enter') }
    await type('fr'); await key('Enter')
    expect(host.codes).toEqual(['GB', 'US', 'DE'])
    expect(el.textContent).toContain('3 of 3 selected; remove one to add another.')
    expect(el.querySelector('[role=option][aria-disabled=true]')).toBeTruthy()
  })

  it('emits only real codes whatever is typed', async () => {
    const { type, key, host } = await mount()
    for (const t of ['qq', 'xx', 'U1', 'nothing matches this']) { await type(t); await key('Enter') }
    expect(host.codes).toEqual([])
    for (const c of host.codes) expect(COUNTRY_CODES).toContain(c)
  })

  it('says when nothing matches', async () => {
    const { el, type } = await mount()
    await type('qqq')
    expect(el.textContent).toContain('No country matches')
  })

  it('is inert when disabled', async () => {
    const { input, host, f } = await mount()
    host.off.set(true); f.detectChanges()
    expect(input.disabled).toBe(true)
  })

  // R811: a stray Enter right after focus adds nothing; Enter on an option the buyer reached is a pick.
  it('does not pick on a stray Enter after focus, but picks the option the arrow keys reached', async () => {
    const { input, key, host } = await mount()
    input.dispatchEvent(new Event('focus'))
    await key('Enter')
    expect(host.codes).toEqual([])
    await key('ArrowDown')
    expect(input.getAttribute('aria-expanded')).toBe('true')
    const active = input.getAttribute('aria-activedescendant')!.replace(/^.*-opt-/, '')
    await key('Enter')
    expect(host.codes).toEqual([active])
    // The pick spent the intent: another Enter with nothing typed and no arrow key adds nothing.
    await key('Enter')
    expect(host.codes).toEqual([active])
    // ArrowUp is intent too.
    await key('ArrowUp')
    await key('Enter')
    expect(host.codes).toHaveLength(2)
    // Intent that was never acted on is spent by refocusing.
    await key('ArrowDown')
    input.dispatchEvent(new Event('focus'))
    await key('Enter')
    expect(host.codes).toHaveLength(2)
  })

  it('keeps only options in the listbox and the notices outside it', async () => {
    const { el, input, type, key } = await mount()
    input.dispatchEvent(new Event('focus'))
    await type('qqq')
    const list = () => el.querySelector('[role=listbox]')!
    expect(list(), 'an empty listbox is announced as one').toBeNull()
    expect(el.querySelector('[role=status]')!.className, 'padding under a closed picker').not.toBe('')
    expect(el.querySelector('[role=status]')!.textContent).toContain('No country matches')
    for (const c of ['gb', 'us', 'de']) { await type(c); await key('Enter') }
    await type('u')
    expect(list().getAttribute('aria-multiselectable')).toBe('true')
    expect(el.querySelector('[role=status]')!.textContent).toContain('3 of 3 selected')
    expect(list().children.length).toBeGreaterThan(0)
    for (const child of Array.from(list().children)) expect(child.getAttribute('role')).toBe('option')
  })

  it('keeps the query when the cap refuses the pick, and resets the active row when cleared', async () => {
    const { input, type, key, host } = await mount()
    for (const c of ['gb', 'us', 'de']) { await type(c); await key('Enter') }
    await type('fr'); await key('Enter')
    expect(host.codes).toEqual(['GB', 'US', 'DE'])
    expect(input.value).toBe('fr')
  })

  it('resets the active row when Enter clears the query', async () => {
    const { input, type, key, host } = await mount()
    await type('uni'); await key('ArrowDown'); await key('ArrowDown')
    await key('Enter')
    expect(host.codes).toHaveLength(1)
    expect(input.value).toBe('')
    expect(input.getAttribute('aria-activedescendant')).toContain('-opt-AF')
  })

  // R809: the count is a hint, so the accessible name does not change on every pick.
  it('takes no room while closed and names its input by a label that never changes', async () => {
    const { el, input, f, type, key } = await mount()
    const status = el.querySelector('[role=status]') as HTMLElement
    expect(status).toBeTruthy()
    expect(status.textContent).toBe('')
    expect(status.className).toBe('')
    expect(el.querySelector('[role=listbox]')).toBeNull()
    const label = el.querySelector(`label[for="${input.id}"]`)!
    expect(label.textContent!.trim()).toBe('Search countries')
    expect(input.hasAttribute('aria-label')).toBe(false)
    const hint = () => el.querySelector('#' + input.getAttribute('aria-describedby'))!
    expect(hint().textContent!.trim()).toBe('Up to 3 countries.')
    await type('gb'); await key('Enter')
    expect(hint().textContent!.trim()).toBe('1 of 3 selected')
    await key('Backspace')
    expect(hint().textContent!.trim(), 'removing the last pick returns to the cap').toBe('Up to 3 countries.')
    await type('gb'); await key('Enter')
    expect(label.textContent!.trim(), 'the name changed with the pick').toBe('Search countries')
    f.detectChanges()
  })
})
