import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { startFakeServer, type FakeServer } from '../helpers/fake-server.js'
import { assertFreshBundle } from '../helpers/dist.js'

// Runs the BUILT cli, the way a developer's `tickover` does. `--print` keeps it from spawning a
// real browser on the test machine, and is itself the SSH/scripting path (same reasoning as `page`).
function runCli(home: string, args: string[]): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(process.execPath, [resolve('dist/cli.js'), ...args], { env: { ...process.env, TICKOVER_HOME: home } })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (c) => (stdout += c))
    child.stderr.on('data', (c) => (stderr += c))
    child.on('error', reject)
    child.on('exit', (code) => resolvePromise({ code, stdout, stderr }))
  })
}

function makeHome(server: string, apiToken: string | null): string {
  const home = mkdtempSync(join(tmpdir(), 'mw-web-'))
  writeFileSync(join(home, 'config.json'), JSON.stringify({ serverUrl: server, apiToken, installToken: 'install-1', wrappedStatusLine: null, daemonBin: null, transcriptWatch: false, statusLineColumns: null }))
  return home
}

describe('tickover web', () => {
  let f: FakeServer
  beforeAll(async () => { f = await startFakeServer() })
  afterAll(async () => { await f.close() })

  it('prints the login URL the server minted, authenticated as the developer', async () => {
    assertFreshBundle()
    const home = makeHome(f.url, 'api-token-1')
    try {
      const r = await runCli(home, ['web', '--print'])
      expect(r.stderr).toBe('')
      expect(r.code).toBe(0)
      expect(r.stdout.trim()).toBe(`${f.url}/api/dev/web/verify?token=web-token-1`)
      expect(f.webSessionAuths.at(-1)).toBe('Bearer api-token-1')
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  }, 30_000)

  // Without a token the command has nothing to trade, and the developer needs to be told which
  // command fixes that -- not a stack trace out of ServerClient's "not logged in" throw.
  it('says what to run when there is no api token, and asks the server for nothing', async () => {
    const before = f.webSessionAuths.length
    const home = makeHome(f.url, null)
    try {
      const r = await runCli(home, ['web', '--print'])
      expect(r.code).toBe(0)
      expect(r.stdout).toContain('tickover login')
      expect(r.stdout).not.toContain('http')
      expect(f.webSessionAuths.length).toBe(before)
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  }, 30_000)

  // Every other command that touches config.json is listed in NEEDS_HOME; a command left off it
  // dies in writeAtomic's ENOENT the first time anyone runs it on a machine with no ~/.tickover.
  it('works on a machine that has no tickover home yet', async () => {
    const parent = mkdtempSync(join(tmpdir(), 'mw-web-fresh-'))
    const home = join(parent, 'never-created')
    try {
      const r = await runCli(home, ['web', '--print'])
      expect(r.stderr).toBe('')
      expect(r.code).toBe(0)
      expect(r.stdout).toContain('tickover login')
    } finally {
      rmSync(parent, { recursive: true, force: true })
    }
  }, 30_000)

  it('is listed in the usage text', async () => {
    const home = makeHome(f.url, null)
    try {
      expect((await runCli(home, ['help'])).stdout).toContain('web')
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  }, 30_000)
  /**
   * The deferred finding: this command printed a bare `server 401` or `fetch failed` and exited
   * 1. R79 closed the way a developer used to *arrive* at the 401 -- `tickover login` on a
   * deleted account now says the account is closed rather than reporting success -- but the
   * command itself was unchanged, so anyone whose token was revoked got a status code.
   *
   * A 401 here is genuinely ambiguous and the message says so: `deleteDeveloperAccount` nulls
   * `api_token_hash`, so a revoked token and a closed account are the same 401 to this client.
   * Naming `tickover login` is the useful half -- it is the command that distinguishes them,
   * because R79 makes it answer "closed" in the second case.
   */
  it('says what a refused token means and what to run, not "server 401"', async () => {
    const home = makeHome(f.url, 'api-token-1')
    f.webSessionStatus = 401
    try {
      const r = await runCli(home, ['web', '--print'])
      expect(r.code, 'a refused login exits 0, so a script cannot tell').not.toBe(0)
      const said = r.stdout + r.stderr
      expect(said, 'the raw status is all the developer is told').not.toContain('server 401')
      expect(said).toContain('tickover login')
      expect(said, 'a closed account is not offered as the other reading').toContain('closed')
      expect(said).not.toContain('http://')
    } finally {
      f.webSessionStatus = 0
      rmSync(home, { recursive: true, force: true })
    }
  }, 30_000)

  // A 5xx is ours, not theirs. Telling them to log in again would send them to re-run a device
  // flow against a server that is already failing, and re-authenticating fixes nothing.
  it('does not blame the developer for a server-side failure', async () => {
    const home = makeHome(f.url, 'api-token-1')
    f.webSessionStatus = 503
    try {
      const r = await runCli(home, ['web', '--print'])
      expect(r.code).not.toBe(0)
      const said = r.stdout + r.stderr
      expect(said).not.toContain('server 503')
      expect(said, 'a server fault is reported as a login problem').not.toContain('tickover login')
      expect(said.toLowerCase()).toContain('try again')
    } finally {
      f.webSessionStatus = 0
      rmSync(home, { recursive: true, force: true })
    }
  }, 30_000)

  // Reachable: `@fastify/rate-limit` is registered on the whole app, so this endpoint
  // answers 429 like any other. It is the one refusal that is neither the developer's
  // fault nor a fault at all, and "run tickover login" would be wrong twice over.
  it('tells a rate-limited developer to wait rather than to log in again', async () => {
    const home = makeHome(f.url, 'api-token-1')
    f.webSessionStatus = 429
    try {
      const r = await runCli(home, ['web', '--print'])
      expect(r.code).not.toBe(0)
      const said = r.stdout + r.stderr
      expect(said).not.toContain('server 429')
      expect(said, 'a rate limit is reported as a login problem').not.toContain('tickover login')
      expect(said.toLowerCase()).toContain('wait')
    } finally {
      f.webSessionStatus = 0
      rmSync(home, { recursive: true, force: true })
    }
  }, 30_000)

  /**
   * `fetch failed` is what Node says and it names nothing. The server URL is the one piece of
   * state that explains it, it comes only from config.json (deliberately -- there is no
   * environment variable), and a developer who has never opened that file has no way to guess
   * that is where to look.
   */
  it('names the server it could not reach, and where that address comes from', async () => {
    // Port 1 is reserved and nothing binds it, so this is a connection refusal rather than a
    // DNS failure -- the shape a developer behind a proxy or with the server down actually gets.
    const home = makeHome('http://127.0.0.1:1', 'api-token-1')
    try {
      const r = await runCli(home, ['web', '--print'])
      expect(r.code).not.toBe(0)
      const said = r.stdout + r.stderr
      expect(said).not.toContain('fetch failed')
      expect(said).toContain('http://127.0.0.1:1')
      expect(said, 'nothing says where the address is configured').toContain('config.json')
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  }, 30_000)
})
