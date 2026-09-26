// The fixture the Lighthouse gate serves behind `/api/public/aggregates` (and that task 5's e2e
// suite reuses). It has to satisfy the same schema the real endpoint answers to, or a fixture that
// drifted from the contract would prove nothing about the page it feeds.
import { AggregatesResponse } from '@tickover/contract'
import { describe, it, expect } from 'vitest'
import { AGGREGATES_FIXTURE } from '../../e2e/fixtures/aggregates'

describe('AGGREGATES_FIXTURE', () => {
  it('parses as an AggregatesResponse', () => {
    expect(() => AggregatesResponse.parse(AGGREGATES_FIXTURE)).not.toThrow()
  })

  it('has exactly five questions', () => {
    expect(AGGREGATES_FIXTURE.questions).toHaveLength(5)
  })
})
