import http from 'node:http'
import type { AddressInfo } from 'node:net'
import type { AnswerRequest, AnswerResponse, DeveloperSelf, HeartbeatRequest, NextRequest, NextResponse } from '@tickover/contract'

export interface FakeServer {
  url: string
  nextQueue: NextResponse[]
  answers: Array<{ auth: string | undefined; body: AnswerRequest }>
  answerResponder: (body: AnswerRequest) => AnswerResponse
  failAnswersTimes: number
  // HTTP status used while failAnswersTimes > 0. Defaults to 503 (transient -- AnswerQueue
  // retries with backoff). Set to a 4xx to exercise the permanent-drop path instead.
  answerFailStatus: number
  // Makes /api/dev/next return a 500 this many times before serving normally. Used to exercise
  // the loop's own backoff after a failing next() call (I2), independent of AnswerQueue's.
  nextFailTimes: number
  // Makes /api/dev/heartbeat return a 500 this many times before succeeding. Used to exercise
  // Heartbeat's own failure backoff (round1 review, finding1), independent of AnswerQueue's.
  heartbeatFailTimes: number
  heartbeats: HeartbeatRequest[]
  skips: string[]
  // Authorization headers seen on /api/dev/web-session, so a test can prove `tickover web`
  // reached the server with the developer's bearer token rather than anonymously.
  webSessionAuths: Array<string | undefined>
  // Makes /api/dev/web-session answer with this status instead of minting a link, so a test can
  // watch what `tickover web` tells the developer when the server refuses. 0 means "mint one".
  webSessionStatus: number
  nextCalls: NextRequest[]
  // Delays the /api/dev/next response by this many real milliseconds before answering. Lets a
  // test start a second tick() while the first's `next` call is still outstanding, to exercise
  // the "one call in flight at a time" guard against a genuine overlap rather than a same-tick
  // coincidence.
  nextDelayMs: number
  // Delays the /api/dev/answers response by this many real milliseconds before answering. Lets a
  // test start a tick()-driven flush() and, while it's still outstanding, issue a genuinely
  // overlapping answer() for a different assignment (round3 finding3's overlap test).
  answerDelayMs: number
  self: DeveloperSelf
  // expiresAfterPolls is optional and unset by default (never expires) so every existing test
  // that doesn't care about expiry is unaffected -- when set, the poll response switches to
  // 'expired' once `polls` reaches it, taking priority over pollsUntilComplete.
  // accountClosed makes the poll answer 'closed' where it would have answered 'complete' -- the
  // server's R79 refusal for a deleted or banned developer, which is exactly when the real one
  // says it: GitHub has authorized, and there is no Tickover account left behind it.
  device: { userCode: string; pollsUntilComplete: number; expiresAfterPolls?: number; accountClosed?: boolean }
  close(): Promise<void>
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function body(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve) => { let d = ''; req.setEncoding('utf8'); req.on('data', (c: string) => (d += c)); req.on('end', () => resolve(d)) })
}

// Mirrors the real DeveloperGuard (packages/server/src/auth/guards.ts): every authenticated
// route requires a literal "Bearer " prefix, checked before any route-specific handling. The two
// device-flow routes are the only ones that stay unauthenticated.
const AUTH_REQUIRED_ROUTES = new Set(['/api/dev/me', '/api/dev/heartbeat', '/api/dev/next', '/api/dev/answers', '/api/dev/skips', '/api/dev/web-session'])
function isAuthorized(req: http.IncomingMessage): boolean {
  const header = req.headers.authorization
  return typeof header === 'string' && header.startsWith('Bearer ')
}

