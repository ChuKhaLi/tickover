import { z } from 'zod'
import { QuestionInput } from './question.js'

export const AdminLoginRequest = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  totp: z.string().length(6),
})

export const SystemStudyInput = z.object({
  kind: z.enum(['profile', 'attention']),
  title: z.string().min(3).max(80),
  questions: z.array(QuestionInput.extend({ correct_option: z.number().int().min(0).max(4).optional() })).min(1).max(20),
}).superRefine((v, ctx) => {
  if (v.kind === 'attention') {
    v.questions.forEach((q, i) => {
      if (q.correct_option === undefined || q.correct_option >= q.options.length) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['questions', i, 'correct_option'], message: 'attention questions need a valid correct_option' })
      }
    })
  }
})
export type SystemStudyInput = z.infer<typeof SystemStudyInput>

export const ReviewDecision = z.object({
  decision: z.enum(['approve', 'reject']),
  note: z.string().max(500).optional(),
})

export const PayoutBatchView = z.object({
  batch_id: z.string(),
  adapter: z.string(),
  count: z.number().int(),
  total_cents: z.number().int(),
  artifact: z.string().nullable(),
  created_at: z.string().datetime(),
  paid_at: z.string().datetime().nullable(),
  // A batch ends one of two ways and both have to be readable. `markBatchFailed`
  // credits every exported payout back to its developer and stamps
  // `payout_batches.failed_at`; without this field the view discarded that, so a
  // batch whose money had already been returned was indistinguishable from one
  // nobody had touched -- and marking such a batch paid is a silent no-op, since
  // the claim only matches rows still `exported`. Nullable rather than optional:
  // "this batch has not failed" is a fact worth stating, not an absence.
  failed_at: z.string().datetime().nullable(),
})

/**
 * `expected_status` is the optimistic-concurrency claim, and it is required rather than
 * optional: two operators acting on one row from two browsers both used to get 200 and the
 * later write won silently. Unlike a study review -- which claims on `in_review`, the only
 * legal source state -- any status here can move to any other, so the expectation has to
 * come from the caller. The admin page renders `status` on every row it offers a button on.
 */
export const DeveloperStatusInput = z.object({
  status: z.enum(['active', 'flagged', 'banned']),
  expected_status: z.enum(['active', 'flagged', 'banned']),
  reason: z.string().max(200).optional(),
})

export const AggregatesResponse = z.object({
  generated_at: z.string().datetime(),
  questions: z.array(z.object({
    question_id: z.string().uuid(),
    text: z.string(),
    options: z.array(z.string()),
    counts: z.array(z.number().int()),
    total: z.number().int(),
  })),
})
