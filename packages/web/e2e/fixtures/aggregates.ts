import { AggregatesResponse } from '@tickover/contract'
import type { z } from 'zod'

// Five questions with realistic option text and non-zero counts, typed against the contract
// schema rather than a shape guessed by hand. The Lighthouse gate (`scripts/lighthouse.ts`) serves
// this behind `/api/public/aggregates` so `/data` renders its real layout — the CLS the spec
// targets comes from the `mw-async` block that arrives after first paint, and a static tree with
// no API would always audit `/data` in its permanent failure state instead. Task 5's e2e tests
// reuse the same fixture, so both suites measure against one set of numbers.
export const AGGREGATES_FIXTURE: z.infer<typeof AggregatesResponse> = {
  generated_at: '2026-09-20T09:00:00.000Z',
  questions: [
    {
      question_id: '11111111-1111-4111-8111-111111111111',
      text: 'Which model do you use most in Claude Code?',
      options: ['Opus', 'Sonnet', 'Haiku'],
      counts: [140, 310, 52],
      total: 502,
    },
    {
      question_id: '22222222-2222-4222-8222-222222222222',
      text: 'How many hours a day does Claude Code run for you?',
      options: ['Under 2', '2 to 5', 'Over 5'],
      counts: [96, 244, 118],
      total: 458,
    },
    {
      question_id: '33333333-3333-4333-8333-333333333333',
      text: 'Do you run more than one agent in parallel?',
      options: ['Never', 'Sometimes', 'Most sessions'],
      counts: [180, 201, 77],
      total: 458,
    },
    {
      question_id: '44444444-4444-4444-8444-444444444444',
      text: 'Which editor do you pair Claude Code with?',
      options: ['VS Code', 'Neovim', 'JetBrains', 'Terminal only'],
      counts: [230, 64, 58, 91],
      total: 443,
    },
    {
      question_id: '55555555-5555-4555-8555-555555555555',
      text: 'What is your primary language this month?',
      options: ['TypeScript', 'Python', 'Go', 'Rust'],
      counts: [201, 156, 49, 33],
      total: 439,
    },
  ],
}
