import http, { type IncomingMessage, type ServerResponse } from 'node:http'
import { timingSafeEqual } from 'node:crypto'
import { z } from 'zod'
import { AnswerSource, type ServedQuestion } from '@tickover/contract'
import type { Log } from './log.js'
import type { SseHub } from './events.js'
import { renderPage } from './page.js'
import type { BandView } from './band.js'

// The local API must not accept wider than the wire schema it feeds. `session_id` was max(200)
// against NextRequest's max(100): a session id in that gap was tracked happily here and then made
// every /api/dev/next 400 forever, with no recovery and no signal (whole-branch review, Minor).
// Refusing the hook is the honest outcome -- the daemon declines to track a session it could never
// serve a question to, rather than pretending and failing silently every two seconds.
export const HookEvent = z.object({
  event: z.enum(['SessionStart', 'UserPromptSubmit', 'Stop', 'SessionEnd']),
  session_id: z.string().min(1).max(100),
  cwd: z.string().max(4096).optional(),
  tool: z.literal('claude-code').default('claude-code'),
  tool_version: z.string().max(40).optional(),
})
export type HookEvent = z.infer<typeof HookEvent>

/** Matches HeartbeatRequest.tool_version's own max. */
const TOOL_VERSION_MAX = 40

export const AnswerInput = z.object({ assignment_id: z.string().uuid(), option_index: z.number().int().min(0).max(4), source: AnswerSource })
export const SkipInput = z.object({ assignment_id: z.string().uuid() })

export interface QuestionView { question: ServedQuestion | null; shown_at: string | null; balance_pending_cents: number; balance_available_cents: number; today_paid_answers: number; logged_in: boolean }
export interface AnswerOutcome { accepted: boolean; reason: string; earned_cents: number }
// `queuedAnswers` is answers already given by the developer but not yet accepted by the server.
// Surfaced because `~/.tickover` holds the only copy: the uninstall skill deletes that directory,
// and anything still queued when it does is money that will never be paid. A developer (or the
// skill) needs a way to see the count before deleting.
export interface HealthView { ok: true; version: string; loggedIn: boolean; sessions: number; activeTurn: boolean; queuedAnswers: number }
export interface LoginStart { user_code: string; verification_uri: string; interval_s: number }
// 'closed' mirrors the server's refusal of the token exchange (R79): GitHub authorized, and the
// Tickover account behind that GitHub id is deleted or banned. It is not 'expired' -- nothing
// here expires, and telling the developer to run `tickover login` again would be a loop.
// 'denied' is the developer pressing Cancel on GitHub; 'failed' is GitHub or the server ending the
// flow for a reason re-running cannot fix (R710 review). Both stop setup, like 'closed'.
export type LoginStatus = { status: 'pending'; interval_s: number } | { status: 'complete'; github_login: string } | { status: 'expired' } | { status: 'closed' } | { status: 'denied' } | { status: 'failed'; reason: string } | { status: 'idle' }

export interface LocalHandlers {
  hook(e: HookEvent): void
  status(sessionId: string | null, version?: string | null, cols?: number | null): string
  band(sessionId: string | null, drawn: string | null): BandView
  question(): QuestionView
  answer(input: { assignmentId: string; optionIndex: number; source: AnswerSource }): Promise<AnswerOutcome>
  skip(assignmentId: string): Promise<boolean>
  health(): HealthView
  loginStart(): Promise<LoginStart>
  loginStatus(): Promise<LoginStatus>
}

export interface LocalContext {
  token: string
  port: () => number
  clock: () => Date
  log: Log
  hub: SseHub
  handlers: LocalHandlers
}

const BODY_MAX_BYTES = 65_536
const BODY_READ_TIMEOUT_MS = 5_000

class BodyTooLargeError extends Error {}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = ''
    let settled = false
    // A client that opens a request and never sends `end` (or drips data slower than we can
    // wait) must not park this handler forever — that would keep the server from ever closing.
    const timer = setTimeout(() => { settle(() => reject(new Error('body read timed out'))); req.destroy() }, BODY_READ_TIMEOUT_MS)
    function settle(fn: () => void): void {
      if (settled) return
      settled = true
      clearTimeout(timer)
      fn()
    }
    req.setEncoding('utf8')
    req.on('data', (c: string) => {
      // Once settled (over-size, or a prior error), stop buffering but keep draining the
      // stream — destroying the socket mid-upload would reset the connection before the client
      // can read our 413, since it may still be writing the request body.
      if (settled) return
      data += c
      if (data.length > BODY_MAX_BYTES) settle(() => reject(new BodyTooLargeError('body too large')))
    })
    req.on('end', () => settle(() => resolve(data)))
    req.on('error', (err) => settle(() => reject(err)))
  })
}

/** Reads and validates a JSON body, writing the appropriate error response itself on failure. */
async function readJsonBody<T>(req: IncomingMessage, res: ServerResponse, schema: z.ZodType<T, z.ZodTypeDef, unknown>): Promise<T | undefined> {
  let raw: string
  try {
    raw = await readBody(req)
  } catch (err) {
    if (err instanceof BodyTooLargeError) { json(res, 413, { error: 'payload_too_large' }); return undefined }
    throw err
  }
  let parsedJson: unknown
  try {
    parsedJson = raw ? JSON.parse(raw) : {}
  } catch {
    json(res, 400, { error: 'invalid_json' })
    return undefined
  }
  const result = schema.safeParse(parsedJson)
  if (!result.success) { json(res, 400, { error: 'validation' }); return undefined }
  return result.data
}

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json' })
  res.end(JSON.stringify(body))
}

