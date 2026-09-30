import { z } from 'zod'
import { PRICING } from './constants.js'
import { QuestionInput } from './question.js'
import { ActivityTier, OsName } from './dev-api.js'

export const Targeting = z.object({
  languages: z.array(z.string().min(1).max(20)).max(10).optional(),
  countries: z.array(z.string().length(2)).max(20).optional(),
  activity_tiers: z.array(ActivityTier).max(3).optional(),
  os: z.array(OsName).max(3).optional(),
})
export type Targeting = z.infer<typeof Targeting>

export function isTargeted(t: Targeting | null | undefined): boolean {
  if (!t) return false
  return Boolean(t.languages?.length || t.countries?.length || t.activity_tiers?.length || t.os?.length)
}

export const StudyInput = z.object({
  title: z.string().min(3).max(80),
  sponsor: z.string().min(2).max(30),
  questions: z.array(QuestionInput).min(1).max(5),
  target_count: z.number().int().min(PRICING.MIN_RESPONDENTS).max(PRICING.MAX_RESPONDENTS),
  targeting: Targeting.optional(),
})
export type StudyInput = z.infer<typeof StudyInput>

export const StudyState = z.enum(['draft', 'awaiting_payment', 'in_review', 'live', 'closed', 'settled', 'rejected'])
export const StudyKind = z.enum(['paid', 'profile', 'attention'])

export const StudyView = z.object({
  id: z.string().uuid(),
  kind: StudyKind,
  state: StudyState,
  title: z.string(),
  sponsor: z.string(),
  price_cents: z.number().int(),
  developer_cents: z.number().int(),
  at_cost: z.boolean(),
  target_count: z.number().int(),
  respondents_completed: z.number().int(),
  hold_cents: z.number().int(),
  charged_cents: z.number().int(),
  refunded_cents: z.number().int(),
  targeting: Targeting.nullable(),
  questions: z.array(z.object({
    id: z.string().uuid(), position: z.number().int(), text: z.string(),
    options: z.array(z.string()), context: z.string().nullable(),
  })),
  review_note: z.string().nullable(),
  created_at: z.string().datetime(),
  live_at: z.string().datetime().nullable(),
  closed_at: z.string().datetime().nullable(),
  // Defaults, not required fields, so a payload from before pay-per-study (a fixture, a cached
  // response) still parses; the server always sends all three.
  amount_due_cents: z.number().int().default(0),
  payment_reference: z.string().nullable().default(null),
  // Only ever non-null for the owning buyer while the study is awaiting payment (R502).
  payment_instructions: z.string().nullable().default(null),
  // True only for the owning buyer, only while awaiting payment, only when PayPal is configured.
  paypal_available: z.boolean().default(false),
})
export type StudyView = z.infer<typeof StudyView>

export const AudienceEstimateRequest = z.object({
  targeting: Targeting.optional(),
  target_count: z.number().int().min(PRICING.MIN_RESPONDENTS).max(PRICING.MAX_RESPONDENTS),
})
export const AudienceEstimate = z.object({
  reachable_developers: z.number().int(),
  estimated_fill_hours: z.number().int().nullable(),
})
export type AudienceEstimate = z.infer<typeof AudienceEstimate>

export const Segment = z.enum(['primary_language', 'country', 'activity_tier', 'os'])

// Whether the per-question `breakdown` maps carry data. Segmenting by
// country, language, activity tier and operating system at once is a
// quasi-identifier: a buyer who targeted narrowly and has a single
// respondent gets that person's profile back. The segments are therefore
// withheld until the study settles, and this field says so, so a client can
// tell "withheld" from "no answers yet" instead of reading empty maps.
export const BreakdownState = z.enum(['available', 'withheld_until_settled'])
export type BreakdownState = z.infer<typeof BreakdownState>

export const StudyResults = z.object({
  study_id: z.string().uuid(),
  respondents_completed: z.number().int(),
  valid_responses: z.number().int(),
  breakdown_state: BreakdownState,
  questions: z.array(z.object({
    question_id: z.string().uuid(),
    position: z.number().int(),
    text: z.string(),
    options: z.array(z.string()),
    counts: z.array(z.number().int()),
    breakdown: z.record(Segment, z.record(z.string(), z.array(z.number().int()))),
  })),
})
export type StudyResults = z.infer<typeof StudyResults>

export const BuyerAuthRequest = z.object({ email: z.string().email() })
export const BuyerSelf = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  org: z.string().nullable(),
  credit_cents: z.number().int(),
  first_study_used: z.boolean(),
})
export const BuyerUpdate = z.object({ org: z.string().min(2).max(80) })

export const AdminStudyView = StudyView.extend({ buyer_email: z.string().nullable().default(null) })
export type AdminStudyView = z.infer<typeof AdminStudyView>

/** What an admin may type into Mark paid. A PayPal payment is recorded by the server (R505). */
export const ManualPaymentMethod = z.enum(['bank_transfer', 'wise', 'payoneer', 'other'])
export type ManualPaymentMethod = z.infer<typeof ManualPaymentMethod>
export const PaymentMethod = z.enum([...ManualPaymentMethod.options, 'paypal'])
export type PaymentMethod = z.infer<typeof PaymentMethod>

export const MarkPaidInput = z.object({
  cents: z.number().int().positive().max(10_000_000),
  method: ManualPaymentMethod,
  reference: z.string().trim().min(1).max(120),
})
export type MarkPaidInput = z.infer<typeof MarkPaidInput>

export const PaymentView = z.object({
  id: z.string().uuid(),
  study_id: z.string().uuid().nullable(),
  cents: z.number().int(),
  method: PaymentMethod,
  reference: z.string(),
  recorded_at: z.string().datetime(),
  reversed_cents: z.number().int().default(0),
})
export type PaymentView = z.infer<typeof PaymentView>

export const MarkPaidResult = z.object({
  study: AdminStudyView,
  submitted: z.boolean(),
  amount_due_cents: z.number().int(),
})
export type MarkPaidResult = z.infer<typeof MarkPaidResult>
