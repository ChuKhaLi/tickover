import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { startFakeServer, servedQuestion, type FakeServer } from '../helpers/fake-server.js'
import { ServerClient, ServerError, parseRetryAfterMs } from '../../src/server-client.js'

describe('ServerClient', () => {
  let f: FakeServer
  beforeAll(async () => { f = await startFakeServer() })
  afterAll(async () => { await f.close() })

  it('sends the bearer token and parses responses', async () => {
    const c = new ServerClient(f.url, () => 'api-token-1')
    f.nextQueue.push({ question: servedQuestion() })
    const nextReq = { session_id: 's1', session_started_at: '2026-09-10T09:50:00.000Z', turn_started_at: '2026-09-10T09:59:51.000Z' }
    const next = await c.next(nextReq)
    expect(next.question?.text).toBe('Which tagline?')
    expect(f.nextCalls[0]).toEqual(nextReq)

    const answerReq = { assignment_id: servedQuestion().assignment_id, option_index: 1, latency_ms: 1500, source: 'pane' as const, idempotency_key: servedQuestion().assignment_id }
    const ans = await c.answer(answerReq)
    expect(ans.reason).toBe('ok')
    expect(f.answers[0]!.auth).toBe('Bearer api-token-1')
    expect(f.answers[0]!.body).toEqual(answerReq)

    await c.skip(servedQuestion().assignment_id)
    expect(f.skips).toEqual([servedQuestion().assignment_id])
  })

  // `tickover web` hands the developer this URL and opens it, so a response the schema does not
  // recognise has to fail here rather than reach a browser as `undefined`.
  it('trades the bearer token for a one-time web-session URL', async () => {
    const c = new ServerClient(f.url, () => 'api-token-1')
    const ws = await c.webSession()
    expect(ws).toEqual({ url: `${f.url}/api/dev/web/verify?token=web-token-1`, expires_in_s: 600 })
    expect(f.webSessionAuths).toEqual(['Bearer api-token-1'])

    const notAUrl = (async () => new Response(JSON.stringify({ url: '/dev', expires_in_s: 600 }), { status: 200 })) as unknown as typeof fetch
    await expect(new ServerClient('http://example.invalid', () => 'api-token-1', notAUrl).webSession()).rejects.toThrow()
  })

  it('throws ServerError on non-2xx and rejects without a token', async () => {
    const c = new ServerClient(f.url, () => 'api-token-1')
    f.failAnswersTimes = 1
    await expect(c.answer({ assignment_id: servedQuestion().assignment_id, option_index: 1, latency_ms: 1500, source: 'pane', idempotency_key: 'k' })).rejects.toBeInstanceOf(ServerError)
    const anon = new ServerClient(f.url, () => null)
    await expect(anon.me()).rejects.toThrow(/not logged in/)
  })

  it('rejects unauthenticated requests with 401, matching the real DeveloperGuard', async () => {
    // Goes around ServerClient (which refuses locally before sending when there's no token) to
    // prove the fake server itself enforces the Bearer prefix, the way the real DeveloperGuard
    // does -- so a future bug that drops the auth header shows up here, not just in production.
    const res = await fetch(`${f.url}/api/dev/me`)
    expect(res.status).toBe(401)
    const authed = await fetch(`${f.url}/api/dev/me`, { headers: { authorization: 'Bearer api-token-1' } })
    expect(authed.status).toBe(200)
  })

  // AnswerQueue schedules a retryable failure off this (whole-branch review I1), so the header
  // has to survive the throw rather than being read and dropped at the fetch boundary.
  it('carries Retry-After through ServerError', async () => {
    const limited = (async () => new Response(JSON.stringify({ error: 'rate_limited' }), { status: 429, headers: { 'retry-after': '17' } })) as unknown as typeof fetch
    const err = await new ServerClient('http://example.invalid', () => 'api-token-1', limited)
      .answer({ assignment_id: servedQuestion().assignment_id, option_index: 0, latency_ms: 1, source: 'pane', idempotency_key: 'k1234567' })
      .catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ServerError)
    expect((err as ServerError).status).toBe(429)
    expect((err as ServerError).retryAfter).toBe('17')
  })

  it('skip() tolerates a 404 (assignment already resolved) but rejects other non-2xx', async () => {
    const notFound = (async () => new Response(null, { status: 404 })) as unknown as typeof fetch
    await expect(new ServerClient('http://example.invalid', () => 'api-token-1', notFound).skip('11111111-1111-4111-8111-111111111111')).resolves.toBeUndefined()

    const serverError = (async () => new Response(null, { status: 500 })) as unknown as typeof fetch
    await expect(new ServerClient('http://example.invalid', () => 'api-token-1', serverError).skip('11111111-1111-4111-8111-111111111111')).rejects.toBeInstanceOf(ServerError)
  })
})

describe('parseRetryAfterMs', () => {
  const now = new Date('2026-09-10T10:00:00.000Z')

  it('reads the delta-seconds form', () => {
    expect(parseRetryAfterMs('17', now)).toBe(17_000)
    expect(parseRetryAfterMs(' 0 ', now)).toBe(0)
  })

  it('reads the HTTP-date form, relative to the given clock', () => {
    expect(parseRetryAfterMs('Thu, 10 Sep 2026 10:00:30 GMT', now)).toBe(30_000)
    // A date already in the past means "now", never a negative delay.
    expect(parseRetryAfterMs('Thu, 10 Sep 2026 09:59:00 GMT', now)).toBe(0)
  })

  it('returns null for anything a caller must not act on, so it falls back to its own backoff', () => {
    for (const raw of [null, undefined, '', '   ', 'soon', '-5', 'NaN', '1e3']) {
      expect(parseRetryAfterMs(raw, now)).toBeNull()
    }
  })
})
