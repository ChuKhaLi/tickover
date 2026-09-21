import { describe, it, expect } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { State } from '../../src/state.js'

describe('State', () => {
  it('stores kv, queues answers with backoff, and tracks unsent turns', () => {
    const s = new State(join(mkdtempSync(join(tmpdir(), 'mw-')), 'state.sqlite'))
    s.set('k', 'v')
    expect(s.get('k')).toBe('v')
    expect(s.get('missing')).toBeNull()

    const now = new Date('2026-09-10T10:00:00Z')
    s.enqueueAnswer({ id: 'a1', assignmentId: 'as1', optionIndex: 1, latencyMs: 1500, source: 'pane', idempotencyKey: 'as1', attempts: 0, nextAt: now.toISOString() })
    expect(s.dueAnswers(now)).toHaveLength(1)
    s.markAnswerAttempt('a1', new Date(now.getTime() + 60_000))
    expect(s.dueAnswers(now)).toHaveLength(0)
    expect(s.dueAnswers(new Date(now.getTime() + 61_000))[0]!.attempts).toBe(1)
    s.removeAnswer('a1')
    expect(s.dueAnswers(new Date(now.getTime() + 61_000))).toHaveLength(0)

    s.addTurn({ sessionId: 's1', startedAt: now, endedAt: new Date(now.getTime() + 20_000) })
    const unsent = s.unsentTurns()
    expect(unsent).toHaveLength(1)
    s.markTurnsSent(unsent.map((t) => t.id))
    expect(s.unsentTurns()).toHaveLength(0)
    s.close()
  })

  it('purges sent turns past the 30-day retention window using comparable timestamp formats', () => {
    const s = new State(join(mkdtempSync(join(tmpdir(), 'mw-')), 'state.sqlite'))
    // Deliberately land on the same calendar date as the retention cutoff (now - 30 days), just
    // before it in time-of-day. ended_at is stored as an ISO string ("...T...Z") but the old
    // query compared it against SQLite's datetime('now', '-30 days'), a space-separated string
    // ("YYYY-MM-DD HH:MM:SS") — 'T' (0x54) sorts above ' ' (0x20), so any row sharing the
    // cutoff's calendar date was silently kept forever regardless of time-of-day. A row 31 full
    // days old would (mostly) dodge that bug by landing on an earlier calendar date; this one
    // deliberately doesn't.
    const old = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000 - 1000)
    s.addTurn({ sessionId: 'old', startedAt: old, endedAt: old })
    const [turn] = s.unsentTurns()
    s.markTurnsSent([turn!.id])
    // If retention actually deleted the row, re-adding the identical (sessionId, startedAt) is
    // no longer a unique-constraint conflict and the fresh row shows up as unsent.
    s.addTurn({ sessionId: 'old', startedAt: old, endedAt: old })
    expect(s.unsentTurns()).toHaveLength(1)
    s.close()
  })
})
