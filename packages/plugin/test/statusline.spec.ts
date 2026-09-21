import { describe, it, expect } from 'vitest'
import { spawn } from 'node:child_process'
import http from 'node:http'
import net from 'node:net'
import type { AddressInfo } from 'node:net'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const DAEMON_OFF = 'tickover · daemon off · run: tickover status'
const script = resolve(__dirname, '../statusline/statusline.mjs')
const input = { session_id: 's1', version: '2.1.90', model: { id: 'claude-opus-5', display_name: 'Opus' }, cwd: 'C:/proj', workspace: { repo: { owner: 'secret', name: 'secret' } } }

// See notify.spec.ts for why this must be an async spawn rather than spawnSync: the fake daemons
// below run their HTTP server in this same test process, and spawnSync would freeze that
// process's event loop (so the server could never answer) until the child gives up and exits.
// COLUMNS is deleted by default so these tests do not depend on whether the runner happens to
// export it -- the width path is exercised explicitly by passing it in envOver.
function run(home: string, payload: unknown = input, envOver: Record<string, string | undefined> = {}): Promise<{ status: number | null; stdout: string; stderr: string; ms: number }> {
  return new Promise((resolvePromise, reject) => {
    const started = Date.now()
    const env: Record<string, string> = { ...(process.env as Record<string, string>), TICKOVER_HOME: home }
    delete env.COLUMNS
    for (const [k, v] of Object.entries(envOver)) { if (v === undefined) delete env[k]; else env[k] = v }
    const child = spawn(process.execPath, [script], { env })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (c) => (stdout += c))
    child.stderr.on('data', (c) => (stderr += c))
    child.on('error', reject)
    child.on('exit', (status) => resolvePromise({ status, stdout, stderr, ms: Date.now() - started }))
    child.stdin.write(JSON.stringify(payload))
    child.stdin.end()
  })
}

// A daemon that answers every request with a given status code, for the failure paths.
async function fakeDaemonStatus(code: number) {
  const server = http.createServer((req, res) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: 'nope' })) })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  return { port: (server.address() as AddressInfo).port, close: () => new Promise<void>((r) => server.close(() => r())) }
}

async function fakeDaemon(line: string) {
  const urls: string[] = []
  const server = http.createServer((req, res) => { urls.push(req.url ?? ''); res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ line })) })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  return { port: (server.address() as AddressInfo).port, urls, close: () => new Promise<void>((r) => server.close(() => r())) }
}

