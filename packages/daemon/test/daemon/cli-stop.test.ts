import { describe, it, expect } from 'vitest'
import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { assertFreshBundle } from '../helpers/dist.js'

const alive = (pid: number) => { try { process.kill(pid, 0); return true } catch { return false } }
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

// A process that answers /v1/health for one token the way the daemon does, so `stop` can tell it
// is the daemon; it prints its port once it is listening.
function fakeDaemon(token: string): Promise<{ child: ChildProcess; port: number }> {
  const src = `const h=require('http');const s=h.createServer((q,r)=>{r.writeHead(q.url==='/v1/health'&&q.headers['x-tickover-token']===${JSON.stringify(token)}?200:401);r.end('{}')});s.listen(0,'127.0.0.1',()=>console.log(s.address().port))`
  const child = spawn(process.execPath, ['-e', src], { stdio: ['ignore', 'pipe', 'ignore'] })
  return new Promise((ok) => child.stdout!.once('data', (d) => ok({ child, port: Number(String(d).trim()) })))
}

function stop(home: string) {
  return spawnSync(process.execPath, [resolve('dist/cli.js'), 'stop'], { encoding: 'utf8', env: { ...process.env, TICKOVER_HOME: home } })
}

// /tickover:uninstall step 3 had the model set daemonBin to null in config.json by hand -- the file
// that holds the api token -- and then kill the pid. Captured 2026-09-29: with daemonBin still set,
// the next UserPromptSubmit hook restarted the daemon. `tickover stop` does both, in that order.
describe('tickover stop (built CLI)', () => {
  it('clears daemonBin, ends the daemon and removes daemon.json', async () => {
    assertFreshBundle()
    const home = mkdtempSync(join(tmpdir(), 'tk-stop-'))
    const d = await fakeDaemon('daemon-token')
    try {
      writeFileSync(join(home, 'config.json'), JSON.stringify({ apiToken: 'secret-api-token', daemonBin: 'C:/somewhere/cli.js' }))
      writeFileSync(join(home, 'daemon.json'), JSON.stringify({ port: d.port, token: 'daemon-token', pid: d.child.pid, startedAt: '' }))
      const r = stop(home)
      expect(r.status, r.stderr).toBe(0)
      expect(r.stdout + r.stderr).not.toContain('secret-api-token')
      const config = JSON.parse(readFileSync(join(home, 'config.json'), 'utf8'))
      expect(config.daemonBin).toBeNull()
      expect(config.apiToken).toBe('secret-api-token')
      expect(existsSync(join(home, 'daemon.json'))).toBe(false)
      const deadline = Date.now() + 5000
      while (alive(d.child.pid!) && Date.now() < deadline) await sleep(100)
      expect(alive(d.child.pid!)).toBe(false)
    } finally {
      try { d.child.kill() } catch { /* already gone */ }
      rmSync(home, { recursive: true, force: true })
    }
  })

  // Whole-branch review I3: a stale daemon.json is a known state (a reboot, a crash), and its pid
  // can by then belong to anything. `stop` killed it unconditionally -- on Windows an immediate
  // TerminateProcess of, say, an editor with unsaved work.
  it('never kills a process that is not the daemon daemon.json names', async () => {
    assertFreshBundle()
    const home = mkdtempSync(join(tmpdir(), 'tk-stop-'))
    const other = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' })
    try {
      writeFileSync(join(home, 'config.json'), JSON.stringify({ daemonBin: 'C:/somewhere/cli.js' }))
      writeFileSync(join(home, 'daemon.json'), JSON.stringify({ port: 9, token: 'stale', pid: other.pid, startedAt: '' }))
      const r = stop(home)
      expect(r.status, r.stderr).toBe(0)
      await sleep(500)
      expect(alive(other.pid!)).toBe(true)
      // Says what it saw rather than "no daemon was running", and keeps the record: if that was a
      // daemon too busy to answer, deleting it would leave a daemon nothing points at (re-review).
      expect(r.stdout).toContain(`did not answer as the daemon`)
      expect(existsSync(join(home, 'daemon.json'))).toBe(true)
      expect(JSON.parse(readFileSync(join(home, 'config.json'), 'utf8')).daemonBin).toBeNull()
    } finally {
      other.kill()
      rmSync(home, { recursive: true, force: true })
    }
  })

  it('drops a record whose process is gone', () => {
    assertFreshBundle()
    const home = mkdtempSync(join(tmpdir(), 'tk-stop-'))
    const gone = spawnSync(process.execPath, ['-e', 'console.log(process.pid)'], { encoding: 'utf8' })
    try {
      writeFileSync(join(home, 'daemon.json'), JSON.stringify({ port: 9, token: 'stale', pid: Number(gone.stdout.trim()), startedAt: '' }))
      const r = stop(home)
      expect(r.stdout).toContain('no daemon was running')
      expect(existsSync(join(home, 'daemon.json'))).toBe(false)
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  })

  it('with no daemon running, still clears daemonBin and exits 0', () => {
    assertFreshBundle()
    const home = mkdtempSync(join(tmpdir(), 'tk-stop-'))
    try {
      writeFileSync(join(home, 'config.json'), JSON.stringify({ daemonBin: 'C:/somewhere/cli.js' }))
      const r = stop(home)
      expect(r.status, r.stderr).toBe(0)
      expect(JSON.parse(readFileSync(join(home, 'config.json'), 'utf8')).daemonBin).toBeNull()
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  })
})
