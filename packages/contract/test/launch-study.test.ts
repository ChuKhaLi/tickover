import { describe, it, expect } from 'vitest'
import { LAUNCH_STUDY_QUESTIONS, LAUNCH_STUDY_TITLE, launchStudyInput } from '../src/launch-study.js'
import { StudyInput } from '../src/buyer-api.js'
import { PRICING, quoteStudy } from '../src/constants.js'

describe('the day-one at-cost study', () => {
  // Parsed through the schema `POST /api/buyer/studies` uses. This one is a *buyer* study, not a
  // system study, so it is `StudyInput` that governs it -- a different shape with a different
  // question cap (5) and a required target_count.
  it('is content the buyer endpoint would accept', () => {
    const result = StudyInput.safeParse(launchStudyInput())
    expect(result.success ? [] : result.error.issues).toEqual([])
  })

  /**
   * R104: Tickover runs these under its own name because there is no buyer to attribute them to,
   * and spec §4.7 displays the sponsor to every developer who sees the question. A sponsor naming
   * an organisation that does not exist is the one thing that must not ship here, so the sponsor
   * is pinned rather than left to a caller.
   */
  it('is sponsored by Tickover, the only party actually paying for it', () => {
    expect(launchStudyInput().sponsor).toBe('Tickover')
  })

  it('installs under one stable title, so a second seed run finds it rather than duplicating it', () => {
    expect(launchStudyInput().title).toBe(LAUNCH_STUDY_TITLE)
  })

  /**
   * The spend is real money leaving a real balance, so the number is stated here rather than
   * discovered on a host: at-cost is `developerCents + AT_COST_FEE_CENTS` per answer, and the hold
   * is that times questions times respondents. This is the arithmetic `holdFor` performs, written
   * against `quoteStudy` rather than against a literal so a pricing change moves it.
   */
  it('costs what the at-cost quote says it costs', () => {
    const quote = quoteStudy({ targeted: false, atCost: true })
    const input = launchStudyInput()
    const hold = quote.priceCents * LAUNCH_STUDY_QUESTIONS.length * input.target_count

    expect(quote.priceCents).toBe(PRICING.BASE_CENTS * PRICING.DEVELOPER_SHARE + PRICING.AT_COST_FEE_CENTS)
    expect(hold).toBe(8250)
  })

  // Targeting would raise the price (TARGETING_CENTS) and narrow the panel, and neither serves a
  // study whose whole job is to put paid questions in front of whoever is there on day one.
  it('is untargeted, so it reaches the whole panel at the lower price', () => {
    expect(launchStudyInput().targeting).toBeUndefined()
  })

  it('asks the minimum respondents, the cheapest run the pricing allows', () => {
    expect(launchStudyInput().target_count).toBe(PRICING.MIN_RESPONDENTS)
  })
})