describe('statusline.mjs', () => {
  it('prints the daemon line, forwards session and version, never the repo', async () => {
    const d = await fakeDaemon('tickover · today 1/10 · balance $0.50')
    const home = mkdtempSync(join(tmpdir(), 'mw-sl-'))
    writeFileSync(join(home, 'daemon.json'), JSON.stringify({ port: d.port, token: 'tok', pid: 1, startedAt: '' }))
    const r = await run(home)
    expect(r.status).toBe(0)
    expect(r.stdout).toBe('tickover · today 1/10 · balance $0.50')
    expect(r.ms).toBeLessThan(1800)
    expect(d.urls[0]).toBe('/v1/status?session_id=s1&version=2.1.90')
    await d.close()
  })

  it('wraps the previous status line command above ours', async () => {
    const d = await fakeDaemon('tickover · x')
    const home = mkdtempSync(join(tmpdir(), 'mw-sl-'))
    writeFileSync(join(home, 'daemon.json'), JSON.stringify({ port: d.port, token: 'tok', pid: 1, startedAt: '' }))
    writeFileSync(join(home, 'config.json'), JSON.stringify({ wrappedStatusLine: { type: 'command', command: `node -e "process.stdin.resume();process.stdout.write('orig ' + JSON.parse(require('fs').readFileSync(0,'utf8')).model.display_name)"` } }))
    const r = await run(home)
    expect(r.stdout).toBe('orig Opus\ntickover · x')
    await d.close()
  })

  it('tells the developer when the daemon is off and falls back to the original on daemon errors', async () => {
    const home = mkdtempSync(join(tmpdir(), 'mw-sl-'))
    expect((await run(home)).stdout).toBe('tickover · daemon off · run: tickover status')
    writeFileSync(join(home, 'daemon.json'), JSON.stringify({ port: 1, token: 'tok', pid: 1, startedAt: '' }))
    writeFileSync(join(home, 'config.json'), JSON.stringify({ wrappedStatusLine: { type: 'command', command: `node -e "process.stdout.write('only original')"` } }))
    const r = await run(home)
    expect(r.stdout).toBe('only original')
    expect(r.ms).toBeLessThan(2500)
  })

  it('does not hang when the daemon accepts the connection but never responds', async () => {
    // Same shape as notify's equivalent test: a socket that opens and stays silent, to prove the
    // 1000ms AbortSignal on the /v1/status fetch actually fires rather than the process hanging.
    const sockets = new Set<import('node:net').Socket>()
    const server = net.createServer((socket) => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)) })
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
    const port = (server.address() as AddressInfo).port
    const home = mkdtempSync(join(tmpdir(), 'mw-sl-'))
    writeFileSync(join(home, 'daemon.json'), JSON.stringify({ port, token: 'tok', pid: 1, startedAt: '' }))
    const r = await run(home)
    expect(r.status).toBe(0)
    // Was '' before 2026-09-06: a daemon that never answers is unreachable, and with no wrapped
    // command to fall back to the developer would otherwise get a blank line and no diagnostic.
    expect(r.stdout).toBe(DAEMON_OFF)
    expect(r.ms).toBeGreaterThanOrEqual(900)
    expect(r.ms).toBeLessThan(1800)
    // See notify.spec.ts's equivalent test: the accepted-and-ignored socket must be destroyed
    // before server.close(), or its callback (which waits for every connection to end) hangs.
    for (const s of sockets) s.destroy()
    await new Promise<void>((r2) => server.close(() => r2()))
  })

  it('runs the wrapped command and the daemon fetch concurrently, not summed', async () => {
    // A daemon that never answers (forces the full ~1000ms fetch abort) alongside a wrapped
    // command that takes ~600ms on its own. In series that would be ~1600ms; run together it
    // must land close to the slower of the two, not their sum.
    const sockets = new Set<import('node:net').Socket>()
    const server = net.createServer((socket) => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)) })
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
    const port = (server.address() as AddressInfo).port
    const home = mkdtempSync(join(tmpdir(), 'mw-sl-'))
    writeFileSync(join(home, 'daemon.json'), JSON.stringify({ port, token: 'tok', pid: 1, startedAt: '' }))
    writeFileSync(join(home, 'config.json'), JSON.stringify({ wrappedStatusLine: { type: 'command', command: `node -e "setTimeout(() => process.stdout.write('slow orig'), 600)"` } }))
    const r = await run(home)
    expect(r.status).toBe(0)
    expect(r.stdout).toBe('slow orig')
    expect(r.ms).toBeGreaterThanOrEqual(900)
    // Well under 600 + 1000: proves the two ran together rather than one after the other.
    expect(r.ms).toBeLessThan(1400)
    for (const s of sockets) s.destroy()
    await new Promise<void>((r2) => server.close(() => r2()))
  })

  it('kills a genuinely hanging wrapped command at its own timeout instead of waiting forever', async () => {
    const d = await fakeDaemon('tickover · today 1/10 · balance $0.50')
    const home = mkdtempSync(join(tmpdir(), 'mw-sl-'))
    writeFileSync(join(home, 'daemon.json'), JSON.stringify({ port: d.port, token: 'tok', pid: 1, startedAt: '' }))
    writeFileSync(join(home, 'config.json'), JSON.stringify({ wrappedStatusLine: { type: 'command', command: `node -e "setInterval(() => {}, 1000)"` } }))
    const r = await run(home)
    expect(r.status).toBe(0)
    // The wrapped command never produced output and was killed, so only the daemon line prints.
    expect(r.stdout).toBe('tickover · today 1/10 · balance $0.50')
    expect(r.ms).toBeGreaterThanOrEqual(900)
    expect(r.ms).toBeLessThan(1800)
    await d.close()
  })

  // Whole-branch review I3. This file's own header promises that a broken daemon "must never blank
  // out whatever status line the developer already had" -- but the write into the wrapped command's
  // stdin had no 'error' listener, so a payload larger than the OS pipe buffer (64 KB) against a
  // wrapped command that does not read stdin raised an uncaught EPIPE/EOF: exit 1, EMPTY STDOUT,
  // and the developer's existing status line gone. Nothing Tickover controls triggers it -- it is
  // the developer's own wrapped command ignoring stdin, plus Claude Code growing its status-line
  // payload past 64 KB over time, which today sits at roughly 1 KB.
  it('survives a stdin payload past the pipe buffer when the wrapped command ignores stdin', async () => {
    const d = await fakeDaemon('tickover · today 1/10 · balance $0.50')
    const home = mkdtempSync(join(tmpdir(), 'mw-sl-'))
    writeFileSync(join(home, 'daemon.json'), JSON.stringify({ port: d.port, token: 'tok', pid: 1, startedAt: '' }))
    // Exits immediately without ever reading stdin, so its end of the pipe is gone while
    // statusline.mjs is still writing 70 KB into it.
    writeFileSync(join(home, 'config.json'), JSON.stringify({ wrappedStatusLine: { type: 'command', command: `node -e "process.stdout.write('orig')"` } }))

    const big = { ...input, padding: 'p'.repeat(70_000) }
    expect(JSON.stringify(big).length).toBeGreaterThan(65_536)

    // Run it more than once: an unhandled 'error' on a pipe is a race, and the review measured it
    // at 8 of 8 rather than 1 of 1. A single green run would not be evidence of anything.
    for (let i = 0; i < 4; i++) {
      const r = await run(home, big)
      expect(r.status, `run ${i} exit code (stderr: ${r.stderr})`).toBe(0)
      expect(r.stdout, `run ${i} stdout`).toBe('orig\ntickover · today 1/10 · balance $0.50')
    }
    await d.close()
  })

  it('exits within its hard-stop budget even when stdin never closes', async () => {
    // Nothing is written and stdin is never ended, unlike every other test here. Converting the
    // blocking readFileSync(0) to an async read (round 1) removed the thread-blocking side
    // effect but added no time bound by itself -- this is what the round-1 fix was missing: with
    // stdin never closing, the async read never resolves either, and there was no hardStop timer
    // racing it the way notify.mjs has one. This test is what would have caught that gap.
    const home = mkdtempSync(join(tmpdir(), 'mw-sl-'))
    const started = Date.now()
    const child = spawn(process.execPath, [script], { env: { ...process.env, TICKOVER_HOME: home } })
    let stdout = ''
    child.stdout.on('data', (c) => (stdout += c))
    const result = await new Promise<{ status: number | null; ms: number }>((resolvePromise) => {
      child.on('exit', (status) => resolvePromise({ status, ms: Date.now() - started }))
    })
    expect(result.status).toBe(0)
    expect(stdout).toBe('')
    // Bounded near the 1400ms hard stop, not vitest's much larger test timeout.
    expect(result.ms).toBeLessThan(2000)
  })
})

