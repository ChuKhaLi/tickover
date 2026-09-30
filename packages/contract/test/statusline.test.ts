import { describe, it, expect } from 'vitest'
import stringWidth from 'string-width'
import { formatStatusLine, resolveColumns, truncateToWidth } from "../src/index.js"

const q = (over: Partial<Parameters<typeof formatStatusLine>[0]['question'] & object> = {}) => ({
  assignment_id: '8f0b0f2e-6f6a-4a3a-9c1f-0f1e2d3c4b5a', kind: 'choice' as const, text: 'Which tagline?',
  options: ['Postgres, but faster', 'Your DB, cached'], context: null, sponsor: 'Acme DB', price_cents: 50,
  served_at: '2026-09-10T10:00:00.000Z', expires_at: '2026-09-10T10:10:00.000Z', ...over,
})
const base = { loggedIn: true, question: null, answered: null, todayPaid: 3, pendingCents: 2000, availableCents: 710 }

describe('formatStatusLine', () => {
  // Both question-carrying literals exceed the 80-column cap once assembled (86 and 91 display
  // columns respectively, measured with the real string-width) — the brief's own illustrative
  // examples were never checked against the cap. maxColumns: 120 here takes truncation out of
  // play so this test pins the exact composition (separators, sponsor, price, labeling, option
  // numbering, and the deliberate double space between options) independent of the cap, which the
  // truncation tests below cover on their own.
  it('renders logged out, idle, question, profile, and answered lines', () => {
    expect(formatStatusLine({ ...base, loggedIn: false })).toBe('tickover · run /tickover:setup to start earning')
    expect(formatStatusLine(base)).toBe('tickover · today 3/10 · balance $27.10')
    expect(formatStatusLine({ ...base, question: q(), maxColumns: 120 })).toBe('tickover · Acme DB · $0.50 · Which tagline? 1 Postgres, but faster  2 Your DB, cached · answer: tickover pane')
    expect(formatStatusLine({ ...base, maxColumns: 120, question: q({ kind: 'profile', sponsor: 'Tickover', price_cents: 0, text: 'Which model do you use most?', options: ['Opus', 'Sonnet', 'Other'] }) }))
      .toBe('tickover · unpaid · panel profile · Which model do you use most? 1 Opus  2 Sonnet  3 Other · answer: tickover pane')
    // Without the room for it, the question and its options come first and the hint is dropped.
    expect(formatStatusLine({ ...base, question: q(), maxColumns: 90 })).toBe('tickover · Acme DB · $0.50 · Which tagline? 1 Postgres, but faster  2 Your DB, cached')
    expect(formatStatusLine({ ...base, answered: { earnedCents: 50 } })).toBe('tickover · ✓ +$0.50 · today 3/10 · balance $27.10')
  })

  it('sanitizes sponsor, question text, and options individually before assembly', () => {
    // Proves the component-level sanitizeText calls are enough on their own — no outer pass over
    // the assembled line is needed (an outer pass would collapse the double-space separator, see
    // the truncation test below and R17).
    const esc = String.fromCharCode(0x1b)
    const bell = String.fromCharCode(0x07)
    const line = formatStatusLine({
      ...base,
      maxColumns: 200,
      question: q({
        sponsor: `Acme${bell} DB`,
        text: `Which ${esc}[31mtagline${esc}[0m is it?`,
        options: [`${esc}[32mPostgres${esc}[0m, but faster`, `Your DB, cached${bell}`],
      }),
    })
    expect(line).not.toContain(esc)
    expect(line).not.toContain(bell)
    expect(line).toContain('Postgres, but faster')
  })

  it('truncates an over-long question to the column budget at the default cap', () => {
    const line = formatStatusLine({
      ...base,
      question: q({
        text: 'Which tagline is best for a very long product name that goes on and on and on and on and on?',
        options: ['Option number one is quite long indeed', 'Option number two is also quite long indeed'],
      }),
    })
    expect(stringWidth(line)).toBeLessThanOrEqual(80)
    expect(line.endsWith('…')).toBe(true)
  })

  it('truncates wide (CJK) characters by display width, not character count', () => {
    // Each CJK glyph is 1 character but 2 display columns — a .length-based budget would let this
    // through at well under 80 "characters" while actually overflowing the terminal.
    const line = formatStatusLine({
      ...base,
      question: q({
        text: '这是一个非常长的问题标题用于测试终端宽度截断这是一个非常长的问题标题用于测试终端宽度截断',
        options: ['选项一非常长而且用了很多字符', '选项二也非常长而且用了很多字符'],
      }),
    })
    expect(stringWidth(line)).toBeLessThanOrEqual(80)
    expect(line.endsWith('…')).toBe(true)
  })
})

