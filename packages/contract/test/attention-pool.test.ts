import { describe, it, expect } from 'vitest'
import { ATTENTION_POOL, ATTENTION_STUDY_TITLE, attentionStudyInput } from '../src/attention-pool.js'
import { SystemStudyInput } from '../src/admin-api.js'

describe('the shipped attention pool', () => {
  // The pool is installed through the same shape `POST /api/admin/system-studies`
  // validates, so content the operator could not have typed by hand cannot ship
  // either -- a question over QUESTION_TEXT_MAX, an option over OPTION_TEXT_MAX, a
  // sixth option, or a correct_option pointing past the end of its own list. Parsing
  // the real schema rather than re-asserting the literals is the point: a test that
  // restated the lengths would pass on content the endpoint rejects (R99, plan 2).
  it('is content the admin endpoint would accept', () => {
    const result = SystemStudyInput.safeParse(attentionStudyInput())
    expect(result.success ? [] : result.error.issues).toEqual([])
  })

  // A pool whose answer is always in the same place is not an attention check: a
  // developer who never reads and always presses 2 would pass every one of them.
  // This caught exactly that -- the first draft that satisfied every other rule here
  // had all five correct answers at index 1.
  it('does not put every correct answer in the same position', () => {
    const positions = new Set(ATTENTION_POOL.map((q) => q.correctOption))
    expect(positions.size).toBeGreaterThan(1)
  })

  // The rule that every item is answerable once truncated is not asserted here: it is a
  // property of the rendered status line, so it is measured against the real composer in
  // `packages/daemon/test/unit/content-legibility.test.ts`. A character count in this
  // file would look like that check without being it.
  it('names every correct option as one of its own options', () => {
    for (const q of ATTENTION_POOL) {
      expect(q.options[q.correctOption], `"${q.text}" has no option at index ${q.correctOption}`).toBeDefined()
    }
  })

  it('installs under one stable title, so a second run finds it rather than duplicating it', () => {
    expect(attentionStudyInput().title).toBe(ATTENTION_STUDY_TITLE)
  })
})
