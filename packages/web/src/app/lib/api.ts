import { Injectable, inject } from '@angular/core'
import { HttpClient, HttpErrorResponse } from '@angular/common/http'
import { firstValueFrom } from 'rxjs'
import { z, type ZodType } from 'zod'
import {
  AggregatesResponse, AudienceEstimate, BuyerSelf, CreditPack, DataSummary, DeveloperSelf, HistoryResponse, PayoutBatchView, StudyResults, StudyView,
  type AudienceEstimateRequest, type PayoutMethodInput, type StudyInput, type SystemStudyInput,
} from '@tickover/contract'

export class ApiError extends Error {
  constructor(public status: number, public body: unknown) { super(`api ${status}`) }
}

export const AdminDeveloper = z.object({
  id: z.string().uuid(), github_login: z.string(), status: z.enum(['active', 'flagged', 'banned']), flag_reason: z.string().nullable(),
  country: z.string(), activity_tier: z.string(), created_at: z.string(), last_seen_at: z.string().nullable(),
})
export type AdminDeveloper = z.infer<typeof AdminDeveloper>

/**
 * A fresh `Idempotency-Key`. Scoped per buyer on the server, so a collision would only
 * matter within one buyer's own studies, and `randomUUID` is far past sufficient for that.
 *
 * The fallback exists because `crypto.randomUUID` is unavailable on a page served over
 * plain HTTP from anything but localhost -- a staging deploy without TLS is exactly where
 * a create would then throw instead of being sent.
 */
export function newIdempotencyKey(): string {
  const c: Crypto | undefined = globalThis.crypto
  if (typeof c?.randomUUID === 'function') return c.randomUUID()
  return `k-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`
}

const Ok = z.object({ ok: z.boolean() }).passthrough()
const Invariants = z.object({ ok: z.boolean(), problems: z.array(z.string()) })

@Injectable({ providedIn: 'root' })
export class ApiService {
  private http = inject(HttpClient)

  private async request<T>(method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', path: string, body: unknown, schema: ZodType<T>, headers?: Record<string, string>): Promise<T> {
    try {
      const res = await firstValueFrom(this.http.request(method, path, { body, headers, observe: 'response', responseType: 'json' }))
      return schema.parse(res.body ?? undefined)
    } catch (e) {
      if (e instanceof HttpErrorResponse) throw new ApiError(e.status, e.error)
      throw e
    }
  }

  get<T>(path: string, schema: ZodType<T>) { return this.request('GET', path, undefined, schema) }
  post<T>(path: string, body: unknown, schema: ZodType<T>, headers?: Record<string, string>) { return this.request('POST', path, body, schema, headers) }
  put<T>(path: string, body: unknown, schema: ZodType<T>) { return this.request('PUT', path, body, schema) }
  async delete(path: string): Promise<void> { await this.request('DELETE', path, undefined, z.unknown()) }

  buyerMe() { return this.get('/api/buyer/me', BuyerSelf) }
  buyerStudies() { return this.get('/api/buyer/studies', z.array(StudyView)) }
  buyerStudy(id: string) { return this.get(`/api/buyer/studies/${id}`, StudyView) }
  /**
   * `Idempotency-Key` is required by the server: a lost response used to mint a second
   * draft, and no client-side guard can see a response it never received. The caller owns
   * the key because the caller is the only one that knows whether this is a retry of the
   * same study or a different one -- see `new.page.ts`.
   */
  createStudy(input: StudyInput, idempotencyKey: string) { return this.post('/api/buyer/studies', input, StudyView, { 'Idempotency-Key': idempotencyKey }) }
  submitStudy(id: string) { return this.post(`/api/buyer/studies/${id}/submit`, {}, StudyView) }
  // `AudienceEstimateRequest` reaches the contract's surface as a schema only —
  // it has no companion `export type`. `z.infer<typeof …>` is what the server
  // does with the same schema (`buyer.controller.ts:75`).
  estimate(input: z.infer<typeof AudienceEstimateRequest>) { return this.post('/api/buyer/studies/estimate', input, AudienceEstimate) }
  results(id: string) { return this.get(`/api/buyer/studies/${id}/results`, StudyResults) }
  creditPacks() { return this.get('/api/buyer/credits/packs', z.array(CreditPack)) }
  async requestBuyerLink(email: string): Promise<void> { await this.post('/api/buyer/auth/request', { email }, Ok) }
  async buyerLogout(): Promise<void> { await this.post('/api/buyer/auth/logout', {}, Ok) }
  updateBuyer(org: string) { return this.request('PATCH', '/api/buyer/me', { org }, BuyerSelf) }