// Spike 2026-09-06: Claude Code exports COLUMNS to the status line command and keeps it current
// across terminal resizes (189 -> 46 -> 189 observed). stdout and stderr are both pipes, so this
// env var is the only channel carrying the width -- the daemon composes, so it has to be forwarded.
describe('statusline.mjs terminal width', () => {
  it('forwards the terminal width the terminal reports', async () => {
    const d = await fakeDaemon('tickover · x')
    const home = mkdtempSync(join(tmpdir(), 'mw-sl-'))
    writeFileSync(join(home, 'daemon.json'), JSON.stringify({ port: d.port, token: 'tok', pid: 1, startedAt: '' }))
    await run(home, input, { COLUMNS: '189' })
    expect(d.urls[0]).toBe('/v1/status?session_id=s1&version=2.1.90&cols=189')
    await d.close()
  })

  it('omits cols entirely rather than forwarding a width it cannot trust', async () => {
    // A forwarded 'NaN', '' or '0' would be a value the script invented. Omitting the parameter is
    // the honest signal for "unknown", and lets the daemon apply its documented fallback.
    for (const bad of ['abc', '', '0', '-40', 'NaN', '  ']) {
      const d = await fakeDaemon('tickover · x')
      const home = mkdtempSync(join(tmpdir(), 'mw-sl-'))
      writeFileSync(join(home, 'daemon.json'), JSON.stringify({ port: d.port, token: 'tok', pid: 1, startedAt: '' }))
      await run(home, input, { COLUMNS: bad })
      expect(d.urls[0], `COLUMNS=${JSON.stringify(bad)}`).toBe('/v1/status?session_id=s1&version=2.1.90')
      await d.close()
    }
  })
})

