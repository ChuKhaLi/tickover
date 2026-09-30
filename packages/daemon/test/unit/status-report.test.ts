import { describe, it, expect } from 'vitest'
import { statusReport } from '../../src/status-report.js'

describe('statusReport', () => {
  // Captured 2026-09-29: `tickover status` printed "loggedIn": true and "logged_in": true.
  it('says whether you are logged in once, as loggedIn', () => {
    const r = statusReport(47321, { ok: true, loggedIn: true }, { question: null, logged_in: true, today_paid_answers: 0 })
    expect(r).toEqual({ port: 47321, ok: true, loggedIn: true, question: null, today_paid_answers: 0 })
  })
})