describe('resolveColumns', () => {
  // Spike 2026-09-06: Claude Code sets COLUMNS on every status line invocation and updates it on
  // resize (189 -> 120 -> 77 -> 46 -> 189 observed across 50 runs), and truncates the rendered line
  // itself at COLUMNS-4 with an ellipsis. Composing to the full width would hand our carefully
  // budgeted tail to *its* right-edge cut, which is the very defect being fixed — hence the margin.
  it('uses the detected terminal width minus the safety margin', () => {
    expect(resolveColumns({ detected: 189, configured: null })).toBe(183)
  })

  it('prefers an explicit config override over the detected width', () => {
    expect(resolveColumns({ detected: 189, configured: 100 })).toBe(94)
  })

  it('falls back to the 80-column default when the width is unknown', () => {
    expect(resolveColumns({ detected: null, configured: null })).toBe(74)
  })

  it('narrows to a genuinely narrow terminal rather than clamping up to 80', () => {
    // The floor is a fallback for an UNKNOWN width, never a minimum on a width we know: composing
    // an 80-column line for the measured 46-column window would wrap, which is the worst outcome.
    expect(resolveColumns({ detected: 46, configured: null })).toBe(40)
  })

  it('rejects out-of-range and unparseable widths instead of trusting them', () => {
    // The value crosses a process boundary from the status line script. Its provenance ("it is only
    // the terminal width") says nothing about its range.
    for (const bad of [0, -5, NaN, Infinity, -Infinity, 1e9]) {
      const got = resolveColumns({ detected: bad, configured: null })
      expect(got, `detected=${bad}`).toBeGreaterThanOrEqual(14)
      expect(got, `detected=${bad}`).toBeLessThanOrEqual(394)
    }
  })
})

// maxColumns: 74 throughout is not arbitrary — it is what resolveColumns yields for the 80-column
// fallback, i.e. the real budget on a terminal whose width we could not detect. Testing the
// allocator at the tightest budget the pipeline actually produces is the point.
describe('formatStatusLine field budgeting', () => {
  it('keeps every option whole and truncates the question text to make room', () => {
    // R22: the options carry more decision value per column than the question text. "1 Postgres
    // 2 SQLite 3 MySQL" is nearly answerable on its own; "Which database do you reach for..." is
    // not answerable at all. Truncation must therefore eat the text, never the options.
    const line = formatStatusLine({
      ...base,
      maxColumns: 74,
      question: q({
        text: 'Which database do you reach for first on a brand new greenfield project?',
        options: ['Postgres', 'SQLite', 'MySQL'],
      }),
    })
    expect(line).toContain('1 Postgres')
    expect(line).toContain('2 SQLite')
    expect(line).toContain('3 MySQL')
    expect(line).toContain('…')
    expect(stringWidth(line)).toBeLessThanOrEqual(74)
  })

  it('caps the sponsor to 16 display columns without dropping it', () => {
    // Section 4.7 requires the sponsor name be displayed with paid questions, not that it be
    // displayed in full — the pane, page and extension carry all 30 characters. Capping it here
    // buys 14 columns, which is the difference between three options fitting and failing.
    const line = formatStatusLine({
      ...base,
      maxColumns: 74,
      question: q({ sponsor: 'Extremely Long Sponsor Name Co', options: ['Yes', 'No'] }),
    })
    expect(stringWidth(line.split(' · ')[1] ?? '')).toBeLessThanOrEqual(16)
    expect(line).toContain('Extremely Long')
    expect(stringWidth(line)).toBeLessThanOrEqual(74)
  })

  it('shows short options in full and gives the freed columns to the long one', () => {
    // An equal split would waste columns on "Yes" and "No" that the third option needs. Every
    // option is either shown whole or gets at least a legible share — never an equal tiny share.
    const line = formatStatusLine({
      ...base,
      maxColumns: 74,
      question: q({
        text: 'Do you use Postgres in production for anything serious?',
        options: ['Yes', 'No', 'It depends on the specific workload'],
      }),
    })
    expect(line).toContain('1 Yes')
    expect(line).toContain('2 No')
    expect(line).toContain('3 It depends')
    expect(stringWidth(line)).toBeLessThanOrEqual(74)
  })

  it('falls back to the option count and where to answer when no option can be legible', () => {
    // Five 40-character options cannot be split legibly inside any real budget. Rather than emit
    // five 2-character stubs, say how many there are and where the keystroke goes.
    const line = formatStatusLine({
      ...base,
      maxColumns: 74,
      question: q({
        text: 'Which tagline works best for the new positioning?',
        options: Array.from({ length: 5 }, (_, i) => `Option number ${i + 1} which runs long`),
      }),
    })
    expect(line).toContain('press 1-5 in the pane')
    expect(line).not.toContain('Option number')
    expect(stringWidth(line)).toBeLessThanOrEqual(74)
  })

  it('says a question is waiting, and where to answer it, when the disclosure cannot fit', () => {
    // Below roughly 44 usable columns there is no room for sponsor + payout + any question text.
    // Section 4.7's disclosure is unconditional, so the question is not shown rather than the
    // disclosure degraded. It used to fall back to the ordinary idle line, which told a developer in
    // a narrow split pane nothing at all: captured 2026-09-29, a real profile question vanished at
    // 60 columns. Saying that one is waiting names no sponsor and shows no question.
    // 54: what COLUMNS=60 leaves after the safety margin (resolveColumns).
    expect(formatStatusLine({ ...base, maxColumns: 54, question: q() })).toBe('tickover · question waiting · answer: tickover pane')
    expect(formatStatusLine({ ...base, maxColumns: 40, question: q() })).toBe('tickover · question waiting')
  })

  // At the exact boundary, one column short of room for " · " plus the hint, the hint is left out
  // rather than added and then clipped by the final truncation (an off-by-one there survived every
  // other test -- whole-branch review, Minor).
  it('adds the hint only when all of it fits', () => {
    const bare = 'tickover · Acme DB · $0.50 · Which tagline? 1 Postgres, but faster  2 Your DB, cached'
    const room = stringWidth(bare) + stringWidth(' · answer: tickover pane')
    expect(formatStatusLine({ ...base, maxColumns: room, question: q() })).toBe(`${bare} · answer: tickover pane`)
    expect(formatStatusLine({ ...base, maxColumns: room - 1, question: q() })).toBe(bare)
  })

  it('tells a developer how to answer whenever the whole question fits with room to spare', () => {
    // Captured 2026-09-29: shown its first production question, a developer typed the option
    // number into Claude Code, which sends it as a prompt. Nothing on the line said otherwise.
    const line = formatStatusLine({ ...base, maxColumns: 200, question: q() })
    expect(line.endsWith(' · answer: tickover pane')).toBe(true)
  })
})

