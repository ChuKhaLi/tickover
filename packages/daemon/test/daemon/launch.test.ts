import { describe, it, expect } from 'vitest'
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync, utimesSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { ensureDaemon } from '../../src/launch.js'
import { readDaemonInfo, readConfig } from '../../src/config.js'
import { assertFreshBundle } from '../helpers/dist.js'

// A minimal stand-in for the real CLI's `daemon` command, shared by the tests below: it only
// needs to (a) record that it was ever launched at all, and (b) eventually produce a healthy
// daemon.json, which is the only two things ensureDaemon can observe. `.cjs` so it runs as
// CommonJS regardless of any package.json `type` field above the OS temp dir.
function writeStubDaemon(home: string, spawnLog: string, version?: string, name = 'stub-daemon.cjs'): string {
  const stub = join(home, name)
  const health = JSON.stringify(version === undefined ? { ok: true } : { ok: true, version })
  writeFileSync(
    stub,
    [
      "const fs = require('fs')",
      "const http = require('http')",
      "const path = require('path')",
      `fs.appendFileSync(${JSON.stringify(spawnLog)}, process.pid + '\\n')`,
      'const server = http.createServer((req, res) => {',
      `  if (req.url === '/v1/health') { res.writeHead(200, { 'content-type': 'application/json' }); res.end(${JSON.stringify(health)}); return }`,
      '  res.writeHead(404); res.end()',
      '})',
      "server.listen(0, '127.0.0.1', () => {",
      '  const { port } = server.address()',
      `  fs.writeFileSync(path.join(${JSON.stringify(home)}, 'daemon.json'), JSON.stringify({ port, token: 'x', pid: process.pid, startedAt: new Date().toISOString() }))`,
      '})',
    ].join('\n'),
  )
  return stub
}

