import { describe, it, expect } from 'vitest'
import stringWidth from 'string-width'
import { composeBand } from '../../src/band.js'

const q = (over: Record<string, unknown> = {}) => ({
  assignment_id: '8f0b0f2e-6f6a-4a3a-9c1f-0f1e2d3c4b5a', kind: 'choice' as const, text: 'Which tagline?',
  options: ['Postgres, but faster', 'Your DB, cached'], context: null, sponsor: 'Acme DB', price_cents: 50,
  served_at: '2026-09-10T10:00:00.000Z', expires_at: '2026-09-10T10:10:00.000Z', ...over,
})
const base = { loggedIn: true, question: null, answered: null, todayPaid: 3, pendingCents: 2000, availableCents: 710 }

describe('composeBand', () => {
  // Literals, not rebuilt with the composer's own helpers: a test that assembled the expected header
  // with truncateToWidth would agree with any header the composer produced.
  it('composes a paid question with sponsor and amount in the header', () => {
    expect(composeBand({ ...base, question: q() })).toEqual({
      state: 'question',
      assignment_id: '8f0b0f2e-6f6a-4a3a-9c1f-0f1e2d3c4b5a',
      header: 'tickover · Acme DB · $0.50',
      text: 'Which tagline?',
      options: ['Postgres, but faster', 'Your DB, cached'],
      min_columns: 28,
    })
  })

  it('labels a profile question unpaid rather than naming a sponsor', () => {
    const v = composeBand({ ...base, question: q({ kind: 'profile', sponsor: 'Tickover', price_cents: 0, text: 'Which model do you use most?', options: ['Opus', 'Sonnet', 'Other'] }) })
    expect(v).toMatchObject({ state: 'question', header: 'tickover · unpaid · panel profile', options: ['Opus', 'Sonnet', 'Other'], min_columns: 35 })
  })

  it('shows the answered line for as long as the loop holds an answer, and nothing when idle or logged out', () => {
    expect(composeBand({ ...base, answered: { earnedCents: 50 } })).toEqual({ state: 'answered', text: 'tickover · ✓ +$0.50 · today 3/10 · balance $27.10' })
    expect(composeBand(base)).toEqual({ state: 'none' })
    expect(composeBand({ ...base, loggedIn: false, question: q() })).toEqual({ state: 'none' })
  })

  // Asserted on the field values themselves, not on JSON.stringify(view): JSON rewrites a control
  // character into its escaped six-character form whatever the field holds, so a JSON-level check
  // passes whether or not the text was sanitised. That version of this test was vacuous, and the
  // Task 4 mutation run caught it.
  it('strips control and escape sequences from sponsor, text and every option', () => {
    const esc = String.fromCharCode(0x1b)
    const bell = String.fromCharCode(0x07)
    const v = composeBand({ ...base, question: q({ sponsor: `Acme${bell} DB`, text: `Which ${esc}[31mtagline${esc}[0m?`, options: [`${esc}[32mPostgres${esc}[0m`, `Cached${bell}`] }) })
    if (v.state !== 'question') throw new Error('expected a question')
    for (const field of [v.header, v.text, ...v.options]) {
      expect(field, `${JSON.stringify(field)} still holds a control character`).not.toMatch(/[\x00-\x1f\x7f]/)
    }
    expect(v.options).toEqual([expect.stringContaining('Postgres'), expect.stringContaining('Cached')])
  })

  // min_columns is what the module compares with bodyColumns before it draws (section 4.7: the
  // header is never cut). Measured with string-width, an implementation independent of the
  // contract's displayWidth, so a character-count regression cannot pass by agreeing with itself.
  it('measures min_columns in display columns, so a CJK sponsor is counted twice', () => {
    const v = composeBand({ ...base, question: q({ sponsor: '数据库公司' }) })
    expect(v).toMatchObject({ header: 'tickover · 数据库公司 · $0.50', min_columns: 31 })
    if (v.state === 'question') expect(v.min_columns).toBe(stringWidth(v.header) + 2)
  })

  // The module draws `● ${header} · ${text}` (packages/plugin/hooks/band.tsx), so the two columns the
  // bullet and its space take are part of what min_columns has to reserve. At displayWidth + 1 the
  // band agreed to draw one column short of its own first row, and a greedy wrap put the amount on
  // row 2 -- which section 4.7 forbids. Pinned where the arithmetic is, on all three golden headers
  // at once: the ASCII one, the longest, and a CJK sponsor, where a naive count is short by five.
  it('reserves the bullet and its space before the header, on every golden header', () => {
    const golden = [
      { question: q(), header: 'tickover · Acme DB · $0.50', minColumns: 28 },
      { question: q({ kind: 'profile', sponsor: 'Tickover', price_cents: 0 }), header: 'tickover · unpaid · panel profile', minColumns: 35 },
      { question: q({ sponsor: '数据库公司' }), header: 'tickover · 数据库公司 · $0.50', minColumns: 31 },
    ]
    for (const { question, header, minColumns } of golden) {
      const v = composeBand({ ...base, question })
      if (v.state !== 'question') throw new Error('expected a question')
      expect(v.header).toBe(header)
      expect(v.min_columns, header).toBe(minColumns)
      expect(v.min_columns, header).toBe(stringWidth(header) + 2)
    }
  })

  it('caps the sponsor at the status line width and the options at OPTION_TEXT_MAX', () => {
    const v = composeBand({ ...base, question: q({ sponsor: 'Acme Distributed Databases Inc', options: ['x'.repeat(60), 'Short'] }) })
    if (v.state !== 'question') throw new Error('expected a question')
    const sponsor = v.header.split(' · ')[1]!
    expect(stringWidth(sponsor)).toBeLessThanOrEqual(16)
    expect(sponsor.startsWith('Acme')).toBe(true)
    expect(v.options[0]!.length).toBeLessThanOrEqual(40)
    expect(v.options[1]).toBe('Short')
    expect(v.min_columns).toBe(stringWidth(v.header) + 2)
  })
})
