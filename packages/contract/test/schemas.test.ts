import { describe, it, expect } from 'vitest'
import {
  StudyInput, QuestionInput, AnswerRequest, NextRequest, HeartbeatRequest,
  languageMixFromExtensions, ServedQuestion, HistoryResponse, DataSummary, PayoutBatchView,
  TELEMETRY_EXTENSIONS, EXTENSION_KEY_PATTERN, MAX_EXTENSION_KEYS, EXT_TO_LANGUAGE,
  StudyState, StudyView, AdminStudyView, MarkPaidInput, PaymentView,
  PaymentMethod, ManualPaymentMethod,
} from '../src/index.js'

describe('QuestionInput', () => {
  it('accepts 2 to 5 short options', () => {
    expect(QuestionInput.safeParse({ text: 'Which tagline?', options: ['A', 'B'] }).success).toBe(true)
    expect(QuestionInput.safeParse({ text: 'Which tagline?', options: ['A'] }).success).toBe(false)
    expect(QuestionInput.safeParse({ text: 'x', options: ['A', 'B'] }).success).toBe(false)
    expect(QuestionInput.safeParse({ text: 'Which tagline?', options: ['A', 'B', 'C', 'D', 'E', 'F'] }).success).toBe(false)
  })
  it('caps context at 200 characters', () => {
    expect(QuestionInput.safeParse({ text: 'Which tagline?', options: ['A', 'B'], context: 'x'.repeat(201) }).success).toBe(false)
  })
})

describe('StudyInput', () => {
  it('requires 50 to 500 respondents and 1 to 5 questions', () => {
    const q = { text: 'Which tagline?', options: ['A', 'B'] }
    expect(StudyInput.safeParse({ title: 'Tagline test', sponsor: 'Acme', questions: [q], target_count: 50 }).success).toBe(true)
    expect(StudyInput.safeParse({ title: 'Tagline test', sponsor: 'Acme', questions: [q], target_count: 49 }).success).toBe(false)
    expect(StudyInput.safeParse({ title: 'Tagline test', sponsor: 'Acme', questions: [], target_count: 50 }).success).toBe(false)
  })
})

describe('developer schemas', () => {
  it('validates answer, next and heartbeat payloads', () => {
    expect(AnswerRequest.safeParse({ assignment_id: '8f0b0f2e-6f6a-4a3a-9c1f-0f1e2d3c4b5a', option_index: 1, latency_ms: 2400, source: 'pane', idempotency_key: 'abcdefgh' }).success).toBe(true)
    expect(AnswerRequest.safeParse({ assignment_id: 'nope', option_index: 1, latency_ms: 2400, source: 'pane', idempotency_key: 'abcdefgh' }).success).toBe(false)
    expect(NextRequest.safeParse({ session_id: 's1', session_started_at: '2026-09-10T10:00:00.000Z', turn_started_at: '2026-09-10T10:05:00.000Z' }).success).toBe(true)
    expect(HeartbeatRequest.safeParse({ os: 'win32', tool: 'claude-code', tool_version: '2.1.90', turns: [] }).success).toBe(true)
  })
  it('never exposes attention as a served kind', () => {
    expect(ServedQuestion.shape.kind.options).toEqual(['choice', 'profile'])
  })
})