// Observed 2026-09-06: a developer's status line was completely blank with no diagnostic anywhere.
// Cause: an unclean daemon exit leaves daemon.json behind, and every failure path here -- a dead
// port, and a 401 from a port some other daemon has since taken -- collapsed to ''. A *missing*
// daemon.json already said "daemon off", so the worse state gave the less useful output, and the
// file's own header promise ("a broken daemon must never blank out whatever status line the
// developer already had") did not hold when there was no wrapped original to fall back to.
describe('statusline.mjs stale daemon', () => {
  it('reports the daemon is off when daemon.json points at a dead port', async () => {
    const home = mkdtempSync(join(tmpdir(), 'mw-sl-'))
    writeFileSync(join(home, 'daemon.json'), JSON.stringify({ port: 49999, token: 'tok', pid: 1, startedAt: '' }))
    expect((await run(home)).stdout).toBe(DAEMON_OFF)
  })

  it('reports the daemon is off when the recorded token is rejected', async () => {
    // The port was recycled by a different daemon, so the recorded token now 401s. Indistinguishable
    // from a dead daemon as far as the developer is concerned, and equally in need of a message.
    const d = await fakeDaemonStatus(401)
    const home = mkdtempSync(join(tmpdir(), 'mw-sl-'))
    writeFileSync(join(home, 'daemon.json'), JSON.stringify({ port: d.port, token: 'stale', pid: 1, startedAt: '' }))
    expect((await run(home)).stdout).toBe(DAEMON_OFF)
    await d.close()
  })

  it('stays silent when the developer already has a status line to fall back to', async () => {
    // The header's promise, and the decision three existing tests encode: an unreachable daemon
    // falls back to the original ALONE. The notice is for when falling back leaves nothing at all.
    const home = mkdtempSync(join(tmpdir(), 'mw-sl-'))
    writeFileSync(join(home, 'daemon.json'), JSON.stringify({ port: 49999, token: 'tok', pid: 1, startedAt: '' }))
    writeFileSync(join(home, 'config.json'), JSON.stringify({ wrappedStatusLine: { type: 'command', command: `node -e "process.stdout.write('orig')"` } }))
    expect((await run(home)).stdout).toBe('orig')
  })

  it('still prints nothing extra when the daemon answers with an empty line', async () => {
    // An empty line from a healthy daemon is legitimate (nothing to show). It must not be turned
    // into a "daemon off" notice, or the notice would appear during normal idle operation.
    const d = await fakeDaemon('')
    const home = mkdtempSync(join(tmpdir(), 'mw-sl-'))
    writeFileSync(join(home, 'daemon.json'), JSON.stringify({ port: d.port, token: 'tok', pid: 1, startedAt: '' }))
    expect((await run(home)).stdout).toBe('')
    await d.close()
  })
})
