import { AnswerResponse, DevicePollResponse, DeviceStartResponse, DeveloperSelf, NextResponse, WebSessionResponse, type AnswerRequest, type HeartbeatRequest, type NextRequest } from '@tickover/contract'
import type { z } from 'zod'

export class ServerError extends Error {
  // `retryAfter` is the raw header, deliberately left unparsed: it is either delta-seconds or an
  // HTTP-date, and the date form needs a clock the caller owns (AnswerQueue's injected one), not
  // a wall-clock read inside the fetch wrapper. Kept rather than dropped because the queue
  // schedules a retryable rejection off it -- see RETRYABLE_CLIENT_STATUSES in answer-queue.ts.
  constructor(public status: number, public body: unknown, public retryAfter: string | null = null) { super(`server ${status}`) }
}

/**
 * Parses an HTTP `Retry-After` value into milliseconds from `now`. Returns null for an absent or
 * unusable header so a caller falls back to its own backoff schedule rather than treating a
 * malformed hint as "retry immediately", which is strictly worse than the backoff it replaces.
 *
 * The date branch is gated on the value containing a letter, because every HTTP-date form carries
 * a weekday and month name -- without that gate `Date.parse('-5')` succeeds (V8 reads it as a
 * year-2001 date), and a malformed negative delta would silently become "retry now".
 */
export function parseRetryAfterMs(header: string | null | undefined, now: Date): number | null {
  const raw = header?.trim()
  if (!raw) return null
  if (/^\d+(?:\.\d+)?$/.test(raw)) return Math.round(Number(raw) * 1000)
  if (!/[a-z]/i.test(raw)) return null
  const at = Date.parse(raw)
  return Number.isNaN(at) ? null : Math.max(0, at - now.getTime())
}

export class ServerClient {
  constructor(private baseUrl: string, private token: () => string | null, private fetchFn: typeof fetch = fetch) {}

  private async call<T>(path: string, init: { method: 'GET' | 'POST' | 'PUT'; body?: unknown; auth?: boolean; timeoutMs?: number }, schema: z.ZodType<T>): Promise<T> {
    const headers: Record<string, string> = { accept: 'application/json' }
    if (init.body !== undefined) headers['content-type'] = 'application/json'
    if (init.auth !== false) {
      const t = this.token()
      if (!t) throw new Error('not logged in')
      headers.authorization = `Bearer ${t}`
    }
    const res = await this.fetchFn(`${this.baseUrl}${path}`, {
      method: init.method, headers, body: init.body === undefined ? undefined : JSON.stringify(init.body),
      signal: AbortSignal.timeout(init.timeoutMs ?? 10_000),
    })
    const text = await res.text()
    const parsed = text ? JSON.parse(text) : null
    if (!res.ok) throw new ServerError(res.status, parsed, res.headers.get('retry-after'))
    return schema.parse(parsed)
  }

  deviceStart() { return this.call('/api/dev/auth/device/start', { method: 'POST', auth: false }, DeviceStartResponse) }
  devicePoll(pollToken: string) { return this.call('/api/dev/auth/device/poll', { method: 'POST', body: { poll_token: pollToken }, auth: false }, DevicePollResponse) }
  me() { return this.call('/api/dev/me', { method: 'GET' }, DeveloperSelf) }
  heartbeat(body: HeartbeatRequest) { return this.call('/api/dev/heartbeat', { method: 'POST', body }, DeveloperSelf) }
  next(body: NextRequest, timeoutMs = 30_000) { return this.call('/api/dev/next', { method: 'POST', body, timeoutMs }, NextResponse) }
  answer(body: AnswerRequest) { return this.call('/api/dev/answers', { method: 'POST', body }, AnswerResponse) }
  webSession() { return this.call('/api/dev/web-session', { method: 'POST' }, WebSessionResponse) }
  async skip(assignmentId: string): Promise<void> {
    const t = this.token()
    if (!t) throw new Error('not logged in')
    const res = await this.fetchFn(`${this.baseUrl}/api/dev/skips`, { method: 'POST', headers: { authorization: `Bearer ${t}`, 'content-type': 'application/json' }, body: JSON.stringify({ assignment_id: assignmentId }), signal: AbortSignal.timeout(10_000) })
    if (!res.ok && res.status !== 404) throw new ServerError(res.status, null, res.headers.get('retry-after'))
  }
}
