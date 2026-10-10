import { describe, it, expect, beforeAll } from 'vitest'
import { spawn } from 'node:child_process'
import http from 'node:http'
import net from 'node:net'
import type { AddressInfo } from 'node:net'
import { mkdtempSync, writeFileSync, existsSync, readFileSync, mkdirSync, copyFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const script = resolve(__dirname, '../hooks/notify.mjs')

// `spawnSync` blocks the whole Node event loop of *this* process until the child exits. Every
// fake daemon below runs an HTTP server in this same test process, so a synchronous spawn would
// deadlock: the child's request could never be serviced because the process hosting the server
// is frozen inside spawnSync, waiting for that very child to exit. Only an async spawn lets both
// sides make progress.
function run(home: string, input: unknown, hook = script): Promise<{ status: number | null; stdout: string; ms: number }> {
  return new Promise((resolvePromise, reject) => {
    const started = Date.now()
    const child = spawn(process.execPath, [hook], { env: { ...process.env, TICKOVER_HOME: home } })
    let stdout = ''
    child.stdout.on('data', (c) => (stdout += c))
    child.on('error', reject)
    child.on('exit', (status) => resolvePromise({ status, stdout, ms: Date.now() - started }))
    child.stdin.write(typeof input === 'string' ? input : JSON.stringify(input))
    child.stdin.end()
  })
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

// Upper bounds relative to what starting this script costs right now (R922), as statusline.spec.ts
// does: these were absolute (1500, 1400), and on a loaded machine a 1785ms exit against a 1400ms
// bound was Node starting slowly, not the hard stop failing. The baseline is the cheapest trip
// through the script -- a Stop with no daemon.json, which posts nothing -- slowest of three at the
// start, or a fresh run if that is slower now. The lower bounds stay absolute.
let baseAtStart = 0
let baseHome = ''
async function base(): Promise<number> {
  return Math.max(baseAtStart, (await run(baseHome, { hook_event_name: 'Stop', session_id: 'base' })).ms)
}
beforeAll(async () => {
  baseHome = mkdtempSync(join(tmpdir(), 'mw-plugin-base-'))
  for (let i = 0; i < 3; i++) baseAtStart = Math.max(baseAtStart, (await run(baseHome, { hook_event_name: 'Stop', session_id: 'base' })).ms)
}, 60_000)

async function fakeDaemon() {
  const posts: Array<{ token: string | undefined; body: unknown }> = []
  const server = http.createServer((req, res) => {
    let d = ''; req.on('data', (c) => (d += c)); req.on('end', () => { posts.push({ token: req.headers['x-tickover-token'] as string, body: JSON.parse(d) }); res.writeHead(204); res.end() })
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  return { port: (server.address() as AddressInfo).port, posts, close: () => new Promise<void>((r) => server.close(() => r())) }
}

describe('notify.mjs', () => {
  it('posts the hook event to the daemon, prints nothing, exits 0 quickly', async () => {
    const d = await fakeDaemon()
    const home = mkdtempSync(join(tmpdir(), 'mw-plugin-'))
    writeFileSync(join(home, 'daemon.json'), JSON.stringify({ port: d.port, token: 'tok', pid: 1, startedAt: '' }))
    const r = await run(home, { hook_event_name: 'UserPromptSubmit', session_id: 'abc', cwd: 'C:/proj', transcript_path: '/x', prompt: 'secret text' })
    expect(r.status).toBe(0)
    expect(r.stdout).toBe('')
    expect(r.ms).toBeLessThan(await base() + 1000)
    expect(d.posts[0]).toEqual({ token: 'tok', body: { event: 'UserPromptSubmit', session_id: 'abc', cwd: 'C:/proj', tool: 'claude-code' } })
    await d.close()
  })

  it('exits 0 with no daemon and no daemonBin, and spawns daemonBin when configured', async () => {
    const home = mkdtempSync(join(tmpdir(), 'mw-plugin-'))
    const r = await run(home, { hook_event_name: 'Stop', session_id: 'abc' })
    expect(r.status).toBe(0)
    expect(r.stdout).toBe('')
    expect(r.ms).toBeLessThan(await base() + 1000)

    const marker = join(home, 'spawned.txt')
    const fakeBin = join(home, 'fake-daemon.mjs')
    writeFileSync(fakeBin, `import { writeFileSync } from 'node:fs'; writeFileSync(${JSON.stringify(marker)}, process.argv.slice(2).join(' '))`)
    writeFileSync(join(home, 'config.json'), JSON.stringify({ daemonBin: fakeBin }))
    const r2 = await run(home, { hook_event_name: 'SessionStart', session_id: 'abc', cwd: 'C:/proj' })
    expect(r2.status).toBe(0)
    const deadline = Date.now() + 3000
    while (!existsSync(marker) && Date.now() < deadline) await sleep(50)
    expect(existsSync(marker)).toBe(true)
  })

  // `tickover statusline install` points Claude Code at a copy of the status line script under the
  // Tickover home, because the plugin's own directory is versioned and deleted 14 days after an
  // update. The copy then has to follow the plugin, and SessionStart is the one hook that runs from
  // the plugin's *current* directory at the start of every session.
  describe('keeping the installed status line copy current', () => {
    function pluginTree(statusline: string) {
      const root = mkdtempSync(join(tmpdir(), 'mw-plugin-tree-'))
      mkdirSync(join(root, 'hooks')); mkdirSync(join(root, 'statusline'))
      copyFileSync(script, join(root, 'hooks', 'notify.mjs'))
      writeFileSync(join(root, 'statusline', 'statusline.mjs'), statusline)
      return join(root, 'hooks', 'notify.mjs')
    }

    it('refreshes the copy on SessionStart when the plugin has a newer script', async () => {
      const notify = pluginTree('// statusline v2\n')
      const home = mkdtempSync(join(tmpdir(), 'mw-plugin-'))
      writeFileSync(join(home, 'statusline.mjs'), '// statusline v1\n')
      const r = await run(home, { hook_event_name: 'SessionStart', session_id: 'abc' }, notify)
      expect(r.status).toBe(0)
      expect(r.stdout).toBe('')
      expect(readFileSync(join(home, 'statusline.mjs'), 'utf8')).toBe('// statusline v2\n')
    })

    it('never creates the copy: that is what setup does, after consent', async () => {
      const notify = pluginTree('// statusline v2\n')
      const home = mkdtempSync(join(tmpdir(), 'mw-plugin-'))
      await run(home, { hook_event_name: 'SessionStart', session_id: 'abc' }, notify)
      expect(existsSync(join(home, 'statusline.mjs'))).toBe(false)
    })
  })

  it('tolerates garbage on stdin', async () => {
    const home = mkdtempSync(join(tmpdir(), 'mw-plugin-'))
    const r = await run(home, 'not json')
    expect(r.status).toBe(0)
    expect(r.stdout).toBe('')
  })

  it('does not hang when the daemon accepts the connection but never responds', async () => {
    // A server that opens the socket and then writes nothing back — different from
    // connection-refused, and the only way to prove the 600ms fetch abort (backed by the 800ms
    // hard exit) actually fires instead of the process just happening to fail fast.
    const sockets = new Set<import('node:net').Socket>()
    const server = net.createServer((socket) => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)) })
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
    const port = (server.address() as AddressInfo).port
    const home = mkdtempSync(join(tmpdir(), 'mw-plugin-'))
    writeFileSync(join(home, 'daemon.json'), JSON.stringify({ port, token: 'tok', pid: 1, startedAt: '' }))
    const r = await run(home, { hook_event_name: 'Stop', session_id: 'abc' })
    expect(r.status).toBe(0)
    expect(r.stdout).toBe('')
    // Bounded well below vitest's own test timeout: proves some internal timeout fired rather
    // than the request hanging indefinitely.
    expect(r.ms).toBeGreaterThanOrEqual(500)
    expect(r.ms).toBeLessThan(await base() + 1000)
    // The client already gave up and exited, but our own accepted-and-ignored socket is still
    // open from this server's point of view — destroy it first or server.close()'s callback
    // (which waits for every connection to end) never fires.
    for (const s of sockets) s.destroy()
    await new Promise<void>((r2) => server.close(() => r2()))
  })

  it('exits within the 800ms hard-stop budget even when stdin never closes', async () => {
    // Nothing is written and stdin is never ended -- unlike every other test here (all of which
    // call child.stdin.end() right away). A blocking readFileSync(0) would freeze the whole
    // process on this input forever, since node never gets a turn to run the hardStop timer; the
    // fix is reading stdin asynchronously so the event loop stays live to service that timer.
    const home = mkdtempSync(join(tmpdir(), 'mw-plugin-'))
    const started = Date.now()
    const child = spawn(process.execPath, [script], { env: { ...process.env, TICKOVER_HOME: home } })
    let stdout = ''
    child.stdout.on('data', (c) => (stdout += c))
    const result = await new Promise<{ status: number | null; ms: number }>((resolvePromise) => {
      child.on('exit', (status) => resolvePromise({ status, ms: Date.now() - started }))
    })
    expect(result.status).toBe(0)
    expect(stdout).toBe('')
    // Bounded near the 800ms hard stop, not vitest's much larger test timeout.
    expect(result.ms).toBeLessThan(await base() + 1000)
  })
})
