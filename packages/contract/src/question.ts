import { z } from 'zod'
import { RULES } from './constants.js'

export const QuestionInput = z.object({
  text: z.string().min(5).max(RULES.QUESTION_TEXT_MAX),
  options: z.array(z.string().min(1).max(RULES.OPTION_TEXT_MAX)).min(2).max(5),
  context: z.string().max(RULES.CONTEXT_MAX).optional(),
  payload: z.record(z.unknown()).optional(),
})
export type QuestionInput = z.infer<typeof QuestionInput>

export const ServedQuestion = z.object({
  assignment_id: z.string().uuid(),
  kind: z.enum(['choice', 'profile']),
  text: z.string(),
  options: z.array(z.string()),
  context: z.string().nullable(),
  sponsor: z.string(),
  price_cents: z.number().int().nonnegative(),
  served_at: z.string().datetime(),
  expires_at: z.string().datetime(),
})
export type ServedQuestion = z.infer<typeof ServedQuestion>