  devMe() { return this.get('/api/dev/web/me', DeveloperSelf) }
  // `cursor` is opaque: whatever the previous page's `next_cursor` was, sent back
  // untouched. Never parsed, formatted or constructed here.
  devHistory(cursor?: string) { return this.get(`/api/dev/web/history${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`, HistoryResponse) }
  devData() { return this.get('/api/dev/web/data', DataSummary) }
  devPayoutMethod(input: PayoutMethodInput) { return this.put('/api/dev/web/payout-method', input, DeveloperSelf) }
  devDelete() { return this.delete('/api/dev/web/me') }
  async devLogout(): Promise<void> { await this.post('/api/dev/web/logout', {}, Ok) }

  async adminLogin(input: { email: string; password: string; totp: string }): Promise<void> { await this.post('/api/admin/auth/login', input, Ok) }
  // The session probe. Deliberately not `adminInvariants()`, which was standing in
  // for it until Task 9: that route scans the whole ledger, and using it as the
  // gate meant a ledger check that throws would lock the operator out of the page
  // that reports it.
  async adminMe(): Promise<void> { await this.get('/api/admin/me', Ok) }
  async adminLogout(): Promise<void> { await this.post('/api/admin/auth/logout', {}, Ok) }
  adminStudies(state?: string) { return this.get(`/api/admin/studies${state ? `?state=${state}` : ''}`, z.array(StudyView)) }
  adminReview(id: string, decision: 'approve' | 'reject', note?: string) { return this.post(`/api/admin/studies/${id}/review`, { decision, note }, StudyView) }
  adminClose(id: string) { return this.post(`/api/admin/studies/${id}/close`, {}, StudyView) }
  adminSystemStudies() { return this.get('/api/admin/system-studies', z.array(StudyView)) }
  adminCreateSystemStudy(input: SystemStudyInput) { return this.post('/api/admin/system-studies', input, StudyView) }
  adminDevelopers(status: 'active' | 'flagged' | 'banned') { return this.get(`/api/admin/developers?status=${status}`, z.array(AdminDeveloper)) }
  /**
   * `expected_status` is the optimistic-concurrency claim: the status this row had when the
   * operator looked at it. Two operators from two browsers both used to get 200 and the
   * later write won silently. A 409 means the row moved underneath them.
   */
  adminSetStatus(id: string, status: 'active' | 'flagged' | 'banned', expectedStatus: 'active' | 'flagged' | 'banned', reason?: string) {
    return this.post(`/api/admin/developers/${id}/status`, { status, expected_status: expectedStatus, reason }, AdminDeveloper)
  }
  adminBatches() { return this.get('/api/admin/payouts/batches', z.array(PayoutBatchView)) }
  adminCreateBatch() { return this.post('/api/admin/payouts/batches', {}, PayoutBatchView) }
  adminBatchPaid(id: string) { return this.post(`/api/admin/payouts/batches/${id}/paid`, {}, PayoutBatchView) }
  adminBatchFailed(id: string) { return this.post(`/api/admin/payouts/batches/${id}/failed`, {}, PayoutBatchView) }
  adminInvariants() { return this.get('/api/admin/invariants', Invariants) }

  publicAggregates() { return this.get('/api/public/aggregates', AggregatesResponse) }
}
