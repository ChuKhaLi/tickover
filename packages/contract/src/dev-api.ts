import { z } from 'zod'
import { ServedQuestion } from './question.js'
import { EXTENSION_KEY_PATTERN, MAX_EXTENSION_KEYS } from './languages.js'

export const OsName = z.enum(['win32', 'darwin', 'linux'])
export const ActivityTier = z.enum(['light', 'regular', 'heavy'])

export const DeveloperSelf = z.object({
  id: z.string().uuid(),
  github_login: z.string(),
  balance_pending_cents: z.number().int(),
  balance_available_cents: z.number().int(),
  today_paid_answers: z.number().int(),
  activity_tier: ActivityTier,
  can_cash_out: z.boolean(),
  payout_method: z.object({ type: z.literal('paypal'), email: z.string().email() }).nullable(),
  // PayPal could not deliver to payout_method (R515); the next batch skips this developer until
  // they save it again. Defaults keep an older server's answer parseable (R504).
  payout_method_needs_confirm: z.boolean().default(false),
  // Sent by PayPal Payouts and waiting for the developer to claim it at PayPal.
  unclaimed_cents: z.number().int().default(0),
  // The address the unclaimed money actually went to -- `payouts.method.email`, fixed on the row at
  // batch creation -- not `payout_method.email` above, which is whatever the developer has saved
  // *now* and may have changed since. Null whenever there is nothing unclaimed. Defaults keep an
  // older server's answer parseable (R504).
  unclaimed_email: z.string().email().nullable().default(null),
})
export type DeveloperSelf = z.infer<typeof DeveloperSelf>

// The GitHub device flow runs on the developer's machine (spec: "GitHub device flow from the
// daemon"; R710). When the server ran it, GitHub's Authorize page told every developer the request
// came from the server's own address. The daemon asks for the client id, runs the flow itself, and
// hands the resulting token here once, to be exchanged for a Tickover api token.
export const AuthConfigResponse = z.object({ github_client_id: z.string().min(1) })
export const GitHubLoginRequest = z.object({ github_token: z.string().min(1).max(255) })
// `closed` (R79): the GitHub account authorized, but the Tickover account behind it is banned --
// deleted by its own developer, or banned by an operator. It is a distinct outcome because
// `complete` would hand back an api_token every guard refuses. No api_token and no developer travel
// with it; there is nothing to authorize and nothing left to disclose.
export const GitHubLoginResponse = z.discriminatedUnion('status', [
  z.object({ status: z.literal('complete'), api_token: z.string(), developer: DeveloperSelf }),
  z.object({ status: z.literal('closed') }),
])
export type GitHubLoginResponse = z.infer<typeof GitHubLoginResponse>

export const HeartbeatRequest = z.object({
  os: OsName,
  tool: z.literal('claude-code'),
  tool_version: z.string().max(40),
  // Bounded in both key shape and cardinality (whole-branch review C1). The keys are derived
  // client-side from filenames, and `path.extname` returns everything after the last dot, so an
  // unconstrained record is a channel for customer and project names -- the one thing the
  // developer's consent screen promises never leaves their machine. Stated here so the
  // constraint binds any client rather than resting on one caller's good behaviour; the daemon
  // narrows further to TELEMETRY_EXTENSIONS before it sends.
  extension_counts: z.record(z.string().regex(EXTENSION_KEY_PATTERN), z.number().int().nonnegative())
    .refine((r) => Object.keys(r).length <= MAX_EXTENSION_KEYS, { message: `at most ${MAX_EXTENSION_KEYS} extension keys` })
    .optional(),
  turns: z.array(z.object({ started_at: z.string().datetime(), ended_at: z.string().datetime() })).max(500).default([]),
})
export type HeartbeatRequest = z.infer<typeof HeartbeatRequest>

export const NextRequest = z.object({
  session_id: z.string().min(1).max(100),
  session_started_at: z.string().datetime(),
  turn_started_at: z.string().datetime(),
})
export type NextRequest = z.infer<typeof NextRequest>

export const NextResponse = z.object({
  question: ServedQuestion.nullable(),
  reason: z.string().optional(),
  retry_after_ms: z.number().int().nonnegative().optional(),
})
export type NextResponse = z.infer<typeof NextResponse>

// R205: 'claude' is the band drawn above Claude Code's prompt by the plugin's hooks module.
export const AnswerSource = z.enum(['pane', 'page', 'vscode', 'claude'])
export type AnswerSource = z.infer<typeof AnswerSource>
export const AnswerRequest = z.object({
  assignment_id: z.string().uuid(),
  option_index: z.number().int().min(0).max(4),
  latency_ms: z.number().int().nonnegative(),
  source: AnswerSource,
  idempotency_key: z.string().min(8).max(64),
})
export type AnswerRequest = z.infer<typeof AnswerRequest>

export const AnswerReason = z.enum(['ok', 'duplicate', 'late', 'not_found', 'already_resolved', 'invalid_option'])
export const AnswerResponse = z.object({
  accepted: z.boolean(),
  reason: AnswerReason,
  earned_cents: z.number().int().nonnegative(),
  balance_pending_cents: z.number().int(),
  balance_available_cents: z.number().int(),
  today_paid_answers: z.number().int(),
})
export type AnswerResponse = z.infer<typeof AnswerResponse>

export const SkipRequest = z.object({ assignment_id: z.string().uuid() })

export const PayoutMethodInput = z.object({ type: z.literal('paypal'), email: z.string().email() })
export type PayoutMethodInput = z.infer<typeof PayoutMethodInput>

// The developer web page. `tickover web` trades the CLI's bearer token for a one-time link;
// everything past that point is the cookie session, so these three shapes are the whole of what
// the page can learn about its own developer.
export const WebSessionResponse = z.object({ url: z.string().url(), expires_in_s: z.number().int().positive() })
export type WebSessionResponse = z.infer<typeof WebSessionResponse>

export const HistoryRow = z.object({
  answered_at: z.string().datetime(),
  sponsor: z.string(),
  study_title: z.string(),
  // Mirrors ServedQuestion.kind: an attention check is never disclosed as one, here or anywhere.
  kind: z.enum(['choice', 'profile']),
  cents: z.number().int(),
  // Follows the ledger, not the answer: 'unpaid' covers both an unpaid study kind and a paid
  // answer with no entry yet, because from the developer's side they look the same.
  status: z.enum(['pending', 'released', 'reversed', 'unpaid']),
  source: AnswerSource,
})
export type HistoryRow = z.infer<typeof HistoryRow>

export const HistoryResponse = z.object({ rows: z.array(HistoryRow), next_cursor: z.string().nullable() })
export type HistoryResponse = z.infer<typeof HistoryResponse>

export const DataSummary = z.object({
  github_login: z.string(),
  os: z.string().nullable(),
  tool_version: z.string().nullable(),
  country: z.string(),
  language_mix: z.record(z.number().int()),
  turns_recorded: z.number().int(),
  answers_recorded: z.number().int(),
  first_seen_at: z.string().datetime(),
  last_seen_at: z.string().datetime().nullable(),
})
export type DataSummary = z.infer<typeof DataSummary>
