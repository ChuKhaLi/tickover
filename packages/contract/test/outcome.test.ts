import { describe, it, expect } from 'vitest'
import { isEarning, answerNotice, AnswerReason } from '../src/index.js'

describe('isEarning', () => {
  // The one the whole-branch review named: the server answers a repeated delivery with
  // accepted:true / earned_cents:0, and every surface rendered that as "✓ +$0.00" -- a checkmark
  // and a zero, which reads as a payment of nothing rather than as "already counted".
  it('is false for duplicate, even though the server accepts it', () => {
    expect(isEarning({ accepted: true, reason: 'duplicate', earned_cents: 0 })).toBe(false)
  })

  it('is true for a real payment and for an answer still queued for delivery', () => {
    expect(isEarning({ accepted: true, reason: 'ok', earned_cents: 50 })).toBe(true)
    expect(isEarning({ accepted: true, reason: 'queued', earned_cents: 50 })).toBe(true)
  })

  // A profile question is unpaid by design, so `ok` with zero cents is a genuine, correct outcome
  // and still confirms to the developer that their answer landed.
  it('is true for an accepted unpaid profile answer', () => {
    expect(isEarning({ accepted: true, reason: 'ok', earned_cents: 0 })).toBe(true)
  })

  it('is false for every outcome the server or the queue rejects', () => {
    for (const reason of ['late', 'failed', 'rejected', 'abandoned', 'not_found', 'already_resolved', 'invalid_option', 'not_current']) {
      expect(isEarning({ accepted: false, reason, earned_cents: 0 }), reason).toBe(false)
    }
  })
})

describe('answerNotice', () => {
  it('says nothing when there is nothing to explain', () => {
    expect(answerNotice({ accepted: true, reason: 'ok', earned_cents: 50 })).toBeNull()
    expect(answerNotice({ accepted: true, reason: 'queued', earned_cents: 50 })).toBeNull()
  })

  it('explains duplicate and late in words rather than leaving a protocol token on screen', () => {
    expect(answerNotice({ accepted: true, reason: 'duplicate', earned_cents: 0 })).toMatch(/already/i)
    expect(answerNotice({ accepted: false, reason: 'late', earned_cents: 0 })).toMatch(/expired/i)
    for (const reason of ['duplicate', 'late']) {
      expect(answerNotice({ accepted: false, reason, earned_cents: 0 })).not.toMatch(/^Not accepted/)
    }
  })

  // Every reason the wire schema can produce must have a sentence: a new AnswerReason added to the
  // contract without one would otherwise surface to a developer as raw protocol text.
  it('covers every wire reason plus the daemon-local ones', () => {
    for (const reason of [...AnswerReason.options, 'queued', 'failed', 'rejected', 'abandoned', 'not_current']) {
      const notice = answerNotice({ accepted: false, reason, earned_cents: 0 })
      if (reason === 'ok' || reason === 'queued') expect(notice, reason).toBeNull()
      else expect(notice, reason).not.toMatch(/^Not accepted/)
    }
  })

  it('falls back to naming an unknown reason rather than staying silent about a refusal', () => {
    expect(answerNotice({ accepted: false, reason: 'something_new', earned_cents: 0 })).toBe('Not accepted: something_new')
  })
})
