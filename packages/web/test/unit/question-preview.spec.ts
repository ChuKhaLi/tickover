import { describe, it, expect } from 'vitest'
import { bandHeader, formatStatusLine, resolveColumns, type ServedQuestion } from '@tickover/contract'
import { bandPreview, previewQuestion, statusLinePreview } from '../../src/app/lib/question-preview'

const draftQ = (text: string, options: string[]) => ({ text, options, context: '' })
const served = (text: string, options: string[], sponsor = 'Acme DB') => previewQuestion(draftQ(text, options), sponsor, 50)!.question
const direct = (q: ServedQuestion, n: number) =>
  formatStatusLine({ loggedIn: true, question: q, answered: null, todayPaid: 0, pendingCents: 0, availableCents: 0, maxColumns: resolveColumns({ detected: n }) })

describe('previewQuestion', () => {
  it('serves the developer share, trimmed text, and only non-blank options in order', () => {
    const p = previewQuestion(draftQ('  Which DB? ', ['A', '  ', 'B']), 'Acme DB', 50)!
    expect(p.placeholder).toBe(false)
    expect(p.question).toMatchObject({ kind: 'choice', text: 'Which DB?', options: ['A', 'B'], sponsor: 'Acme DB', price_cents: 50 })
  })
  it('stands in placeholders for missing text and sponsor, and says so', () => {
    const p = previewQuestion(draftQ('', ['A', 'B']), '', 50)!
    expect(p.placeholder).toBe(true)
    expect(p.question.text).toBe('Your question')
    expect(p.question.sponsor).toBe('Sponsor')
  })
  it('has nothing to show with fewer than two options', () => {
    expect(previewQuestion(draftQ('Which DB?', ['A', '']), 'Acme DB', 50)).toBeNull()
  })
})

describe('statusLinePreview', () => {
  it('is exactly the status line at each width, margin included', () => {
    const q = served('Which database do you reach for first on a new side project this year?', ['Postgres', 'SQLite', 'MySQL'])
    for (const n of [60, 80, 120]) expect(statusLinePreview(q, n).line).toBe(direct(q, n))
  })

  it('says nothing when the question fits whole', () => {
    expect(statusLinePreview(served('Which DB?', ['A', 'B']), 120).note).toBeNull()
  })

  it('names the characters kept when only the text is cut', () => {
    const q = served('Which database do you reach for first on a new side project this year?', ['Postgres', 'SQLite'])
    const { line, note } = statusLinePreview(q, 80)
    expect(note).toMatch(/^At 80 columns the question is cut to its first \d+ characters\.$/)
    const k = Number(note!.match(/first (\d+)/)![1])
    expect(line).toContain(q.text.slice(0, k) + '…')
  })

  it('says the options are shortened when they are', () => {
    const q = served('Which of these would you choose?', ['A rather long first option here', 'An even longer second option here', 'A third long one'])
    expect(statusLinePreview(q, 80).note).toBe('At 80 columns the options are shortened too.')
    // Fits: the same question with short options loses nothing at 80.
    expect(statusLinePreview(served('Which DB?', ['A', 'B', 'C']), 80).note).toBeNull()
  })

  // Worked through composeQuestion's rungs by hand: at 80 (74 after the margin) the five long
  // options leave shares under OPTION_MIN, and 45 - 3 - 21 >= TEXT_MIN keeps rung 4.
  it('says when only the pane hint fits', () => {
    const q = served('Which of these would you choose?', ['A rather long first option', 'An even longer second option', 'A third long one', 'Fourth long option', 'Fifth long option'])
    expect(statusLinePreview(q, 80).note).toBe("At 80 columns only the question start and 'press 1-5 in the pane' fit.")
    // Fits: three long options at 80 stay on the options rung, with no pane hint.
    const three = served('Which of these would you choose?', ['A rather long first option here', 'An even longer second option here', 'A third long one'])
    expect(statusLinePreview(three, 80).line).not.toContain('in the pane')
  })

  // A 16-column sponsor makes the prefix 38 wide, leaving 16 of 54: no rung fits, so the
  // status line shows the waiting line instead.
  it('says when the question does not fit at all', () => {
    const q = served('Which of these would you choose?', ['A', 'B'], 'A sixteen-char sponsor')
    const r = statusLinePreview(q, 60)
    expect(r.line.startsWith('tickover · question waiting')).toBe(true)
    expect(r.note).toBe("At 60 columns the question does not fit; developers see 'question waiting'.")
    // Fits: the ordinary sponsor at the same width shows the question.
    expect(statusLinePreview(served('Which of these would you choose?', ['A', 'B']), 60).line).not.toContain('question waiting')
  })

  it('measures wide characters the way the status line does', () => {
    const q = served('どのデータベースを最初に使いますか？ 新しいプロジェクトで', ['Postgres', 'SQLite'])
    for (const n of [60, 80]) expect(statusLinePreview(q, n).line).toBe(direct(q, n))
    // The count is code points, and the kept text is a prefix of the question: pinned so a
    // column-width or UTF-16 count would show.
    const { line, note } = statusLinePreview(q, 80)
    const k = Number(note!.match(/first (\d+) characters/)![1])
    expect(k).toBeGreaterThan(0)
    expect(line).toContain(Array.from(q.text).slice(0, k).join('') + '…')
  })
})

describe('bandPreview', () => {
  it('draws the header row and the numbered options row with Skip', () => {
    const q = served('Which DB?', ['Postgres', 'SQLite'])
    const r = bandPreview(q, 80)
    expect(r).toEqual({ draws: true, rows: [`● ${bandHeader(q)} · Which DB?`, '  1: Postgres   2: SQLite   0: Skip'] })
  })
  it('hands the question to the status line below the band floor', () => {
    const q = served('Which DB?', ['A', 'B'], 'A sixteen-char sp')
    const r = bandPreview(q, 20)
    expect(r.draws).toBe(false)
    if (!r.draws) {
      expect(r.note).toBe('The band does not draw at 20 columns; developers see the status line instead.')
      expect(r.line).toBe(direct(q, 20))
    }
  })
})
