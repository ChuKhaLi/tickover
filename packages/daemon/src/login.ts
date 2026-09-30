import { paths } from './paths.js'
import { readConfig, writeConfig } from './config.js'
import type { ServerClient } from './server-client.js'
import type { QuestionLoop } from './question-loop.js'
import type { Log } from './log.js'
import type { LoginStart, LoginStatus } from './http.js'
import { ensureDaemon } from './launch.js'

export class LoginFlow {
  private pollToken: string | null = null
  private intervalS = 5
  constructor(private server: ServerClient, private home: string, private loop: QuestionLoop, private log: Log) {}

  async start(): Promise<LoginStart> {
    const s = await this.server.deviceStart()
    this.pollToken = s.poll_token
    this.intervalS = s.interval_s
    return { user_code: s.user_code, verification_uri: s.verification_uri, interval_s: s.interval_s }
  }

  async status(): Promise<LoginStatus> {
    if (!this.pollToken) return { status: 'idle' }
    const r = await this.server.devicePoll(this.pollToken)
    if (r.status === 'pending') return { status: 'pending' }
    if (r.status === 'expired') { this.pollToken = null; return { status: 'expired' } }
    // Nothing is written and nothing is cached: there is no token to store and no developer to
    // hand the question loop. Polling stops here -- the answer will not change on a retry.
    if (r.status === 'closed') { this.pollToken = null; return { status: 'closed' } }
    writeConfig(this.home, { ...readConfig(this.home), apiToken: r.api_token })
    this.loop.setSelf(r.developer)
    this.pollToken = null
    this.log.info('logged in', { login: r.developer.github_login })
    return { status: 'complete', github_login: r.developer.github_login }
  }
}

export async function runLoginCli(home: string, io: { out: (s: string) => void; sleep: (ms: number) => Promise<void>; fetchFn?: typeof fetch; cliPath?: string }): Promise<void> {
  const f = io.fetchFn ?? fetch
  const info = await ensureDaemon(home, { fetchFn: f, cliPath: io.cliPath })
  const headers = { 'x-tickover-token': info.token, 'content-type': 'application/json' }
  const base = `http://127.0.0.1:${info.port}`
  const startRes = await f(`${base}/v1/login/start`, { method: 'POST', headers })
  // The daemon answers 500 when it cannot reach the server (offline, server down). Reading that
  // body as a LoginStart relayed "Open undefined and enter the code: undefined", then slept NaN ms
  // 200 times and blamed GitHub for a timeout. Thrown for the same reason as 'closed' below: a
  // non-zero exit is what stops `/tickover:setup` before it rewrites settings.json.
  if (!startRes.ok) throw new Error(`Could not start a login: the Tickover server did not answer (daemon log: ${paths(home).log}). Check your connection and run tickover login again.`)
  const start = (await startRes.json()) as LoginStart
  io.out(`Open ${start.verification_uri} and enter the code: ${start.user_code}`)
  for (let i = 0; i < 200; i++) {
    await io.sleep(start.interval_s * 1000)
    const s = (await (await f(`${base}/v1/login/status`, { headers })).json()) as LoginStatus
    if (s.status === 'complete') { io.out(`Logged in as ${s.github_login}. Questions will appear while Claude works.`); return }
    if (s.status === 'expired') { io.out('The code expired. Run tickover login again.'); return }
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