describe('developer web schemas', () => {
  const row = { answered_at: '2026-09-10T10:00:00.000Z', sponsor: 'Acme', study_title: 'T', kind: 'choice', cents: 50, status: 'pending', source: 'pane' }
  const summary = { github_login: 'o', os: 'win32', tool_version: '2.1.90', country: 'VN', language_mix: { typescript: 3 }, turns_recorded: 2, answers_recorded: 1, first_seen_at: '2026-09-10T10:00:00.000Z', last_seen_at: null }

  it('parses history and data summary', () => {
    expect(HistoryResponse.safeParse({ rows: [row], next_cursor: null }).success).toBe(true)
    expect(HistoryResponse.safeParse({ rows: [], next_cursor: '2026-09-10T10:00:00.000Z' }).success).toBe(true)
    expect(DataSummary.safeParse(summary).success).toBe(true)
    // A machine that has never sent a heartbeat has no os or tool version, and a developer who
    // has never been served has no last_seen_at -- all three are absent facts, not errors.
    expect(DataSummary.safeParse({ ...summary, os: null, tool_version: null }).success).toBe(true)
  })

  it('rejects a row whose money, timing or provenance fields are wrong', () => {
    // The four the page renders as fact: a fractional cent, an unknown payment state, an answer
    // source outside AnswerSource, and a timestamp that is not a timestamp.
    expect(HistoryResponse.safeParse({ rows: [{ ...row, cents: 12.5 }], next_cursor: null }).success).toBe(false)
    expect(HistoryResponse.safeParse({ rows: [{ ...row, status: 'paid' }], next_cursor: null }).success).toBe(false)
    expect(HistoryResponse.safeParse({ rows: [{ ...row, source: 'cli' }], next_cursor: null }).success).toBe(false)
    expect(HistoryResponse.safeParse({ rows: [{ ...row, answered_at: 'yesterday' }], next_cursor: null }).success).toBe(false)
    // `kind` mirrors ServedQuestion's: attention checks are never disclosed as such.
    expect(HistoryResponse.safeParse({ rows: [{ ...row, kind: 'attention' }], next_cursor: null }).success).toBe(false)
    // Absent cursor and end-of-list are different states; only the latter is expressible.
    expect(HistoryResponse.safeParse({ rows: [] }).success).toBe(false)
  })

  // R205: an answer given in the band inside Claude Code is recorded under its own source, and the
  // enum still refuses a value nobody disclosed. Both directions, so neither the addition nor the
  // refusal can be lost on its own.
  it('accepts the claude answer source and still refuses an undisclosed one', () => {
    expect(HistoryResponse.safeParse({ rows: [{ ...row, source: 'claude' }], next_cursor: null }).success).toBe(true)
    expect(AnswerRequest.safeParse({ assignment_id: '8f0b0f2e-6f6a-4a3a-9c1f-0f1e2d3c4b5a', option_index: 0, latency_ms: 1500, source: 'claude', idempotency_key: 'claude-answer-1' }).success).toBe(true)
    expect(AnswerRequest.safeParse({ assignment_id: '8f0b0f2e-6f6a-4a3a-9c1f-0f1e2d3c4b5a', option_index: 0, latency_ms: 1500, source: 'band', idempotency_key: 'claude-answer-1' }).success).toBe(false)
  })

  it('rejects a summary that misreports counts', () => {
    expect(DataSummary.safeParse({ ...summary, turns_recorded: 2.5 }).success).toBe(false)
    expect(DataSummary.safeParse({ ...summary, language_mix: { typescript: 1.5 } }).success).toBe(false)
    expect(DataSummary.safeParse({ ...summary, github_login: null }).success).toBe(false)
  })
})

describe('languageMixFromExtensions', () => {
  it('maps extensions to languages and sums counts', () => {
    expect(languageMixFromExtensions({ ts: 10, tsx: 5, py: 3, weird: 9 })).toEqual({ typescript: 15, python: 3 })
  })
})

