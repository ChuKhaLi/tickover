import { describe, it, expect } from 'vitest'
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { readDaemonInfo } from '../../src/config.js'
import { assertFreshBundle } from '../helpers/dist.js'

// Runs the BUILT cli, the way a developer's `tickover` does -- `--print` keeps it from spawning a
// real browser on the test machine, and is itself the SSH/scripting path.
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

// Whole-branch review, Minor: the setup skill told the developer to open
// http://127.0.0.1:PORT/?t=TOKEN using the port from `tickover status` -- but `status`
// deliberately omits the token (Task 9 token hygiene), so there was no documented way to get one.
// The page was reachable in principle and unreachable in practice.
describe('tickover page', () => {
  it('prints a URL that actually authenticates against the running daemon', async () => {
    assertFreshBundle()
    const home = mkdtempSync(join(tmpdir(), 'mw-page-'))
    try {
      const r = await runCli(home, ['page', '--print'])
      expect(r.stderr).toBe('')
      expect(r.code).toBe(0)

      const url = r.stdout.trim()
      const info = readDaemonInfo(home)!
      expect(url).toBe(`http://127.0.0.1:${info.port}/?t=${encodeURIComponent(info.token)}`)

      // The whole point of the command: this URL, unmodified, gets the developer into the page.
      const boot = await fetch(url, { redirect: 'manual' })
      expect(boot.status).toBe(302)
      expect(boot.headers.get('set-cookie')).toContain('mw_daemon=')
      const page = await fetch(`http://127.0.0.1:${info.port}/`, { headers: { cookie: `mw_daemon=${info.token}` } })
      expect(page.status).toBe(200)
      expect(await page.text()).toContain('EventSource')

      // And `status`, which people paste into issues, still does not leak the token.
      const status = await runCli(home, ['status'])
      expect(status.stdout).not.toContain(info.token)

      process.kill(info.pid)
      await new Promise((r2) => setTimeout(r2, 500))
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  }, 30_000)
})
