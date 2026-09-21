import { describe, it, expect } from 'vitest'
import { answeredAfterFrame } from '../../src/answered.js'

const withQuestion = { question: { assignment_id: 'x' } }
const withoutQuestion = { question: null }

// Whole-branch review I5: the daemon honours the 10-second answered TTL and signals its expiry as
// a `question` frame carrying `question: null`. Both the pane and the page only cleared their
// confirmation on a frame that CARRIED a question, so `✓ +$0.50` sat there until the next question
// arrived -- five minutes at best, routinely hours. This is the one rule both surfaces now share.
describe('answeredAfterFrame', () => {
  it('clears the confirmation on a question frame with no question -- the TTL-expiry signal', () => {
    expect(answeredAfterFrame({ earnedCents: 50 }, 'question', withoutQuestion)).toBeNull()
  })

  it('clears it on any frame that carries a question, since that question is the new subject', () => {
    expect(answeredAfterFrame({ earnedCents: 50 }, 'question', withQuestion)).toBeNull()
    expect(answeredAfterFrame({ earnedCents: 50 }, 'status', withQuestion)).toBeNull()
  })

  // The asymmetry is deliberate and load-bearing. `status` frames are hook noise: the daemon
  // emits one on every SessionStart/UserPromptSubmit/Stop/SessionEnd (daemon.ts's `handlers.hook`).
  // A turn ending two seconds after the developer answered would otherwise wipe the ✓ eight
  // seconds early, which is a different bug in the same place -- so a `status` frame with no
  // question must leave the confirmation exactly where it is.
  it('leaves it alone on a status frame with no question, so hook traffic cannot cut the ✓ short', () => {
    expect(answeredAfterFrame({ earnedCents: 50 }, 'status', withoutQuestion)).toEqual({ earnedCents: 50 })
  })

  it('tolerates a missing view and is a no-op when there is nothing to clear', () => {
    expect(answeredAfterFrame({ earnedCents: 50 }, 'status', null)).toEqual({ earnedCents: 50 })
    expect(answeredAfterFrame(null, 'question', withoutQuestion)).toBeNull()
  })

  // The page stores its confirmation as a bare cents number and the pane as an object; the rule
  // is about WHEN to clear, never about what is being cleared, so it must pass either through.
  it('returns the previous value unchanged whatever shape a surface keeps it in', () => {
    expect(answeredAfterFrame(50, 'status', withoutQuestion)).toBe(50)
  })
})
