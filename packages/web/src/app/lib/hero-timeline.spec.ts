// The hero's timeline: a pure function of elapsed time. Everything the page draws comes from here,
// so the beats, the final frame and the honesty of the row are all asserted without a browser.
import { describe, it, expect } from 'vitest'
import { RULES, formatStatusLine, quoteStudy, type ServedQuestion } from '@tickover/contract'
import { HERO_STUDY } from './hero-study'
import {
  AT, AVAILABLE_CENTS, DRAGGED_FRAME, DURATION_MS, FINAL_FRAME, PROMPT, frameAt, paneInputs,
} from './hero-timeline'

const PAY = quoteStudy({ targeted: false, atCost: false }).developerCents

/** The row the pane would print for a frame, composed exactly the way `tk-pane` composes it. */
function rowAt(ms: number): string {
  const i = paneInputs(frameAt(ms), PAY)
  const question: ServedQuestion | null = i.showQuestion
    ? {
        assignment_id: '00000000-0000-4000-8000-000000000000', kind: 'choice',
        text: HERO_STUDY.question, options: [...HERO_STUDY.options], context: null,
        sponsor: HERO_STUDY.sponsor, price_cents: PAY,
        served_at: '2026-01-01T00:00:00.000Z', expires_at: '2026-01-01T00:05:00.000Z',
      }
    : null
  return formatStatusLine({
    loggedIn: true, question,
    answered: i.answeredCents === null ? null : { earnedCents: i.answeredCents },
    todayPaid: i.todayPaid, pendingCents: i.pendingCents, availableCents: AVAILABLE_CENTS,
    maxColumns: 200,
  })
}

describe('hero timeline', () => {
  it('starts with an empty prompt box, nothing sent, and an idle row', () => {
    const f = frameAt(0)
    expect(f).toMatchObject({ typed: 0, submitted: false, tools: 0, row: 'idle', todayPaid: 3, pendingCents: 250, flash: 'none' })
    expect(f.spinner.shown).toBe(false)
  })

  it('types the whole prompt by the end of typing, and not before it starts', () => {
    expect(frameAt(AT.typeFrom - 1).typed).toBe(0)
    expect(frameAt(AT.typeFrom + 500).typed).toBeGreaterThan(0)
    expect(frameAt(AT.typeFrom + 500).typed).toBeLessThan(PROMPT.length)
    expect(frameAt(AT.typeTo).typed).toBe(PROMPT.length)
    expect(frameAt(AT.submit - 1).typed).toBe(PROMPT.length)
  })

  it('sends the prompt on submit, which empties the box', () => {
    expect(frameAt(AT.submit - 1).submitted).toBe(false)
    expect(frameAt(AT.submit)).toMatchObject({ submitted: true, typed: 0 })
  })

  it('brings in the spinner, then each tool line, at their beats', () => {
    expect(frameAt(AT.spinner - 1).spinner.shown).toBe(false)
    expect(frameAt(AT.spinner).spinner).toMatchObject({ shown: true, running: true, seconds: 0 })
    expect(frameAt(AT.tool1 - 1).tools).toBe(0)
    expect(frameAt(AT.tool1).tools).toBe(1)
    expect(frameAt(AT.tool2 - 1).tools).toBe(1)
    expect(frameAt(AT.tool2).tools).toBe(2)
  })

  it('cycles the spinner glyph and counts whole seconds since the prompt was sent', () => {
    expect(frameAt(AT.spinner).spinner.glyph).not.toBe(frameAt(AT.spinner + 120).spinner.glyph)
    expect(frameAt(AT.submit + 999).spinner.seconds).toBe(0)
    expect(frameAt(AT.submit + 3000).spinner.seconds).toBe(3)
  })

  it('moves the row idle, question, credited, idle, and the counters only on credit', () => {
    expect(frameAt(AT.question - 1).row).toBe('idle')
    expect(frameAt(AT.question).row).toBe('question')
    expect(frameAt(AT.credited - 1)).toMatchObject({ row: 'question', todayPaid: 3, pendingCents: 250 })
    expect(frameAt(AT.credited)).toMatchObject({ row: 'credited', todayPaid: 4, pendingCents: 300 })
    expect(frameAt(AT.end - 1).row).toBe('credited')
    expect(frameAt(AT.end).row).toBe('idle')
  })

  it('flashes the row when the question lands and the money when it is credited, 600 ms each', () => {
    expect(frameAt(AT.question - 1).flash).toBe('none')
    expect(frameAt(AT.question).flash).toBe('row')
    expect(frameAt(AT.question + 599).flash).toBe('row')
    expect(frameAt(AT.question + 600).flash).toBe('none')
    expect(frameAt(AT.credited).flash).toBe('money')
    expect(frameAt(AT.credited + 600).flash).toBe('none')
  })

  it('ends on the final frame the spec names, and stays there', () => {
    expect(FINAL_FRAME).toEqual({
      typed: 0, submitted: true, tools: 2,
      spinner: { shown: true, glyph: '✻', seconds: 7, running: false },
      row: 'idle', todayPaid: 4, pendingCents: 300, flash: 'none',
    })
    expect(frameAt(DURATION_MS)).toEqual(FINAL_FRAME)
    expect(frameAt(DURATION_MS + 60_000)).toEqual(FINAL_FRAME)
    expect(DURATION_MS).toBe(AT.end)
  })

  it('treats a negative time as the start', () => {
    expect(frameAt(-50)).toEqual(frameAt(0))
  })

  it('a drag shows the final session with the question on the row', () => {
    expect(DRAGGED_FRAME).toEqual({ ...FINAL_FRAME, row: 'question' })
  })

  // The claim the whole hero rests on: every row the sequence shows is one the client prints.
  it('every row it shows is a composed line, in the order idle, question, credited, idle', () => {
    const idleBefore = `tickover · today 3/${RULES.MAX_PAID_PER_DAY} · balance $12.50`
    const idleAfter = `tickover · today 4/${RULES.MAX_PAID_PER_DAY} · balance $13.00`
    const credited = `tickover · ✓ +$0.50 · today 4/${RULES.MAX_PAID_PER_DAY} · balance $13.00`
    const seen: string[] = []
    for (let ms = 0; ms <= DURATION_MS + 200; ms += 100) {
      const row = rowAt(ms)
      if (seen.at(-1) !== row) seen.push(row)
    }
    expect(seen).toHaveLength(4)
    expect(seen[0]).toBe(idleBefore)
    expect(seen[1]).toContain(HERO_STUDY.sponsor)
    expect(seen[1]).toContain(HERO_STUDY.question)
    expect(seen[2]).toBe(credited)
    expect(seen[3]).toBe(idleAfter)
  })
})