describe('ensureDaemon', () => {
  // Whole-branch review (R710) I2, reproduced with the published 0.1.2: setup installs a new CLI
  // while Claude Code's status line keeps the old daemon busy, so it never idles out; the new CLI's
  // `login` then talked to the old daemon, which asked the server for routes that no longer exist.
  // A daemon reporting another version is replaced by one of this CLI's own.
  it('replaces a running daemon of another version with one of its own', async () => {
    const home = mkdtempSync(join(tmpdir(), 'mw-launch-'))
    const spawnLog = join(home, 'spawns.log')
    const old = spawn(process.execPath, [writeStubDaemon(home, join(home, 'old.log'), '0.1.0', 'old-daemon.cjs')], { stdio: 'ignore' })
    try {
      const deadline = Date.now() + 5000
      while (!existsSync(join(home, 'daemon.json')) && Date.now() < deadline) await new Promise((r) => setTimeout(r, 50))
      const oldInfo = readDaemonInfo(home)!
      const info = await ensureDaemon(home, { cliPath: writeStubDaemon(home, spawnLog, '9.9.9'), waitMs: 10_000, expectVersion: '9.9.9' })
      expect(info.pid).not.toBe(oldInfo.pid)
      await new Promise((r) => setTimeout(r, 300))
      expect(() => process.kill(oldInfo.pid, 0)).toThrow()
      // And one of the right version is kept, not restarted again.
      const again = await ensureDaemon(home, { cliPath: writeStubDaemon(home, spawnLog, '9.9.9'), expectVersion: '9.9.9' })
      expect(again.pid).toBe(info.pid)
      expect(readFileSync(spawnLog, 'utf8').trim().split('\n')).toHaveLength(1)
      process.kill(info.pid)
    } finally {
      try { old.kill() } catch { /* gone */ }
      await new Promise((r) => setTimeout(r, 300))
      rmSync(home, { recursive: true, force: true })
    }
  }, 30_000)

  it('spawns a detached daemon when none is running and reuses it afterwards', async () => {
    const home = mkdtempSync(join(tmpdir(), 'mw-launch-'))
    // The other test that spawns the BUILT cli -- same stale-bundle exposure, same guard.
    assertFreshBundle()
    const cli = resolve('dist/cli.js')
    const first = await ensureDaemon(home, { cliPath: cli, waitMs: 15_000 })
    expect(first.port).toBeGreaterThan(0)
    const again = await ensureDaemon(home, { cliPath: cli })
    expect(again.port).toBe(first.port)
    expect(readDaemonInfo(home)!.pid).toBe(first.pid)

    // The daemon records how to start itself again, so notify.mjs's SessionStart self-heal has
    // something to spawn even for a developer who never ran `tickover register`. Asserted here,
    // against the BUILT cli, because the unit test for ensureDaemonBin cannot show that the real
    // entry point passes a path that actually exists and is actually runnable.
    const bin = readConfig(home).daemonBin
    expect(bin).toBeTruthy()
    expect(existsSync(bin!)).toBe(true)
    expect(resolve(bin!)).toBe(resolve(cli))
    process.kill(first.pid)
    await new Promise((r) => setTimeout(r, 500))
    rmSync(home, { recursive: true, force: true })
  }, 30_000)

  it('gives up cleanly at waitMs instead of spinning forever when the daemon never starts', async () => {
    const home = mkdtempSync(join(tmpdir(), 'mw-launch-noop-'))
    // A process that exits immediately without ever writing daemon.json -- ensureDaemon must not
    // hang waiting on a child that's already gone, and must not poll past waitMs.
    const noop = join(home, 'noop.js')
    writeFileSync(noop, 'process.exit(0)\n')
    const start = Date.now()
    await expect(ensureDaemon(home, { cliPath: noop, waitMs: 500 })).rejects.toThrow('daemon did not start')
    // Generous slack over waitMs for the poll interval, not a tight race.
    expect(Date.now() - start).toBeLessThan(2000)
    rmSync(home, { recursive: true, force: true })
  }, 10_000)

  it('does not spawn a second, orphaned daemon when two callers race on a cold home (round1 finding I3)', async () => {
    const home = mkdtempSync(join(tmpdir(), 'mw-launch-race-'))
    const spawnLog = join(home, 'spawn-log.txt')
    const stub = writeStubDaemon(home, spawnLog)
    const [a, b] = await Promise.all([
      ensureDaemon(home, { cliPath: stub, waitMs: 10_000 }),
      ensureDaemon(home, { cliPath: stub, waitMs: 10_000 }),
    ])
    expect(a.pid).toBe(b.pid)
    expect(a.port).toBe(b.port)
    // The real assertion: exactly one process was ever launched. Without the lock, both callers
    // pass the initial readDaemonInfo/healthy check before either has written daemon.json and
    // both spawn -- this would read back as 2, with the loser's daemon orphaned on its own port.
    const spawns = existsSync(spawnLog) ? readFileSync(spawnLog, 'utf8').trim().split('\n').filter(Boolean) : []
    expect(spawns).toHaveLength(1)
    // The lock is released once daemon.json is readable -- confirm it doesn't linger and block a
    // later caller forever.
    expect(existsSync(join(home, 'daemon.lock'))).toBe(false)
    process.kill(a.pid)
    await new Promise((r) => setTimeout(r, 300))
    rmSync(home, { recursive: true, force: true })
  }, 20_000)

  it('reclaims a stale lock left by a crashed owner instead of waiting behind it forever (round2)', async () => {
    const home = mkdtempSync(join(tmpdir(), 'mw-launch-stale-'))
    const spawnLog = join(home, 'spawn-log.txt')
    const stub = writeStubDaemon(home, spawnLog)

    // Simulate a previous ensureDaemon caller that won the lock and then died -- crashed, or was
    // killed -- before ever writing daemon.json. The lock file is left behind, backdated well
    // past any short waitMs a later caller would use, so tryAcquireLock's staleness check (which
    // compares against that same waitMs) sees it as abandoned rather than actively held.
    const lockPath = join(home, 'daemon.lock')
    writeFileSync(lockPath, '')
    const old = new Date(Date.now() - 60_000)
    utimesSync(lockPath, old, old)

    const waitMs = 5_000
    const start = Date.now()
    const info = await ensureDaemon(home, { cliPath: stub, waitMs })
    expect(info.port).toBeGreaterThan(0)
    // Reclaimed promptly -- not stuck waiting out the dead lock's own (nonexistent) owner.
    expect(Date.now() - start).toBeLessThan(waitMs)
    expect(existsSync(lockPath)).toBe(false)

    const spawns = readFileSync(spawnLog, 'utf8').trim().split('\n').filter(Boolean)
    expect(spawns).toHaveLength(1) // reclaimed and spawned exactly once, not blocked forever

    process.kill(info.pid)
    await new Promise((r) => setTimeout(r, 300))
    rmSync(home, { recursive: true, force: true })
  }, 15_000)
})
