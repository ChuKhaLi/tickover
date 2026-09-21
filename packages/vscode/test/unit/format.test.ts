import { describe, it, expect } from 'vitest'
import stringWidth from 'string-width'
import { statusBarText, quickPickItems } from '../../src/format.js'

const ICON = '$(comment-discussion) '

const q = { assignment_id: '8f0b0f2e-6f6a-4a3a-9c1f-0f1e2d3c4b5a', kind: 'choice' as const, text: 'Which tagline?', options: ['Postgres, but faster', 'Your DB, cached'], context: null, sponsor: 'Acme DB', price_cents: 50, served_at: '2026-09-10T10:00:00.000Z', expires_at: '2026-09-10T10:10:00.000Z' }
const idle = { question: null, shown_at: null, balance_pending_cents: 2000, balance_available_cents: 710, today_paid_answers: 3, logged_in: true }

describe('statusBarText', () => {
  it('covers disconnected, logged out, idle, question, and answered', () => {
    expect(statusBarText(null, false, null)).toEqual({ text: '$(comment-discussion) tickover: daemon off', tooltip: 'Run: tickover daemon', command: undefined })
    expect(statusBarText({ ...idle, logged_in: false }, true, null).text).toBe('$(comment-discussion) tickover: run tickover login')
    expect(statusBarText(idle, true, null)).toEqual({ text: '$(comment-discussion) tickover 3/10 · $27.10', tooltip: 'today 3/10 · balance $27.10', command: undefined })
    expect(statusBarText({ ...idle, question: q }, true, null)).toEqual({ text: '$(comment-discussion) Acme DB · $0.50 · Which tagline?', tooltip: 'Click to answer', command: 'tickover.answer' })
    expect(statusBarText(idle, true, { earnedCents: 50 }).text).toBe('$(check) +$0.50 · tickover 3/10 · $27.10')
  })
  it('truncates long questions and strips escapes', () => {
    // As handed down in the brief, this fixture's ANSI codes and the `not.toContain('')`
    // assertion were both missing their ESC (0x1B) bytes: the fixture read as plain text
    // "[31m...[0m" (nothing to strip) and the assertion argument was a bare empty string, which
    // *every* string contains, so `not.toContain('')` is impossible to pass for any output.
    // Rebuilt with String.fromCharCode(27) instead of an escape-sequence literal, so the ESC
    // byte this test depends on is unambiguous in source and survives copy/paste.
    const ESC = String.fromCharCode(27)
    const withEscapes = `A ${ESC}[31mvery${ESC}[0m long question that keeps going and going past the limit`
    const r = statusBarText({ ...idle, question: { ...q, text: withEscapes } }, true, null)
    expect(r.text.length).toBeLessThanOrEqual(60 + ICON.length)
    expect(r.text).not.toContain(ESC)
  })
  it('truncates CJK question text by display width, not character count', () => {
    // 30 full-width glyphs: .length is 30 (comfortably under any character-count limit), but
    // each glyph is 2 display columns, so the real on-screen width is 60 -- combined with the
    // "Acme DB · $0.50 · " prefix this well exceeds the 60-column status bar cap. A truncator
    // that only checked .length would let this overflow the status bar.
    const wideText = '文'.repeat(30)
    const r = statusBarText({ ...idle, question: { ...q, text: wideText } }, true, null)
    expect(stringWidth(r.text)).toBeLessThanOrEqual(stringWidth(ICON) + 60)
    expect(r.text.length).toBeLessThan(ICON.length + 'Acme DB · $0.50 · '.length + wideText.length)
  })
  it('labels a profile question as unpaid, never showing sponsor or price', () => {
    const profileQuestion = { ...q, kind: 'profile' as const, text: 'What languages do you use most?' }
    const r = statusBarText({ ...idle, question: profileQuestion }, true, null)
    expect(r.text).toBe('$(comment-discussion) unpaid · What languages do you use most?')
    expect(r.text).not.toContain('Acme DB')
    expect(r.text).not.toContain('0.50')
    expect(r.tooltip).toBe('Click to answer')
    expect(r.command).toBe('tickover.answer')
  })
})

describe('quickPickItems', () => {
  it('numbers options and appends skip', () => {
    expect(quickPickItems(q)).toEqual([
      { label: '1  Postgres, but faster', description: '', index: 0 },
      { label: '2  Your DB, cached', description: '', index: 1 },
      { label: '0  Skip', description: 'costs nothing', index: -1 },
    ])
  })
})