function cookies(req: IncomingMessage): Record<string, string> {
  const out: Record<string, string> = {}
  for (const part of (req.headers.cookie ?? '').split(';')) {
    const i = part.indexOf('=')
    if (i <= 0) continue
    try {
      out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim())
    } catch {
      // A malformed percent-encoding must not 500 the whole request; just ignore that cookie.
    }
  }
  return out
}

function firstHeader(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v
}

/** Constant-time token comparison — free on a gate this important, even though loopback-only
 * traffic makes timing attacks impractical in practice. */
function tokenEquals(candidate: string | null | undefined, expected: string): boolean {
  if (!candidate) return false
  const a = Buffer.from(candidate)
  const b = Buffer.from(expected)
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}

/** The one place that decides whether a request is authorized: header token, or the cookie set
 * by the `/?t=` login redirect. Every route (including `/`) goes through this. */
function isAuthorized(req: IncomingMessage, token: string): boolean {
  return tokenEquals(firstHeader(req.headers['x-tickover-token']), token) || tokenEquals(cookies(req).mw_daemon, token)
}

export function createLocalServer(ctx: LocalContext): http.Server {
  return http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1')
      const host = req.headers.host ?? ''
      const allowed = new Set([`127.0.0.1:${ctx.port()}`, `localhost:${ctx.port()}`])
      if (!allowed.has(host)) return json(res, 421, { error: 'misdirected' })

      if (req.method === 'GET' && url.pathname === '/') {
        const t = url.searchParams.get('t')
        if (tokenEquals(t, ctx.token)) {
          res.writeHead(302, { 'set-cookie': `mw_daemon=${encodeURIComponent(t!)}; Path=/; HttpOnly; SameSite=Strict`, location: '/' })
          return res.end()
        }
        if (!isAuthorized(req, ctx.token)) return json(res, 401, { error: 'unauthorized' })
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
        return res.end(renderPage())
      }

      if (!isAuthorized(req, ctx.token)) return json(res, 401, { error: 'unauthorized' })
      const h = ctx.handlers

      if (req.method === 'GET' && url.pathname === '/v1/health') return json(res, 200, h.health())
      if (req.method === 'GET' && url.pathname === '/v1/status') {
        // An over-long `version` is dropped rather than truncated or recorded: it goes straight
        // into the heartbeat's `tool_version`, which the wire schema caps at 40, so recording one
        // would 400 every heartbeat from then on with no recovery. Dropping it leaves the last
        // known version (or 'unknown') in place, which is honest -- a truncated version string
        // would be a value the daemon made up. `session_id` needs no cap here: it is only ever
        // used to look up a session already admitted through the (capped) hook schema above, so
        // an over-long one simply matches nothing.
        const version = url.searchParams.get('version')
        // `cols` is the terminal width the status line script read from COLUMNS. Number() rather
        // than parseInt: parseInt('1e9') is 1, which would silently become a 14-column budget and
        // a status line that looks broken. Everything else -- NaN, <= 0, absurd magnitudes -- is
        // rejected or clamped by resolveColumns, so the range lives in exactly one place.
        const colsRaw = url.searchParams.get('cols')
        return json(res, 200, { line: h.status(url.searchParams.get('session_id'), version && version.length <= TOOL_VERSION_MAX ? version : null, colsRaw === null ? null : Number(colsRaw)) })
      }
      if (req.method === 'GET' && url.pathname === '/v1/band') {
        return json(res, 200, h.band(url.searchParams.get('session_id'), url.searchParams.get('drawn')))
      }
      if (req.method === 'GET' && url.pathname === '/v1/question') return json(res, 200, h.question())
      if (req.method === 'GET' && url.pathname === '/v1/events') {
        ctx.hub.subscribe(res)
        res.write(`event: status\ndata: ${JSON.stringify(h.question())}\n\n`)
        return
      }
      if (req.method === 'POST' && url.pathname === '/v1/hook') {
        const data = await readJsonBody(req, res, HookEvent)
        if (data === undefined) return
        h.hook(data)
        res.writeHead(204); return res.end()
      }
      if (req.method === 'POST' && url.pathname === '/v1/answer') {
        const data = await readJsonBody(req, res, AnswerInput)
        if (data === undefined) return
        return json(res, 200, await h.answer({ assignmentId: data.assignment_id, optionIndex: data.option_index, source: data.source }))
      }
      if (req.method === 'POST' && url.pathname === '/v1/skip') {
        const data = await readJsonBody(req, res, SkipInput)
        if (data === undefined) return
        const ok = await h.skip(data.assignment_id)
        res.writeHead(ok ? 204 : 404); return res.end()
      }
      if (req.method === 'POST' && url.pathname === '/v1/login/start') return json(res, 200, await h.loginStart())
      if (req.method === 'GET' && url.pathname === '/v1/login/status') return json(res, 200, await h.loginStatus())
      return json(res, 404, { error: 'not_found' })
    } catch (err) {
      ctx.log.error('http', { message: (err as Error).message })
      // A body-read timeout destroys the socket to reclaim the handler, which can make the
      // response itself unwritable — never let reporting the error throw a second one.
      try {
        if (!res.headersSent && !res.destroyed) json(res, 500, { error: 'internal' })
        else if (!res.writableEnded) res.end()
      } catch { /* socket already gone */ }
    }
  })
}
