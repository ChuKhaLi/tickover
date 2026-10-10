import { describe, it, expect } from 'vitest'
import stringWidth from 'string-width'
import { statusBarText, quickPickItems, quickPickTitle, quickPickPlaceholder, escapeCodicons } from '../../src/format.js'

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

// Audit 2026-10-08 (Lower, C5). VS Code renders `$(name)` as an icon in status bar text, QuickPick
// labels and the QuickPick title, so a sponsor of `$(check) +$5.00` drew the same check mark the
// extension uses for a real payment. VS Code's own escape is a backslash before the `$` (its
// `escapeIcons`); its renderer treats `\$(name)` as literal text. `renderedIcons` is that renderer's
// rule (`renderLabelWithIcons`: an optional backslash, then `$(name)` with an optional `~modifier`),
// so these tests count what VS Code would actually draw rather than grepping for a substring (R919).
function renderedIcons(label: string): string[] {
  const out: string[] = []
  for (const m of label.matchAll(/(\\)?\$\(([a-z0-9-]+(?:~[a-z0-9-]*)?)\)/gi)) if (!m[1]) out.push(m[2]!)
  return out
}

describe('codicon spoofing from buyer text (audit C5)', () => {
  const RLO = String.fromCharCode(0x202e)
  const BS = '\\'
  const spoof = { ...q, sponsor: '$(check) +$5.00', text: `Pick $(verified) one${RLO}`, options: ['$(check) yes', 'no $(x)'] }

  it('the renderer rule itself: an unescaped icon counts, an escaped one does not', () => {
    // The positive control: without it a renderedIcons that never matched would pass every test below.
    expect(renderedIcons('$(check) +$5.00')).toEqual(['check'])
    expect(renderedIcons(`${BS}$(check) +$5.00`)).toEqual([])
  })

  it('escapeCodicons neutralises every $( and leaves other dollars alone', () => {
    expect(escapeCodicons('$(check) +$5.00 $(x~spin)')).toBe(`${BS}$(check) +$5.00 ${BS}$(x~spin)`)
    // A buyer's own backslash cannot pair with ours to re-arm the icon.
    expect(renderedIcons(escapeCodicons(`a $(check) b ${BS}$(x) c`))).toEqual([])
  })

  it("the status bar draws only the extension's own icon for a hostile sponsor and text", () => {
    const r = statusBarText({ ...idle, question: spoof }, true, null)
    expect(renderedIcons(r.text)).toEqual(['comment-discussion'])
    expect(r.text).toContain('$(check) +$5.00')
  })

  it("the status bar draws no icon from a profile question's text", () => {
    const r = statusBarText({ ...idle, question: { ...spoof, kind: 'profile' } }, true, null)
    expect(renderedIcons(r.text)).toEqual(['comment-discussion'])
  })

  it('QuickPick labels draw no icon from an option', () => {
    for (const item of quickPickItems(spoof)) expect(renderedIcons(item.label), item.label).toEqual([])
  })

  it('the QuickPick title is sanitised and draws no icon from the sponsor', () => {
    const t = quickPickTitle({ ...spoof, sponsor: `$(check) Acme${RLO}` })
    expect(renderedIcons(t)).toEqual([])
    expect(t).not.toContain(RLO)
    expect(t).toBe(`${BS}$(check) Acme asks · $0.50`)
    expect(quickPickTitle({ ...spoof, kind: 'profile' })).toBe('Tickover panel profile · unpaid')
  })

  it('the QuickPick placeholder is sanitised, and not escaped -- an input placeholder draws no icons', () => {
    // Escaping here would print a stray backslash: the placeholder is a plain HTML attribute.
    expect(quickPickPlaceholder(spoof)).toBe('Pick $(verified) one')
  })
})