export async function startFakeServer(): Promise<FakeServer> {
  const self: DeveloperSelf = { id: '00000000-0000-4000-8000-000000000001', github_login: 'octo', balance_pending_cents: 0, balance_available_cents: 0, today_paid_answers: 0, activity_tier: 'light', can_cash_out: true, payout_method: null, payout_method_needs_confirm: false, unclaimed_cents: 0, unclaimed_email: null }
  const f: FakeServer = {
    url: '', nextQueue: [], answers: [], heartbeats: [], skips: [], webSessionAuths: [], webSessionStatus: 0, nextCalls: [], self,
    answerResponder: (b) => ({ accepted: true, reason: 'ok', earned_cents: 50, balance_pending_cents: 50, balance_available_cents: 0, today_paid_answers: 1 }),
    failAnswersTimes: 0,
    answerFailStatus: 503,
    nextFailTimes: 0,
    heartbeatFailTimes: 0,
    nextDelayMs: 0,
    answerDelayMs: 0,
    device: { userCode: 'ABCD-0001', pollsUntilComplete: 1 },
    close: async () => {},
  }
  let polls = 0
  const server = http.createServer(async (req, res) => {
    const send = (status: number, obj: unknown) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)) }
    const url = req.url ?? ''
    const raw = await body(req)
    const json = raw ? JSON.parse(raw) : {}
    if (AUTH_REQUIRED_ROUTES.has(url) && !isAuthorized(req)) return send(401, { error: 'unauthorized' })
    if (url === '/api/dev/auth/device/start') return send(200, { poll_token: 'poll-1', user_code: f.device.userCode, verification_uri: 'https://github.com/login/device', interval_s: 1, expires_in_s: 900 })
    if (url === '/api/dev/auth/device/poll') {
      polls += 1
      if (f.device.expiresAfterPolls !== undefined && polls >= f.device.expiresAfterPolls) return send(200, { status: 'expired' })
      if (polls < f.device.pollsUntilComplete) return send(200, { status: 'pending' })
      if (f.device.accountClosed) return send(200, { status: 'closed' })
      return send(200, { status: 'complete', api_token: 'api-token-1', developer: f.self })
    }
    if (url === '/api/dev/me') return send(200, f.self)
    if (url === '/api/dev/web-session') {
      f.webSessionAuths.push(req.headers.authorization)
      if (f.webSessionStatus) return send(f.webSessionStatus, { error: f.webSessionStatus === 401 ? 'unauthorized' : 'unavailable' })
      return send(200, { url: `${f.url}/api/dev/web/verify?token=web-token-1`, expires_in_s: 600 })
    }
    if (url === '/api/dev/heartbeat') {
      if (f.heartbeatFailTimes > 0) { f.heartbeatFailTimes -= 1; return send(500, { error: 'unavailable' }) }
      f.heartbeats.push(json)
      return send(200, f.self)
    }
    if (url === '/api/dev/next') {
      f.nextCalls.push(json)
      if (f.nextDelayMs > 0) await delay(f.nextDelayMs)
      if (f.nextFailTimes > 0) { f.nextFailTimes -= 1; return send(500, { error: 'unavailable' }) }
      return send(200, f.nextQueue.shift() ?? { question: null, reason: 'none_available', retry_after_ms: 3000 })
    }
    if (url === '/api/dev/answers') {
      if (f.answerDelayMs > 0) await delay(f.answerDelayMs)
      if (f.failAnswersTimes > 0) { f.failAnswersTimes -= 1; return send(f.answerFailStatus, { error: 'unavailable' }) }
      f.answers.push({ auth: req.headers.authorization, body: json })
      return send(200, f.answerResponder(json))
    }
    if (url === '/api/dev/skips') { f.skips.push(json.assignment_id); res.writeHead(204); return res.end() }
    send(404, { error: 'not_found' })
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  f.url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  f.close = () => new Promise((r) => server.close(() => r()))
  return f
}

export function servedQuestion(over: Partial<NonNullable<NextResponse['question']>> = {}): NonNullable<NextResponse['question']> {
  return {
    assignment_id: '8f0b0f2e-6f6a-4a3a-9c1f-0f1e2d3c4b5a', kind: 'choice', text: 'Which tagline?',
    // Kept short enough that the composed status line ("tickover · Acme DB · $0.50 · Which
    // tagline? 1 Postgres, faster  2 Cached DB", 76 columns) fits whole on a normal terminal, so
    // tests pin the composed format rather than a budgeted one. It does NOT fit the 80-column
    // fallback minus its safety margin (74) — callers wanting the whole line pass cols (R22).
    options: ['Postgres, faster', 'Cached DB'], context: null, sponsor: 'Acme DB', price_cents: 50,
    served_at: '2026-09-10T10:00:00.000Z', expires_at: '2026-09-10T10:10:00.000Z', ...over,
  }
}
