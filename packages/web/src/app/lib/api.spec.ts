import { TestBed } from '@angular/core/testing'
import { provideHttpClient } from '@angular/common/http'
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing'
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { ApiService, ApiError } from './api'

describe('ApiService', () => {
  let api: ApiService
  let http: HttpTestingController
  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] })
    api = TestBed.inject(ApiService)
    http = TestBed.inject(HttpTestingController)
  })
  afterEach(() => http.verify())

  it('parses a buyer with the contract schema', async () => {
    const p = api.buyerMe()
    const req = http.expectOne('/api/buyer/me')
    expect(req.request.method).toBe('GET')
    req.flush({ id: '8f0b0f2e-6f6a-4a3a-9c1f-0f1e2d3c4b5a', email: 'pm@acme.test', org: null, credit_cents: 500, first_study_used: false })
    expect((await p).credit_cents).toBe(500)
  })

  it('rejects malformed responses and surfaces http errors with status and body', async () => {
    const bad = api.buyerMe()
    http.expectOne('/api/buyer/me').flush({ nope: true })
    await expect(bad).rejects.toThrow()
    // A schema mismatch must NOT arrive as an ApiError: callers branch on `status`,
    // and a parse failure has no meaningful one. Wrapping it as ApiError(0, e) would
    // make a malformed 200 indistinguishable from an HTTP failure.
    await expect(bad).rejects.not.toBeInstanceOf(ApiError)
    const err = api.buyerMe()
    http.expectOne('/api/buyer/me').flush({ error: 'unauthorized' }, { status: 401, statusText: 'Unauthorized' })
    await expect(err).rejects.toMatchObject({ status: 401, body: { error: 'unauthorized' } })
    await expect(err).rejects.toBeInstanceOf(ApiError)
  })

  // `status` is the field AuthState and every page branches on. Observed at 401
  // alone it only proves the field is populated, not that it carries the real
  // value — a hardcoded `new ApiError(401, …)` would pass the test above.
  it('carries the response status, not just 401', async () => {
    const boom = api.buyerMe()
    http.expectOne('/api/buyer/me').flush({ error: 'internal' }, { status: 500, statusText: 'Server Error' })
    await expect(boom).rejects.toMatchObject({ status: 500, body: { error: 'internal' } })

    const missing = api.buyerStudy('7f3c')
    http.expectOne('/api/buyer/studies/7f3c').flush({ error: 'not_found' }, { status: 404, statusText: 'Not Found' })
    await expect(missing).rejects.toMatchObject({ status: 404, body: { error: 'not_found' } })
  })

  it('posts json bodies', async () => {
    const p = api.requestBuyerLink('pm@acme.test')
    const req = http.expectOne('/api/buyer/auth/request')
    expect(req.request.method).toBe('POST')
    expect(req.request.body).toEqual({ email: 'pm@acme.test' })
    req.flush({ ok: true })
    await p
  })
})
