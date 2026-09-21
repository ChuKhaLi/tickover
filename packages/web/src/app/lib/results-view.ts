import { Segment, type StudyResults } from '@tickover/contract'
import type { z } from 'zod'

// `Segment` reaches the contract's surface as a schema with no companion type
// (R45), so the union comes from `z.infer`. Taking it from the contract rather
// than writing the four names out means a fifth segment on the server breaks
// this file rather than quietly going unrendered.
export type SegmentName = z.infer<typeof Segment>

export interface OptionRow { option: string; count: number; pct: number }
export interface SegmentTable { segment: SegmentName; rows: Array<{ key: string; total: number; cells: number[] }> }

/**
 * Keyed as a `Record` over the contract's union on purpose, the same way
 * `study-badge.ts` is: a segment added to the contract fails to compile here
 * instead of reaching the page in its wire form with an underscore in it.
 */
export const SEGMENT_LABELS: Record<SegmentName, string> = {
  primary_language: 'primary language',
  country: 'country',
  activity_tier: 'activity tier',
  os: 'operating system',
}

const pct = (n: number, total: number) => (total === 0 ? 0 : Math.round((n / total) * 100))

/**
 * How far a study has got, as a percentage of what was bought. Clamped, because
 * `respondents_completed` can pass `target_count` — the server counts completed
 * respondents and the last few can land together — and a bar drawn wider than
 * its own track reads as a broken page rather than as good news.
 */
export function progressPct(completed: number, target: number): number {
  return Math.min(100, pct(completed, target))
}

/**
 * Percentages are of the answers to this question, not of `valid_responses`:
 * they are what the buyer compares against each other, so they have to add to
 * a hundred.
 */
export function optionRows(options: string[], counts: number[]): OptionRow[] {
  const total = counts.reduce((s, c) => s + c, 0)
  // `counts[i] ?? 0` rather than `counts[i]`: a short array is not a shape the
  // server sends, but if one ever arrives the arithmetic below yields NaN and
  // the page prints it next to an option.
  return options.map((option, i) => ({ option, count: counts[i] ?? 0, pct: pct(counts[i] ?? 0, total) }))
}

/**
 * One row set per segment that has anything in it, biggest group first, ties
 * broken on the key so the order is the same on every render.
 *
 * A withheld breakdown (R35/R41, plan 1 — four segments at once identify a
 * respondent while a study is still filling) arrives as four empty records,
 * which is byte for byte what a study nobody has answered arrives as. This
 * returns nothing for both, so the page must read `breakdown_state` to tell
 * them apart rather than reading the maps.
 */
export function segmentTables(q: StudyResults['questions'][number]): SegmentTable[] {
  const out: SegmentTable[] = []
  for (const segment of Segment.options) {
    const seg = q.breakdown[segment] ?? {}
    const rows = Object.entries(seg).map(([key, counts]) => {
      const total = counts.reduce((s, c) => s + c, 0)
      return { key, total, cells: counts.map((c) => pct(c, total)) }
    }).sort((a, b) => b.total - a.total || a.key.localeCompare(b.key))
    if (rows.length) out.push({ segment, rows })
  }
  return out
}
