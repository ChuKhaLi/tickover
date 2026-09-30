import { paths } from './paths.js'
import { readConfig, writeConfig } from './config.js'
import { z } from 'zod'
import { ServerError, type ServerClient } from './server-client.js'
import type { QuestionLoop } from './question-loop.js'
import type { Log } from './log.js'
import type { LoginStart, LoginStatus } from './http.js'
import { ensureDaemon } from './launch.js'

const DEVICE_GRANT = 'urn:ietf:params:oauth:grant-type:device_code'

/**
 * The GitHub device flow, run from this machine (spec: "GitHub device flow from the daemon"; R710).
 *
 * GitHub's Authorize page tells the developer where the device-code request came from. When the
 * Tickover server made it, that was the server's own address -- reported 2026-09-30 as "requested
 * from Singapore 51.79.220.245" -- on every developer's screen. Made here, it is the developer's
 * own. The server names the client id (public for device flow), and only ever sees the finished
 * GitHub token, once, to exchange it for a Tickover api token. The GitHub token is never written.
 */
// GitHub's answers are checked, not cast: a 200 carrying an error body read as a device code once
// relayed "Open undefined and enter the code: undefined" (R706's bug by another road; review Minor).
const DeviceCode = z.object({
  device_code: z.string().min(1),
  user_code: z.string().min(1),
  verification_uri: z.string().url(),
  interval: z.number().int().positive(),
  expires_in: z.number().int().positive(),
})
const TokenPoll = z.object({ access_token: z.string().min(1).optional(), error: z.string().optional(), interval: z.number().int().positive().optional() })

interface Flow { deviceCode: string; start: LoginStart; expiresAt: number; intervalS: number }

export class LoginFlow {
  private clientId = ''
  private flow: Flow | null = null
  // Held in memory, never written, from the moment GitHub hands it over until the server has
  // exchanged it: dropping it before the exchange meant one failed exchange lost a login the
  // developer had already authorized, with the device code already spent (review I1).
  private githubToken: string | null = null
  private checking: Promise<LoginStatus> | null = null
  constructor(private server: ServerClient, private home: string, private loop: QuestionLoop, private log: Log, private githubUrl = 'https://github.com', private fetchFn: typeof fetch = fetch, private clock: () => Date = () => new Date()) {}