// `extension_counts` is the only free-form key space the developer's machine ever puts on the
// wire, and `path.extname` returns everything after the last dot -- not a language suffix. The
// schema is where the constraint has to be stated, so it binds any client rather than resting on
// one caller's good behaviour (whole-branch review C1).
describe('HeartbeatRequest.extension_counts', () => {
  it('accepts ordinary extension keys', () => {
    expect(HeartbeatRequest.safeParse({ os: 'win32', tool: 'claude-code', tool_version: '2.1.90', extension_counts: { ts: 40, py: 2, md: 7, exe: 1 } }).success).toBe(true)
  })

  it('rejects a key that is not a bare short lowercase alphanumeric suffix', () => {
    for (const key of ['acme-internal-prod', 'customer-northwind-2026', 'ProjectPhoenix', 'a'.repeat(13), 'my.thing', '']) {
      expect(HeartbeatRequest.safeParse({ os: 'win32', tool: 'claude-code', tool_version: '2.1.90', extension_counts: { [key]: 1 } }).success).toBe(false)
    }
  })

  it(`rejects more than ${MAX_EXTENSION_KEYS} distinct keys`, () => {
    const ok: Record<string, number> = {}
    for (let i = 0; i < MAX_EXTENSION_KEYS; i++) ok[`e${i}`] = 1
    expect(HeartbeatRequest.safeParse({ os: 'win32', tool: 'claude-code', tool_version: '2.1.90', extension_counts: ok }).success).toBe(true)
    expect(HeartbeatRequest.safeParse({ os: 'win32', tool: 'claude-code', tool_version: '2.1.90', extension_counts: { ...ok, extra: 1 } }).success).toBe(false)
  })

  // The daemon filters against TELEMETRY_EXTENSIONS, which is stricter than the schema. Every
  // entry in it must therefore also satisfy the schema, or the daemon would build bodies its own
  // wire contract rejects.
  it('accepts every extension the daemon is allowed to report', () => {
    for (const ext of TELEMETRY_EXTENSIONS) expect(ext).toMatch(EXTENSION_KEY_PATTERN)
    expect(TELEMETRY_EXTENSIONS.size).toBeLessThanOrEqual(MAX_EXTENSION_KEYS * 2)
    // Every language the server can actually recognise stays reportable -- narrowing the
    // allowlist below EXT_TO_LANGUAGE would silently stop feeding the server's language mix.
    for (const ext of Object.keys(EXT_TO_LANGUAGE)) expect(TELEMETRY_EXTENSIONS.has(ext)).toBe(true)
  })
})

describe('PayoutBatchView', () => {
  const batch = {
    batch_id: 'batch_2026-09-10_abc', adapter: 'manual-csv', count: 2, total_cents: 3500,
    artifact: 'payout_id,developer_id,paypal_email,amount_usd\n',
    created_at: '2026-09-10T10:00:00.000Z', paid_at: null, failed_at: null,
  }

  // A batch ends one of two ways and both are on the wire. `failed_at` is nullable
  // rather than optional on purpose: "this batch has not failed" is a fact the view
  // states, so no reader has to treat a missing key as one.
  it('states both endings, and will not accept a body that omits the failed date', () => {
    expect(PayoutBatchView.safeParse(batch).success).toBe(true)
    expect(PayoutBatchView.safeParse({ ...batch, failed_at: '2026-09-11T09:00:00.000Z' }).success).toBe(true)
    const { failed_at: _omitted, ...withoutFailedAt } = batch
    expect(PayoutBatchView.safeParse(withoutFailedAt).success).toBe(false)
  })

  it('takes a datetime or null and nothing else', () => {
    expect(PayoutBatchView.safeParse({ ...batch, failed_at: 'yesterday' }).success).toBe(false)
    expect(PayoutBatchView.safeParse({ ...batch, failed_at: 1757500000000 }).success).toBe(false)
  })
})

