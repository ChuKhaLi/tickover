import { describe, it, expect } from 'vitest'
import http from 'node:http'
import type { AddressInfo, Socket } from 'node:net'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DaemonClient } from '../../src/daemon-client.js'

async function fakeDaemon() {
  const seen: string[] = []
  const server = http.createServer((req, res) => {
    seen.push(`${req.method} ${req.url} ${req.headers['x-tickover-token']}`)
    if (req.headers['x-tickover-token'] !== 'tok') { res.writeHead(401); return res.end('{}') }
    if (req.url === '/v1/health') { res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ ok: true })) }
    if (req.url === '/v1/question') { res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ question: null, shown_at: null, balance_pending_cents: 0, balance_available_cents: 0, today_paid_answers: 0, logged_in: true })) }
    if (req.url === '/v1/answer') { res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ accepted: true, reason: 'ok', earned_cents: 50 })) }
    if (req.url === '/v1/events') { res.writeHead(200, { 'content-type': 'text/event-stream' }); res.write('event: question\ndata: {"question":null,"shown_at":null,"balance_pending_cents":5,"balance_available_cents":0,"today_paid_answers":1,"logged_in":true}\n\n'); return }
    res.writeHead(404); res.end()
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  return { port: (server.address() as AddressInfo).port, seen, close: () => new Promise<void>((r) => server.close(() => r())) }
}

// A daemon that can be killed out from under an open SSE connection -- server.close() alone
// waits for open connections to end on their own, which an SSE stream never does, so this tracks
// raw sockets and destroys them directly to simulate the daemon process actually dying.
async function killableDaemon() {
  const sockets = new Set<Socket>()
  const server = http.createServer((req, res) => {
    if (req.headers['x-tickover-token'] !== 'tok') { res.writeHead(401); return res.end('{}') }
    if (req.url === '/v1/health') { res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ ok: true })) }
    if (req.url === '/v1/events') { res.writeHead(200, { 'content-type': 'text/event-stream' }); return } // stays open until killed
    res.writeHead(404); res.end()
  })
  server.on('connection', (socket) => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)) })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  return {
    port: (server.address() as AddressInfo).port,
    kill: () => { for (const s of sockets) s.destroy() },
    close: () => new Promise<void>((r) => server.close(() => r())),
  }
}

describe('DaemonClient', () => {
  it('reads daemon.json, sends the token, answers, and receives events', async () => {
    const d = await fakeDaemon()
    const home = mkdtempSync(join(tmpdir(), 'mw-vs-'))
    writeFileSync(join(home, 'daemon.json'), JSON.stringify({ port: d.port, token: 'tok', pid: 1, startedAt: '' }))
    const c = new DaemonClient(home)
    expect(await c.connect()).toBe(true)
    expect((await c.question())?.logged_in).toBe(true)
    expect((await c.answer('8f0b0f2e-6f6a-4a3a-9c1f-0f1e2d3c4b5a', 1)).earned_cents).toBe(50)
    const got = await new Promise<number>((resolve) => { const un = c.subscribe((v) => { un(); resolve(v.balance_pending_cents) }, () => {}) })
    expect(got).toBe(5)
    expect(d.seen[0]).toContain('tok')
    await d.close()
  })
  it('reports disconnected without daemon.json', async () => {
    const c = new DaemonClient(mkdtempSync(join(tmpdir(), 'mw-vs-')))
    expect(await c.connect()).toBe(false)
    expect(await c.question()).toBeNull()
  })
  it('reports onDisconnect when the SSE connection dies, and never after a deliberate unsubscribe', async () => {
    const d = await killableDaemon()
    const home = mkdtempSync(join(tmpdir(), 'mw-vs-'))
    writeFileSync(join(home, 'daemon.json'), JSON.stringify({ port: d.port, token: 'tok', pid: 1, startedAt: '' }))
    const c = new DaemonClient(home)
    expect(await c.connect()).toBe(true)

    let disconnects = 0
    const unsubscribe = c.subscribe(() => {}, () => {}, () => { disconnects++ })
    await new Promise((r) => setTimeout(r, 50)) // let the SSE request actually connect first
    d.kill() // simulate the daemon process dying out from under the open stream
    await new Promise((r) => setTimeout(r, 50))
    expect(disconnects).toBe(1)

    // A caller-initiated teardown after the fact must not also be reported as a lost connection.
    unsubscribe()
    await new Promise((r) => setTimeout(r, 20))
    expect(disconnects).toBe(1)

    await d.close()
  })
})