  private async github(path: string, form: Record<string, string>): Promise<unknown> {
    const res = await this.fetchFn(`${this.githubUrl}${path}`, {
      method: 'POST',
      headers: { accept: 'application/json', 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(form).toString(),
      signal: AbortSignal.timeout(10_000),
    })
    if (!res.ok) throw new Error(`github ${path} ${res.status}`)
    return res.json()
  }

  async start(): Promise<LoginStart> {
    // A second `tickover login` while one is in flight gets the same code: asking GitHub for another
    // left the first CLI polling a code its developer never saw (review Minor).
    if (this.flow && this.clock().getTime() < this.flow.expiresAt) return this.flow.start
    this.clientId = (await this.server.authConfig()).github_client_id
    const answer = await this.github('/login/device/code', { client_id: this.clientId, scope: '' })
    const parsed = DeviceCode.safeParse(answer)
    if (!parsed.success) {
      const error = (answer as { error?: unknown } | null)?.error
      throw new Error(`github did not start a device flow${typeof error === 'string' ? `: ${error}` : ''}`)
    }
    const s = parsed.data
    const start = { user_code: s.user_code, verification_uri: s.verification_uri, interval_s: s.interval }
    // A token still held from an earlier flow is kept: status() tries it first, so a developer who
    // already authorized is not sent back to GitHub by a re-run (re-review N3).
    this.flow = { deviceCode: s.device_code, start, expiresAt: this.clock().getTime() + s.expires_in * 1000, intervalS: s.interval }
    return start
  }

  // One status check at a time, for every CLI sharing this flow: two concurrent polls could both
  // reach the exchange, and since the server rotates the api token on each exchange the one written
  // last could be the one it had already replaced (re-review N1); and GitHub hands a device code's
  // token out once, so a second concurrent GitHub poll gets an error for a login that just
  // succeeded. A check arriving mid-flight waits for that check's answer.
  status(): Promise<LoginStatus> {
    return (this.checking ??= this.checkOnce().finally(() => { this.checking = null }))
  }

  private async checkOnce(): Promise<LoginStatus> {
    if (this.githubToken) return this.exchange()
    const flow = this.flow
    if (!flow) return { status: 'idle' }
    const r = TokenPoll.safeParse(await this.github('/login/oauth/access_token', { client_id: this.clientId, device_code: flow.deviceCode, grant_type: DEVICE_GRANT }))
    if (!r.success) throw new Error('github answered the token poll with something else')
    if (r.data.access_token) {
      this.githubToken = r.data.access_token
      this.flow = null
      return this.exchange()
    }
    const error = r.data.error ?? 'no_token'
    if (error === 'authorization_pending') return { status: 'pending', interval_s: flow.intervalS }
    // GitHub's rule: each slow_down adds 5 seconds (it may say the new interval itself), for the
    // rest of this flow. The CLI sleeps whatever interval the last status carried.
    if (error === 'slow_down') { flow.intervalS = r.data.interval ?? flow.intervalS + 5; return { status: 'pending', interval_s: flow.intervalS } }
    this.flow = null
    if (error === 'expired_token') return { status: 'expired' }
    // Not "the code expired": the developer pressed Cancel, and re-running is their choice to make.
    if (error === 'access_denied') return { status: 'denied' }
    // incorrect_client_credentials, incorrect_device_code, unsupported_grant_type,
    // device_flow_disabled: problems on Tickover's side, which re-running cannot fix.
    return { status: 'failed', reason: error }
  }

  private async exchange(): Promise<LoginStatus> {
    const token = this.githubToken as string
    let done
    try {
      done = await this.server.githubLogin(token)
    } catch (err) {
      // A refusal is final: the server looked at this token and said no. Anything else -- the
      // network, a 5xx, a timeout -- leaves the token here for the next poll to try again.
      // 429 is the rate limiter saying "not now", retried like a 5xx (re-review N2).
      if (err instanceof ServerError && err.status >= 400 && err.status < 500 && err.status !== 429) { this.githubToken = null; return { status: 'failed', reason: `server refused the GitHub token (${err.status})` } }
      throw err
    }
    this.githubToken = null
    // Nothing is written and nothing is cached: there is no token to store and no developer to
    // hand the question loop. The answer will not change on a retry.
    if (done.status === 'closed') return { status: 'closed' }
    writeConfig(this.home, { ...readConfig(this.home), apiToken: done.api_token })
    this.loop.setSelf(done.developer)
    this.log.info('logged in', { login: done.developer.github_login })
    return { status: 'complete', github_login: done.developer.github_login }
  }
}

export async function runLoginCli(home: string, io: { out: (s: string) => void; sleep: (ms: number) => Promise<void>; fetchFn?: typeof fetch; cliPath?: string }): Promise<void> {
  const f = io.fetchFn ?? fetch
  const info = await ensureDaemon(home, { fetchFn: f, cliPath: io.cliPath })
  const headers = { 'x-tickover-token': info.token, 'content-type': 'application/json' }
  const base = `http://127.0.0.1:${info.port}`
  // A daemon still holding a token from a login that could not finish exchanges it here, so a
  // developer who already authorized is not handed a new code to enter (re-review N3). Anything but
  // a completed login -- idle, pending, a failed exchange -- carries on to a normal start.
  const held = await f(`${base}/v1/login/status`, { headers })
  if (held.ok) {
    const s = (await held.json()) as LoginStatus
    if (s.status === 'complete') { io.out(`Logged in as ${s.github_login}. Questions will appear while Claude works.`); return }
  }
  const startRes = await f(`${base}/v1/login/start`, { method: 'POST', headers })
  // The daemon answers 500 when it cannot reach the server (offline, server down). Reading that
  // body as a LoginStart relayed "Open undefined and enter the code: undefined", then slept NaN ms
  // 200 times and blamed GitHub for a timeout. Thrown for the same reason as 'closed' below: a
  // non-zero exit is what stops `/tickover:setup` before it rewrites settings.json.
  if (!startRes.ok) throw new Error(`Could not start a login: the Tickover server or GitHub did not answer (daemon log: ${paths(home).log}). Check your connection and run tickover login again.`)
  const start = (await startRes.json()) as LoginStart
  io.out(`Open ${start.verification_uri} and enter the code: ${start.user_code}`)
  // The interval can grow mid-flow (GitHub's slow_down), so each pending status carries it. An
  // older daemon's pending carries none; keep the last good one rather than sleep NaN in a hot loop.
  let intervalS = start.interval_s
  // Consecutive answers from the daemon that were not a status at all: after the developer has
  // authorized, that is the exchange with the server failing, retried on each poll (review I1).
  let failures = 0
  for (let i = 0; i < 200; i++) {
    await io.sleep(intervalS * 1000)
    const res = await f(`${base}/v1/login/status`, { headers })
    if (!res.ok) {
      if (++failures >= 3) throw new Error(`Could not finish the login: the Tickover server or GitHub did not answer (daemon log: ${paths(home).log}). Run tickover login again.`)
      continue
    }
    failures = 0
    const s = (await res.json()) as LoginStatus
    if (s.status === 'pending' && typeof s.interval_s === 'number' && s.interval_s > 0) intervalS = s.interval_s
    if (s.status === 'complete') { io.out(`Logged in as ${s.github_login}. Questions will appear while Claude works.`); return }
    if (s.status === 'expired') { io.out('The code expired. Run tickover login again.'); return }
    // These three are thrown -- stderr, exit 1 -- for the reason 'closed' below explains: nobody is
    // logged in, and setup must stop before it changes the developer's settings.
    if (s.status === 'denied') throw new Error('You declined the authorization on GitHub, so nobody is logged in. Run tickover login again to start over.')
    // Not "GitHub ended the login": the reason may be the Tickover server refusing the token.
    if (s.status === 'failed') throw new Error(`The login was refused (${s.reason}). Running it again will not help; this is a problem on Tickover's side -- please report it.`)
    if (s.status === 'idle') throw new Error('The daemon lost this login, probably because it restarted. Run tickover login again.')
    // Says what happened rather than what to do next, because there is no next: the account was
    // deleted or banned, and re-running this command cannot change that. The wording matches the
    // web settings page's own bullet, which is where a developer read it before deleting.
    //
    // Thrown rather than printed, so `main()` sends it to stderr and exits 1. The exit code is
    // load-bearing: `skills/setup/SKILL.md` runs this at step 4 and rewrites the developer's
    // `~/.claude/settings.json` at step 5, so a zero exit let a deleted developer sail past a
    // failed login into that rewrite and find out at step 6. Printing and returning 0 would be the
    // same silent failure this whole ruling exists to close, moved one layer out.
    if (s.status === 'closed') throw new Error('This GitHub account cannot be used with Tickover. If you deleted your account, that is permanent.')
  }
  io.out('Timed out waiting for GitHub. Run tickover login again.')
}
