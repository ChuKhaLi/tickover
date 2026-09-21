import { describe, it, expect } from 'vitest'
import { spawn } from 'node:child_process'
import { resolve } from 'node:path'
import { startTestDaemon } from '../helpers/daemon.js'
import { assertFreshBundle } from '../helpers/dist.js'
import { readConfig } from '../../src/config.js'
import { runLoginCli } from '../../src/login.js'

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

  it('reports the real expired status from the server and never writes a token (LoginFlow.status and runLoginCli both)', async () => {
    const t = await startTestDaemon({ loggedOut: true })
    // Drives the fake server's actual 'expired' response (round1 finding I4) -- this exercises
    // LoginFlow.status()'s `r.status === 'expired'` branch on the daemon side (it's the handler
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
