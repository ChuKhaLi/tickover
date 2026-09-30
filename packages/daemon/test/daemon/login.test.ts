import { describe, it, expect } from 'vitest'
import { spawn } from 'node:child_process'
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { startTestDaemon } from '../helpers/daemon.js'
import { assertFreshBundle } from '../helpers/dist.js'
import { readConfig } from '../../src/config.js'
import { runLoginCli, LoginFlow } from '../../src/login.js'

describe('login', () => {
  it('runs the device flow through the daemon and stores the api token', async () => {
    const t = await startTestDaemon({ loggedOut: true })
    t.fake.device.pollsUntilComplete = 2
    const out: string[] = []
    await runLoginCli(t.home, { out: (s) => out.push(s), sleep: async () => {} })
    expect(out.join('\n')).toContain('ABCD-0001')
    expect(out.join('\n')).toContain('https://github.com/login/device')
    expect(out.join('\n')).toContain('Logged in as octo')
    expect(readConfig(t.home).apiToken).toBe('api-token-1')
    expect(await (await fetch(`${t.base}/v1/health`, { headers: t.headers })).json()).toMatchObject({ loggedIn: true })
    await t.stop()
  })

  // R710. GitHub's Authorize page names the address that asked for the device code. While the server
  // asked, every developer was shown the server's own address (reported 2026-09-30: "requested from
  // Singapore 51.79.220.245"); asked from here, it is the developer's own. So: the code request
  // leaves this machine, with the client id the server names, and the server only ever sees the
  // finished token -- once, never stored on disk.
  it('asks GitHub for the device code from this machine, and hands the server only the finished token', async () => {
    const t = await startTestDaemon({ loggedOut: true })
    t.fake.device.pollsUntilComplete = 2
    const out: string[] = []
    await runLoginCli(t.home, { out: (s) => out.push(s), sleep: async () => {} })
    expect(out.join('\n')).toContain('Logged in as octo')
    expect(t.fake.github.codeRequests).toEqual(['fake-client-id'])
    expect(t.fake.github.logins).toEqual(['gho_fake_1'])
    expect(t.fake.serverDeviceCalls).toBe(0)
    expect(readFileSync(join(t.home, 'config.json'), 'utf8')).not.toContain('gho_fake_1')
    await t.stop()
  })

  // GitHub's device flow answers a too-fast poll with slow_down, and each one adds 5 seconds to the
  // interval the client must keep from then on. The CLI sleeps whatever the daemon last reported.
  it('slows down by 5 seconds each time GitHub asks it to', async () => {
    const t = await startTestDaemon({ loggedOut: true })
    t.fake.device.pollsUntilComplete = 4
    t.fake.device.slowDownAtPolls = [1, 2]
    const sleeps: number[] = []
    await runLoginCli(t.home, { out: () => {}, sleep: async (ms) => { sleeps.push(ms) } })
    expect(sleeps).toEqual([1000, 6000, 11000, 11000])
    expect(readConfig(t.home).apiToken).toBe('api-token-1')
    await t.stop()
  })

  // Whole-branch review (R710) I1: the device code was dropped before the exchange, so one failed
  // exchange -- a network blip, a server 5xx -- lost a login the developer had already authorized,
  // and the CLI then sat out 200 polls in silence and blamed GitHub with exit 0.
  it('keeps the authorized token through a failed exchange and finishes on the next poll', async () => {
    const t = await startTestDaemon({ loggedOut: true })
    t.fake.device.exchangeFailTimes = 1
    const out: string[] = []
    await runLoginCli(t.home, { out: (s) => out.push(s), sleep: async () => {} })
    expect(out.join('\n')).toContain('Logged in as octo')
    expect(t.fake.github.logins).toEqual(['gho_fake_1', 'gho_fake_1'])
    await t.stop()
  })

  it('fails, exit non-zero, when the exchange keeps failing', async () => {
    const t = await startTestDaemon({ loggedOut: true })
    t.fake.device.exchangeFailTimes = 1000
    const sleeps: number[] = []
    await expect(runLoginCli(t.home, { out: () => {}, sleep: async (ms) => { sleeps.push(ms) } })).rejects.toThrow('Could not finish the login')
    expect(sleeps.length).toBeLessThan(10)
    expect(readConfig(t.home).apiToken).toBeNull()
    await t.stop()
  })

  // Re-review N1, reproduced: two CLIs sharing one flow could both exchange the token. The server
  // rotates the api token on each exchange, so config.json could keep the one it had already
  // replaced -- loggedIn: true, and every call a 401 (R79's failure class).
  it('exchanges the token once when two logins share a flow', async () => {
    const t = await startTestDaemon({ loggedOut: true })
    t.fake.device.exchangeDelayMs = 300
    const outs: string[][] = [[], []]
    await Promise.all([0, 1].map((i) => runLoginCli(t.home, { out: (s) => outs[i]!.push(s), sleep: async () => {} })))
    // Both are told the truth: one login, finished -- not "the code expired" for whichever polled
    // GitHub second, after the code's one token had been handed out.
    for (const out of outs) expect(out.join('\n')).toContain('Logged in as octo')
    expect(t.fake.github.logins).toHaveLength(1)
    expect(readConfig(t.home).apiToken).toBe(t.fake.github.lastIssued)
    await t.stop()
  })

  // Re-review N2: a 429 from the server's rate limiter is a "not now", like a 5xx -- not a refusal
  // that drops the token the developer authorized and calls it a Tickover-side problem.
  it('retries the exchange after a 429', async () => {
    const t = await startTestDaemon({ loggedOut: true })
    t.fake.device.exchangeFailTimes = 1
    t.fake.device.exchangeFailStatus = 429
    const out: string[] = []
    await runLoginCli(t.home, { out: (s) => out.push(s), sleep: async () => {} })
    expect(out.join('\n')).toContain('Logged in as octo')
    await t.stop()
  })

  // Re-review N3: after "Could not finish the login" the daemon still holds the token the developer
  // authorized; a re-run started a new device flow and threw it away, sending them back to GitHub.
  it('finishes with the token it already holds when login is run again', async () => {
    const t = await startTestDaemon({ loggedOut: true })
    t.fake.device.exchangeFailTimes = 3
    await expect(runLoginCli(t.home, { out: () => {}, sleep: async () => {} })).rejects.toThrow('Could not finish the login')
    const out: string[] = []
    await runLoginCli(t.home, { out: (s) => out.push(s), sleep: async () => {} })
    expect(out.join('\n')).toContain('Logged in as octo')
    expect(out.join('\n')).not.toContain('enter the code')
    expect(t.fake.github.codeRequests).toHaveLength(1)
    await t.stop()
  })

  // A refusal is final, unlike a failure: retrying a token the server has looked at and refused
  // would only spend the CLI's patience on the same answer.
  it('stops at once, exit non-zero, when the server refuses the token', async () => {
    const t = await startTestDaemon({ loggedOut: true })
    t.fake.device.exchangeRefuse = 403
    await expect(runLoginCli(t.home, { out: () => {}, sleep: async () => {} })).rejects.toThrow('server refused the GitHub token (403)')
    expect(t.fake.github.logins).toHaveLength(1)
    await t.stop()
  })

  // A daemon that restarted mid-login has no flow to poll and answers idle; the CLI used to loop on
  // that until its 200 polls ran out and then blame GitHub with exit 0.
  it('says the daemon lost the login, exit non-zero, when it answers idle', async () => {
    const home = mkdtempSync(join(tmpdir(), 'mw-idle-daemon-'))
    const d = http.createServer((req, res) => {
      const send = (o: unknown) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(o)) }
      if (req.url === '/v1/health') return send({ ok: true })
      if (req.url === '/v1/login/start') return send({ user_code: 'IDLE-0001', verification_uri: 'https://github.com/login/device', interval_s: 1 })
      return send({ status: 'idle' })
    })
    await new Promise<void>((r) => d.listen(0, '127.0.0.1', r))
    writeFileSync(join(home, 'daemon.json'), JSON.stringify({ port: (d.address() as AddressInfo).port, token: 't', pid: process.pid, startedAt: '' }))
    const sleeps: number[] = []
    try {
      await expect(runLoginCli(home, { out: () => {}, sleep: async (ms) => { sleeps.push(ms) } })).rejects.toThrow('lost this login')
      expect(sleeps).toHaveLength(1)
    } finally {
      await new Promise<void>((r) => d.close(() => r()))
      rmSync(home, { recursive: true, force: true })
    }
  })

  // Review, Minor: an error body with a 200 from GitHub's device-code endpoint brought back
  // "Open undefined and enter the code: undefined" (the 2026-09-29 bug, R706) by a new road.
  it('refuses a device-code answer that is not one', async () => {
    const t = await startTestDaemon({ loggedOut: true })
    t.fake.device.codeBody = { error: 'device_flow_disabled' }
    const out: string[] = []
    await expect(runLoginCli(t.home, { out: (s) => out.push(s), sleep: async () => {} })).rejects.toThrow('Could not start a login')
    expect(out.join('\n')).not.toContain('undefined')
    await t.stop()
  })

  // Review, Minor: every error GitHub ends a flow with read "The code expired. Run tickover login
  // again." with exit 0 -- including a developer pressing Cancel, and an operator-side problem that
  // re-running can never fix.
  it('says the developer declined, and exits non-zero', async () => {
    const t = await startTestDaemon({ loggedOut: true })
    t.fake.device.finalError = 'access_denied'
    await expect(runLoginCli(t.home, { out: () => {}, sleep: async () => {} })).rejects.toThrow('declined')
    await t.stop()
  })

  it('names what GitHub refused, and exits non-zero', async () => {
    const t = await startTestDaemon({ loggedOut: true })
    t.fake.device.finalError = 'incorrect_client_credentials'
    await expect(runLoginCli(t.home, { out: () => {}, sleep: async () => {} })).rejects.toThrow('incorrect_client_credentials')
    await t.stop()
  })

  // Review, Minor: a second `tickover login` while one is in flight asked GitHub for a second code,
  // and the first CLI then polled a code its developer never saw.
  it('hands a second login the code already in flight', async () => {
    const t = await startTestDaemon({ loggedOut: true })
    const start = () => fetch(`${t.base}/v1/login/start`, { method: 'POST', headers: t.headers }).then((r) => r.json())
    const [a, b] = [await start(), await start()]
    expect(b.user_code).toBe(a.user_code)
    expect(t.fake.github.codeRequests).toHaveLength(1)
    await t.stop()
  })

  // Review, Minor: every other test injects githubUrl, so the shipped default was held by nothing --
  // pointing it anywhere else left the whole suite green.
  it('talks to github.com unless told otherwise', async () => {
    const urls: string[] = []
    const fetchFn = (async (url: string | URL | Request) => { urls.push(String(url)); return new Response(JSON.stringify({ error: 'stop here' }), { status: 200 }) }) as typeof fetch
    const server = { authConfig: async () => ({ github_client_id: 'x' }) } as unknown as ConstructorParameters<typeof LoginFlow>[0]
    await expect(new LoginFlow(server, '', {} as never, {} as never, undefined, fetchFn).start()).rejects.toThrow('github did not start a device flow: stop here')
    expect(urls).toEqual(['https://github.com/login/device/code'])
  })

  // Review, Minor: an older daemon's pending carries no interval_s, and the CLI slept NaN -- a hot
  // loop -- while the versions were mixed.
  it('keeps its interval when a daemon reports pending without one', async () => {
    const home = mkdtempSync(join(tmpdir(), 'mw-old-daemon-'))
    let polls = 0
    let started = false
    const old = http.createServer((req, res) => {
      const send = (o: unknown) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(o)) }
      if (req.url === '/v1/health') return send({ ok: true })
      if (req.url === '/v1/login/start') { started = true; return send({ user_code: 'OLD-0001', verification_uri: 'https://github.com/login/device', interval_s: 2 }) }
      // The CLI's check for a held token, before start: nothing held.
      if (!started) return send({ status: 'idle' })
      polls += 1
      return send(polls < 3 ? { status: 'pending' } : { status: 'complete', github_login: 'octo' })
    })
    await new Promise<void>((r) => old.listen(0, '127.0.0.1', r))
    writeFileSync(join(home, 'daemon.json'), JSON.stringify({ port: (old.address() as AddressInfo).port, token: 't', pid: process.pid, startedAt: '' }))
    const sleeps: number[] = []
    try {
      await runLoginCli(home, { out: () => {}, sleep: async (ms) => { sleeps.push(ms) } })
      expect(sleeps).toEqual([2000, 2000, 2000])
    } finally {
      await new Promise<void>((r) => old.close(() => r()))
      rmSync(home, { recursive: true, force: true })
    }
  })

  it('reports GitHub\'s expired code and never writes a token (LoginFlow.status and runLoginCli both)', async () => {
    const t = await startTestDaemon({ loggedOut: true })
    // Drives GitHub's actual expired_token answer (the fake plays GitHub, R710; round1 finding I4
    // when the server ran the flow) -- this exercises LoginFlow.status()'s expired branch on the
    // daemon side (it's the handler
    // behind GET /v1/login/status) and runLoginCli's own `s.status === 'expired'` branch on the
    // CLI side, in the same call. pollsUntilComplete must be pushed out of reach too, or the
    // fake's default (1) would report 'complete' on the very first poll before expiry ever fires.
    t.fake.device.pollsUntilComplete = 1_000_000
    t.fake.device.expiresAfterPolls = 2
    const out: string[] = []
    await runLoginCli(t.home, { out: (s) => out.push(s), sleep: async () => {} })
    expect(out.join('\n')).toContain('The code expired')
    expect(readConfig(t.home).apiToken).toBeNull()
    expect(await (await fetch(`${t.base}/v1/health`, { headers: t.headers })).json()).toMatchObject({ loggedIn: false })
    await t.stop()
  })

  // The client half of the whole-branch review's C1 (R79). The GitHub authorization succeeds and
  // the Tickover account behind it is gone, which the server now says outright. Before this, the
  // server answered 'complete' with a live-looking api_token: the CLI printed "Logged in as
  // <login>", `tickover status` reported loggedIn: true, and every subsequent call was a 401 --
  // the silent failure CLAUDE.md's client rules exist to prevent, on the one path a developer is
  // *told* to run when their token stops working.
  it('fails when the account is closed, and never writes a token', async () => {
    const t = await startTestDaemon({ loggedOut: true })
    t.fake.device.pollsUntilComplete = 2
    t.fake.device.accountClosed = true
    const out: string[] = []
    // Thrown, not printed: `main()` turns a throw into stderr plus a non-zero exit, and the exit
    // code is what stops `/tickover:setup` -- see the spawned-CLI test below.
    await expect(runLoginCli(t.home, { out: (s) => out.push(s), sleep: async () => {} }))
      .rejects.toThrow('This GitHub account cannot be used with Tickover')
    // The exact string the old behaviour printed, and the reason this is a defect rather than a
    // rough edge: a developer who read that line had no way to know they were not logged in.
    expect(out.join('\n')).not.toContain('Logged in as')
    expect(readConfig(t.home).apiToken).toBeNull()
    expect(await (await fetch(`${t.base}/v1/health`, { headers: t.headers })).json()).toMatchObject({ loggedIn: false })
    await t.stop()
  })

  /**
   * The exit code, measured on the built CLI rather than inferred from the throw above.
   *
   * `skills/setup/SKILL.md` runs `tickover login` at step 4 and then, at step 5, rewrites the
   * developer's `~/.claude/settings.json`. A zero exit is what let a deleted or banned developer
   * sail past step 4 into that rewrite and only discover at step 6 that they were never logged in
   * -- the same shape as C1 itself, our own documented next step failing quietly. Nothing below the
   * process boundary can see this: `runLoginCli` rejecting is only half the chain, and `main()`'s
   * catch is the other half.
   */
  it('exits non-zero on a closed account, so the setup skill stops at step 4', async () => {
    assertFreshBundle()
    const t = await startTestDaemon({ loggedOut: true })
    t.fake.device.pollsUntilComplete = 2
    t.fake.device.accountClosed = true
    try {
      const r = await new Promise<{ code: number | null; stdout: string; stderr: string }>((ok, fail) => {
        const child = spawn(process.execPath, [resolve('dist/cli.js'), 'login'], { env: { ...process.env, TICKOVER_HOME: t.home } })
        let stdout = ''
        let stderr = ''
        child.stdout.on('data', (c) => (stdout += c))
        child.stderr.on('data', (c) => (stderr += c))
        child.on('error', fail)
        child.on('exit', (code) => ok({ code, stdout, stderr }))
      })
      expect(r.code, `stdout: ${r.stdout}\nstderr: ${r.stderr}`).toBe(1)
      expect(r.stderr).toContain('This GitHub account cannot be used with Tickover')
      // It still relays the device code first, so the developer sees a real login attempt fail
      // rather than a command that refuses to start.
      expect(r.stdout).toContain('ABCD-0001')
      expect(r.stdout).not.toContain('Logged in as')
      expect(readConfig(t.home).apiToken).toBeNull()
    } finally {
      await t.stop()
    }
  }, 30_000)

  // Captured 2026-09-29 against the published 0.1.1 with serverUrl on a dead port: the daemon
  // answered /v1/login/start with a 500, the CLI printed "Open undefined and enter the code:
  // undefined", slept NaN ms 200 times, claimed "Timed out waiting for GitHub" about a second later
  // and exited 0. A developer whose network is down, or whose server is, gets told to go to a URL
  // that does not exist and that GitHub was slow.
  it('fails with a reason when the server cannot start a login, instead of relaying undefined', async () => {
    const t = await startTestDaemon({ loggedOut: true, serverUrl: 'http://127.0.0.1:9' })
    const out: string[] = []
    const sleeps: number[] = []
    try {
      await expect(runLoginCli(t.home, { out: (s) => out.push(s), sleep: async (ms) => { sleeps.push(ms) } }))
        .rejects.toThrow('Could not start a login')
      expect(out.join('\n')).not.toContain('undefined')
      expect(out.join('\n')).not.toContain('Timed out waiting for GitHub')
      expect(sleeps).toEqual([])
      expect(readConfig(t.home).apiToken).toBeNull()
    } finally {
      await t.stop()
    }
  })

  it('times out after 200 polls that never resolve, respecting the server-given interval, and never writes a token', async () => {
    const t = await startTestDaemon({ loggedOut: true })
    // pollsUntilComplete this high means every one of runLoginCli's 200 polls sees 'pending' --
    // this is a DIFFERENT branch than expiry above: the server never says the code is done or
    // expired, so this pins runLoginCli's own bounded-wait timeout (it must give up, not spin
    // forever against a code that never resolves).
    t.fake.device.pollsUntilComplete = 1_000_000
    const out: string[] = []
    const sleeps: number[] = []
    await runLoginCli(t.home, {
      out: (s) => out.push(s),
      // Cuts the CLI's own 200-iteration wait short without a real 200-second test, while still
      // recording every duration it was actually asked to sleep for -- asserted below to derive
      // from the fake server's own interval_s (1s), not a fixed or fast poll of its own.
      sleep: async (ms) => { sleeps.push(ms) },
    })
    expect(sleeps.length).toBeGreaterThan(1)
    expect(sleeps.every((ms) => ms === 1000)).toBe(true)
    expect(out.join('\n')).toContain('Timed out waiting for GitHub')
    expect(readConfig(t.home).apiToken).toBeNull()
    await t.stop()
  })
})
