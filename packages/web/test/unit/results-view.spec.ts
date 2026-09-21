import { describe, it, expect } from 'vitest'
import { Segment, type StudyResults } from '@tickover/contract'
import { SEGMENT_LABELS, optionRows, progressPct, segmentTables } from '../../src/app/lib/results-view'

type Question = StudyResults['questions'][number]

const question = (over: Partial<Question> = {}): Question => ({
  question_id: '8f0b0f2e-6f6a-4a3a-9c1f-0f1e2d3c4b5a', position: 0, text: 'Q', options: ['A', 'B'], counts: [3, 1],
  breakdown: { primary_language: {}, country: {}, activity_tier: {}, os: {} },
  ...over,
})

describe('results view', () => {
  it('computes option percentages', () => {
    expect(optionRows(['A', 'B', 'C'], [3, 1, 0])).toEqual([{ option: 'A', count: 3, pct: 75 }, { option: 'B', count: 1, pct: 25 }, { option: 'C', count: 0, pct: 0 }])
    expect(optionRows(['A'], [0])).toEqual([{ option: 'A', count: 0, pct: 0 }])
  })

  // A shorter counts array than options is not a shape the server sends, and the
  // fallback that handles it is invisible until it is missing: without it the
  // page renders "NaN%" beside an option rather than 0.
  it('reads a missing count as none, not as NaN', () => {
    expect(optionRows(['A', 'B'], [4])).toEqual([{ option: 'A', count: 4, pct: 100 }, { option: 'B', count: 0, pct: 0 }])
  })

  it('rounds rather than truncating', () => {
    expect(optionRows(['A', 'B', 'C'], [1, 1, 1]).map((r) => r.pct)).toEqual([33, 33, 33])
    expect(optionRows(['A', 'B', 'C'], [2, 1, 0]).map((r) => r.pct)).toEqual([67, 33, 0])
  })

  // The brief's fixture, with two corrections. Both languages total 2 and the
  // brief expected typescript first, but the tie-break it specifies is the key
  // ascending, so python comes first. And the two keys arrive in the reverse of
  // the order they are expected in: as the brief wrote them the insertion order
  // was already alphabetical, so a sort with no tie-break at all produced the
  // same answer and the assertion could not fail.
  it('builds segment tables sorted by total and skips empty segments', () => {
    const tables = segmentTables(question({
      breakdown: { primary_language: { typescript: [2, 0], python: [1, 1] }, country: { VN: [3, 1] }, activity_tier: {}, os: { win32: [3, 1] } },
    }))
    expect(tables.map((t) => t.segment)).toEqual(['primary_language', 'country', 'os'])
    expect(tables[0]!.rows).toEqual([{ key: 'python', total: 2, cells: [50, 50] }, { key: 'typescript', total: 2, cells: [100, 0] }])
    expect(tables[1]!.rows).toEqual([{ key: 'VN', total: 4, cells: [75, 25] }])
  })

  // Totals that differ, arriving smallest first, so "sorted by total desc" has to
  // do something. With every total equal the comparator's first clause is dead.
  it('puts the biggest segment first whatever order the keys arrive in', () => {
    const tables = segmentTables(question({
      breakdown: { primary_language: { rust: [1, 0], go: [2, 1], typescript: [6, 4] }, country: {}, activity_tier: {}, os: {} },
    }))
    expect(tables[0]!.rows.map((r) => [r.key, r.total])).toEqual([['typescript', 10], ['go', 3], ['rust', 1]])
  })

  // The reason the page cannot read the maps to decide what to show. A withheld
  // breakdown arrives as four empty records, which is byte for byte what a study
  // nobody has answered yet arrives as. `breakdown_state` is the only difference,
  // so this is the shape that would otherwise render as silence.
  it('yields no tables at all when every segment is empty', () => {
    expect(segmentTables(question())).toEqual([])
  })

  it('names every segment the contract defines, in words', () => {
    for (const s of Segment.options) {
      expect(SEGMENT_LABELS[s], `segment "${s}" has no label`).toBeTruthy()
      expect(SEGMENT_LABELS[s], `segment "${s}" reached the page in its wire form`).not.toContain('_')
    }
  })

  it('reports progress as a percentage of the target', () => {
    expect(progressPct(0, 100)).toBe(0)
    expect(progressPct(37, 100)).toBe(37)
    expect(progressPct(1, 3)).toBe(33)
    // A target of zero is not a thing the contract allows, but dividing by it
    // renders "NaN%" on the one line of this page a buyer watches.
    expect(progressPct(0, 0)).toBe(0)
    // Over-delivery is possible: the server counts completed respondents, and a
    // bar wider than its track is a broken page rather than good news.
    expect(progressPct(120, 100)).toBe(100)
  })
})