describe('pay per study schemas', () => {
  const base = {
    id: '8f0b0f2e-6f6a-4a3a-9c1f-0f1e2d3c4b5a', kind: 'paid', state: 'awaiting_payment', title: 'T', sponsor: 'S',
    price_cents: 100, developer_cents: 50, at_cost: false, target_count: 50, respondents_completed: 0,
    hold_cents: 0, charged_cents: 0, refunded_cents: 0, targeting: null, questions: [], review_note: null,
    created_at: '2026-09-26T10:00:00.000Z', live_at: null, closed_at: null,
  }

  it('accepts awaiting_payment as a study state', () => {
    expect(StudyState.parse('awaiting_payment')).toBe('awaiting_payment')
  })

  it('defaults the payment fields so an older payload still parses', () => {
    expect(StudyView.parse(base)).toMatchObject({ amount_due_cents: 0, payment_reference: null, payment_instructions: null })
  })

  it('keeps payment fields the server sends', () => {
    const v = StudyView.parse({ ...base, amount_due_cents: 1750, payment_reference: 'TKO-8F0B0F2E', payment_instructions: 'Bank A\nAcct 1' })
    expect(v).toMatchObject({ amount_due_cents: 1750, payment_reference: 'TKO-8F0B0F2E', payment_instructions: 'Bank A\nAcct 1' })
  })

  it('adds buyer_email only on the admin view', () => {
    expect(AdminStudyView.parse({ ...base, buyer_email: 'pm@acme.test' }).buyer_email).toBe('pm@acme.test')
    expect(AdminStudyView.parse(base).buyer_email).toBeNull()
  })

  it('validates mark-paid input', () => {
    expect(MarkPaidInput.parse({ cents: 2750, method: 'wise', reference: '  T-1  ' })).toEqual({ cents: 2750, method: 'wise', reference: 'T-1' })
    expect(() => MarkPaidInput.parse({ cents: 0, method: 'wise', reference: 'x' })).toThrow()
    expect(() => MarkPaidInput.parse({ cents: 2750.5, method: 'wise', reference: 'x' })).toThrow()
    expect(() => MarkPaidInput.parse({ cents: 2750, method: 'paypal', reference: 'x' })).toThrow()
    expect(() => MarkPaidInput.parse({ cents: 2750, method: 'wise', reference: '   ' })).toThrow()
    expect(() => MarkPaidInput.parse({ cents: 2750, method: 'wise', reference: 'x'.repeat(121) })).toThrow()
  })

  it('parses a payment view', () => {
    const p = { id: '8f0b0f2e-6f6a-4a3a-9c1f-0f1e2d3c4b5a', study_id: null, cents: 5000, method: 'bank_transfer', reference: 'VCB-1', recorded_at: '2026-09-26T10:00:00.000Z' }
    // reversed_cents defaults to 0, same reason as amount_due_cents/payment_reference on
    // StudyView (R504): a field added with .default() widens what .parse() returns.
    expect(PaymentView.parse(p)).toEqual({ ...p, reversed_cents: 0 })
  })
})

describe('paypal addendum schemas', () => {
  const base = {
    id: '8f0b0f2e-6f6a-4a3a-9c1f-0f1e2d3c4b5a', kind: 'paid', state: 'awaiting_payment', title: 'T', sponsor: 'S',
    price_cents: 100, developer_cents: 50, at_cost: false, target_count: 50, respondents_completed: 0,
    hold_cents: 0, charged_cents: 0, refunded_cents: 0, targeting: null, questions: [], review_note: null,
    created_at: '2026-09-27T10:00:00.000Z', live_at: null, closed_at: null,
  }

  it('knows paypal as a payment method, but admins cannot type it', () => {
    expect(PaymentMethod.parse('paypal')).toBe('paypal')
    expect(ManualPaymentMethod.options).toEqual(['bank_transfer', 'wise', 'payoneer', 'other'])
    expect(() => MarkPaidInput.parse({ cents: 100, method: 'paypal', reference: 'X' })).toThrow()
  })

  it('defaults paypal_available to false', () => {
    expect(StudyView.parse(base).paypal_available).toBe(false)
    expect(StudyView.parse({ ...base, paypal_available: true }).paypal_available).toBe(true)
  })

  it('defaults reversed_cents to 0 on a payment', () => {
    const p = { id: base.id, study_id: null, cents: 5000, method: 'paypal', reference: '5O190127TN364715T', recorded_at: '2026-09-27T10:00:00.000Z' }
    expect(PaymentView.parse(p).reversed_cents).toBe(0)
    expect(PaymentView.parse({ ...p, reversed_cents: 1250 }).reversed_cents).toBe(1250)
  })
})
