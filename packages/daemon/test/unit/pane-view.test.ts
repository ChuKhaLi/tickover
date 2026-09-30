import { describe, it, expect } from 'vitest'
import stringWidth from 'string-width'
import { renderPane, handleKey, type PaneState } from '../../src/pane-view.js'
import { servedQuestion } from '../helpers/fake-server.js'

const base: PaneState = {
  view: { question: null, shown_at: null, balance_pending_cents: 2000, balance_available_cents: 710, today_paid_answers: 3, logged_in: true },
  answered: null, message: null, width: 60, height: 20,
}

describe('renderPane', () => {
  it('renders a question with numbered options and the key hint', () => {
    const out = renderPane({ ...base, view: { ...base.view, question: servedQuestion() } })
    expect(out.split('\n')).toEqual([
      'tickover · today 3/10 · balance $27.10',
      '─'.repeat(60),
      'Acme DB asks · $0.50',
      'Which tagline?',
      '  1  Postgres, faster',
      '  2  Cached DB',
      '─'.repeat(60),
      '1-2 answer · 0 skip · q quit',
    ])
  })
  // Captured 2026-09-29: the footer said 1-5 under a two-option question, and offered keys to
  // answer and skip while there was no question at all.
  it('offers only the keys that do something', () => {
    const three = servedQuestion({ options: ['a', 'b', 'c'] })
    expect(renderPane({ ...base, view: { ...base.view, question: three } }).split('\n').at(-1)).toBe('1-3 answer · 0 skip · q quit')
    expect(renderPane(base).split('\n').at(-1)).toBe('q quit')
  })
  it('renders waiting, logged out, and answered states', () => {
    expect(renderPane(base)).toContain('Waiting for the next question…')
    expect(renderPane({ ...base, view: { ...base.view, logged_in: false } })).toContain('Not logged in. Run: tickover login')
    expect(renderPane({ ...base, answered: { earnedCents: 50 } }).split('\n')[0]).toBe('tickover · ✓ +$0.50 · today 3/10 · balance $27.10')
  })
  it('strips escapes and truncates to width', () => {
    const out = renderPane({ ...base, width: 30, view: { ...base.view, question: servedQuestion({ text: 'A [31mvery[0m long question text that will not fit at all' }) } })
    for (const line of out.split('\n')) expect(line.length).toBeLessThanOrEqual(30)
    expect(out).not.toContain('')
  })
  it('truncates CJK question text by display width, not character count', () => {
    // 15 full-width glyphs: .length is 15 (fits comfortably under 20), but each glyph is 2
    // display columns wide, so the real on-screen width is 30 -- well past width 20. A
    // truncator that only checked .length would let this overflow the pane.
    const wideText = '文'.repeat(15)
    const out = renderPane({ ...base, width: 20, view: { ...base.view, question: servedQuestion({ text: wideText }) } })
    const lines = out.split('\n')
    for (const line of lines) expect(stringWidth(line)).toBeLessThanOrEqual(20)
    const textLine = lines.find((l) => l.startsWith('文'))!
    expect(textLine.length).toBeLessThan(wideText.length)
  })
})

describe('handleKey', () => {
  // Ctrl-C arrives on the stdin 'data' event as the single byte 0x03 -- built via
  // String.fromCharCode rather than an embedded literal so it stays visibly distinct from an
  // empty string in source/diffs (round1 review: the two look identical once a real 0x03 byte is
  // typed directly into a string literal, which is exactly what led the review to misread this
  // check as accepting '' as quit).
  const CTRL_C = String.fromCharCode(3)

  it('CTRL_C is the one-character byte 0x03, not an empty string', () => {
    // Sanity check on the fixture itself, not on handleKey -- pins the exact ambiguity that
    // caused round1's review to misread this file: a real 0x03 byte and an empty string render
    // identically once pasted into source, but they are not the same value.
    expect(CTRL_C.length).toBe(1)
    expect(CTRL_C.charCodeAt(0)).toBe(3)
    expect(CTRL_C).not.toBe('')
  })

  it('maps digits to answers within range, 0 to skip, q and ctrl-c to quit', () => {
    const s = { ...base, view: { ...base.view, question: servedQuestion() } }
    expect(handleKey('1', s)).toEqual({ type: 'answer', optionIndex: 0 })
    expect(handleKey('2', s)).toEqual({ type: 'answer', optionIndex: 1 })
    expect(handleKey('3', s)).toEqual({ type: 'none' })
    expect(handleKey('0', s)).toEqual({ type: 'skip' })
    expect(handleKey('q', s)).toEqual({ type: 'quit' })
    expect(handleKey(CTRL_C, s)).toEqual({ type: 'quit' })
    expect(handleKey('1', base)).toEqual({ type: 'none' })
    expect(handleKey('0', base)).toEqual({ type: 'none' })
  })

  it('does not treat a real empty string as Ctrl-C', () => {
    const s = { ...base, view: { ...base.view, question: servedQuestion() } }
    expect(handleKey('', s)).toEqual({ type: 'none' })
  })
})
