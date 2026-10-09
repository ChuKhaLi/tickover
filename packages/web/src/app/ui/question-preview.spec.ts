import { Component, signal } from '@angular/core'
import { TestBed } from '@angular/core/testing'
import { describe, it, expect } from 'vitest'
import { QuestionPreview } from './question-preview'
import { bandPreview, previewQuestion, statusLinePreview, type Previewable, type PreviewSurface, type PreviewWidth } from '../lib/question-preview'

const p = previewQuestion({ text: 'Which database do you reach for first on a new side project this year?', options: ['Postgres', 'SQLite'], context: '' }, 'Acme DB', 50)

@Component({ imports: [QuestionPreview], template: `<tk-question-preview [preview]="p()" [(width)]="w" [(surface)]="s" />` })
class Host { p = signal<Previewable | null>(p); w: PreviewWidth = 80; s: PreviewSurface = 'status' }

async function mount() {
  TestBed.resetTestingModule()
  const f = TestBed.createComponent(Host)
  f.detectChanges(); await f.whenStable(); f.detectChanges()
  const el = f.nativeElement as HTMLElement
  const btn = (label: string) => Array.from(el.querySelectorAll('button')).find((b) => b.textContent!.trim() === label)!
  return { f, el, btn, host: f.componentInstance }
}

describe('QuestionPreview', () => {
  it('shows the status line and its note at the chosen width', async () => {
    const { f, el, btn, host } = await mount()
    expect(el.querySelector('[data-preview-line]')!.textContent).toBe(statusLinePreview(p!.question, 80).line)
    expect(el.querySelector('[data-preview-note]')?.textContent?.trim() ?? null).toBe(statusLinePreview(p!.question, 80).note)
    btn('120').click(); f.detectChanges()
    expect(host.w).toBe(120)
    expect(el.querySelector('[data-preview-line]')!.textContent).toBe(statusLinePreview(p!.question, 120).line)
    expect(btn('120').getAttribute('aria-pressed')).toBe('true')
    expect(btn('80').getAttribute('aria-pressed')).toBe('false')
  })

  // R814: the preview's price is the developer's share, and the quote beside it shows the buyer's price.
  it('captions the amount as what the developer earns per answer', async () => {
    const { el } = await mount()
    expect(el.querySelector('[data-preview-caption]')!.textContent!.trim()).toBe('The amount shown is what the developer earns per answer.')
  })

  it('makes the scrollable preview reachable by keyboard and names it', async () => {
    const { f, el, btn } = await mount()
    const region = () => el.querySelector('[data-preview-line], [data-preview-band]')!.parentElement!
    expect(region().getAttribute('tabindex')).toBe('0')
    expect(region().getAttribute('aria-label')).toBe('Status line preview, 80 columns')
    btn('Band').click(); btn('120').click(); f.detectChanges()
    expect(region().getAttribute('aria-label')).toBe('Band preview, 120 columns')
  })

  // A fixed width made a 50-character line scroll at 120 columns. The cap is what keeps the wrap exact.
  it('caps the preview at the chosen columns without forcing that width', async () => {
    const { f, el, btn } = await mount()
    for (const surface of ['Status line', 'Band']) {
      for (const w of ['60', '120']) {
        btn(surface).click(); btn(w).click(); f.detectChanges()
        const pre = el.querySelector('[data-preview-line], [data-preview-band]') as HTMLElement
        expect(pre.style.maxWidth, surface + ' ' + w).toBe(w + 'ch')
        expect(pre.classList.contains('w-max'), surface + ' ' + w).toBe(true)
        expect(pre.style.width, surface + ' ' + w).toBe('')
      }
    }
  })

  it('says what a narrow width costs', async () => {
    const { f, el, btn } = await mount()
    btn('60').click(); f.detectChanges()
    const r = statusLinePreview(p!.question, 60)
    expect(r.note).not.toBeNull()
    expect(el.querySelector('[data-preview-note]')!.textContent!.trim()).toBe(r.note)
  })

  it('shows the band rows, marked approximate', async () => {
    const { f, el, btn } = await mount()
    btn('Band').click(); f.detectChanges()
    const r = bandPreview(p!.question, 80)
    expect(r.draws).toBe(true)
    if (r.draws) expect(el.querySelector('[data-preview-band]')!.textContent).toBe(r.rows.join('\n'))
    expect(el.textContent).toContain('Approximate: Claude Code draws the band itself.')
    expect(el.textContent).toContain('function hooks')
  })

  it('asks for options when there is nothing to preview', async () => {
    const { f, el, host } = await mount()
    host.p.set(null); f.detectChanges()
    expect(el.textContent).toContain('Add at least two options')
    expect(el.querySelector('[data-preview-line]')).toBeNull()
  })
})
