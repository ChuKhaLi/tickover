import { describe, it, expect } from 'vitest'
import { PROFILE_QUESTIONS, PROFILE_STUDY_TITLE, profileStudyInput } from '../src/profile-questions.js'
import { SystemStudyInput } from '../src/admin-api.js'
import { Segment } from '../src/buyer-api.js'

describe('the shipped panel-profile questions', () => {
  // Same reasoning as the attention pool: parsed through the schema the admin endpoint uses, so
  // content the operator could not have typed cannot ship either. A profile study must *not* carry
  // correct options, and the schema is what says so.
  it('is content the admin endpoint would accept', () => {
    const result = SystemStudyInput.safeParse(profileStudyInput())
    expect(result.success ? [] : result.error.issues).toEqual([])
  })

  // Spec §7 Phase 1 lists "five profile questions written" as a launch precondition. This is the
  // line that says the repository has them, and it is the only place that count is asserted.
  it('is the five spec §7 Phase 1 requires', () => {
    expect(PROFILE_QUESTIONS).toHaveLength(5)
  })

  /**
   * The daemon computes primary language, country, activity tier and operating system itself, and
   * all four are already targeting dimensions (`Segment`). A profile question that asked for one
   * would spend the single question a developer sees in a day re-collecting data the panel holds.
   * Checked against `Segment` rather than a hardcoded word list, so adding a fifth segment to the
   * contract puts this test back in play instead of silently narrowing it.
   */
  it('asks for nothing the daemon already reports', () => {
    // Whole words, not substrings: `os` is inside "m<b>os</b>t", which failed a question that asks
    // nothing about an operating system. A substring check here would have forced the content to
    // avoid ordinary English rather than avoid the segments.
    const segmentWords = Segment.options.flatMap((s) => s.split('_'))
    for (const q of PROFILE_QUESTIONS) {
      for (const word of segmentWords) {
        expect(q.text, `"${q.text}" re-asks the ${word} segment`).not.toMatch(new RegExp(`\\b${word}\\b`, 'i'))
      }
    }
  })

  // Every question is published on /data with its own bar chart, so two questions sharing a text
  // would render as two indistinguishable sections, and their aggregates could not be told apart.
  it('has no duplicate question text', () => {
    expect(new Set(PROFILE_QUESTIONS.map((q) => q.text)).size).toBe(PROFILE_QUESTIONS.length)
  })

  it('installs under one stable title, so a second seed run finds it rather than duplicating it', () => {
    expect(profileStudyInput().title).toBe(PROFILE_STUDY_TITLE)
  })
})