describe('formatStatusLine invariants', () => {
  // The strongest test here, because an invariant is precisely what R17 broke: the old composition
  // was correct on its golden strings and wrong on the whole space around them. Deterministic seed
  // so a failure is reproducible rather than a flake.
  const mulberry32 = (seed: number) => () => {
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }

  // Explicit timeout, kept inline: 1200 seeded iterations exercise every rung (asserted below),
  // and this is slow enough that the default is a bet rather than a budget. The reason written here
  // used to be "it runs alongside the daemon's HTTP suites", which stopped being true when this file
  // moved into the contract -- there are no HTTP suites here. The number was still right; the reason
  // beside it was not. Being inline is why this test survived the move that broke its neighbour.
  it('never exceeds the budget and never silently drops an option', { timeout: 20_000 }, () => {
    const rnd = mulberry32(20260906)
    const pick = <T,>(xs: T[]): T => xs[Math.floor(rnd() * xs.length)] as T
    const marks = ['A', 'B', 'C', 'D', 'E']
    let sawWhole = 0
    let sawHint = 0
    let sawIdle = 0

    for (let iter = 0; iter < 1200; iter++) {
      const n = 2 + Math.floor(rnd() * 4)
      const filler = pick(['x', '字'])
      // Each option starts with a distinct marker letter, so "is option k still present" is an
      // exact string check rather than a guess at where truncation landed.
      const options = Array.from({ length: n }, (_, k) => String(marks[k]) + filler.repeat(Math.floor(rnd() * 39)))
      const text = 'q'.repeat(5 + Math.floor(rnd() * 116))
      const sponsor = 'S'.repeat(1 + Math.floor(rnd() * 30))
      const kind = pick(['choice', 'profile'] as const)
      const cap = 20 + Math.floor(rnd() * 181)
      const question = q({ kind, text, options, sponsor, price_cents: kind === 'profile' ? 0 : 50 })
      const line = formatStatusLine({ ...base, maxColumns: cap, question })
      const where = `iter=${iter} cap=${cap} n=${n} kind=${kind}`

      // 1. The budget is never exceeded. This is the promise the whole module exists to keep.
      expect(stringWidth(line), where).toBeLessThanOrEqual(cap)

      // The line that stands in for a question too narrow to disclose: no sponsor, no question.
      // At the narrowest caps it is itself cut by the final truncation.
      const waiting = ['tickover · question waiting · answer: tickover pane', 'tickover · question waiting'].map((w) => truncateToWidth(w, cap))
      if (waiting.includes(line)) { sawIdle++; continue }
      if (line.includes('press 1-')) {
        // 2. The count fallback must state the true number of options, or it misinforms.
        sawHint++
        expect(line, where).toContain(`press 1-${n} in the pane`)
      } else {
        // 3. Otherwise every option survives, identifiable by its marker letter.
        sawWhole++
        for (let k = 0; k < n; k++) expect(line, where).toContain(`${k + 1} ${marks[k]}`)
      }

      // 4. Section 4.7: whenever a paid question is shown at all, sponsor and payout are shown too.
      if (kind === 'choice') {
        expect(line, where).toContain('$0.50')
        expect(line, where).toContain('S')
      }
    }

    // The rungs are not dead code: each was actually exercised. Without this the assertions above
    // could all pass vacuously on a body that only ever took one branch.
    expect({ sawWhole: sawWhole > 0, sawHint: sawHint > 0, sawIdle: sawIdle > 0 })
      .toEqual({ sawWhole: true, sawHint: true, sawIdle: true })
  })
})
