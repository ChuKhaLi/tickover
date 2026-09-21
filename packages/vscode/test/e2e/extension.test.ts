/// <reference types="mocha" />
import * as assert from 'node:assert'
import * as vscode from 'vscode'
import http from 'node:http'
import type { AddressInfo, Socket } from 'node:net'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'

const view = {
  question: { assignment_id: '8f0b0f2e-6f6a-4a3a-9c1f-0f1e2d3c4b5a', kind: 'choice', text: 'Which tagline?', options: ['A', 'B'], context: null, sponsor: 'Acme DB', price_cents: 50, served_at: '', expires_at: '' },
  shown_at: null, balance_pending_cents: 0, balance_available_cents: 0, today_paid_answers: 0, logged_in: true,
}

// Tracks raw sockets so the daemon can be "killed" (simulating a crash) rather than merely
// stopped -- server.close() alone waits for open connections to end on their own, which an SSE
// stream never does on its own.
function fakeDaemon() {
  const sockets = new Set<Socket>()
  const server = http.createServer((req, res) => {
    if (req.url === '/v1/health') { res.writeHead(200, { 'content-type': 'application/json' }); return res.end('{"ok":true}') }
    if (req.url === '/v1/question') { res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify(view)) }
    if (req.url === '/v1/events') { res.writeHead(200, { 'content-type': 'text/event-stream' }); res.write(`event: question\ndata: ${JSON.stringify(view)}\n\n`); return }
    res.writeHead(404); res.end()
  })
  server.on('connection', (socket) => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)) })
  return {
    listen: () => new Promise<number>((r) => server.listen(0, '127.0.0.1', () => r((server.address() as AddressInfo).port))),
    // A real crash stops accepting new connections *and* drops whatever was already open --
    // destroying only the open SSE socket while leaving the server listening would let the
    // extension's next retry tick "reconnect" to this same still-alive server, which is not
    // what a dead daemon looks like and would mask the very bug this test exists to catch.
    kill: () => { server.close(); for (const s of sockets) s.destroy() },
    close: () => server.close(),
  }
}

suite('tickover extension', () => {
  test('shows the question when a daemon is reachable, notices when it dies, and recovers when a new one appears', async function () {
    this.timeout(60_000)
    // TICKOVER_HOME and TICKOVER_RETRY_MS come from .vscode-test.mjs's `env`, applied when
    // this VS Code process was launched -- see the comment there for why setting them here,
    // after the extension may have already activated via onStartupFinished, is too late.
    const home = process.env.TICKOVER_HOME
    assert.ok(home, 'TICKOVER_HOME must be set by .vscode-test.mjs before VS Code launches')
    const daemonJsonPath = join(home, 'daemon.json')

    const first = fakeDaemon()
    const port1 = await first.listen()
    // The extension's DaemonClient re-reads daemon.json fresh on every connect() attempt, so it
    // is fine that this file does not exist yet at activation -- the periodic retry (every
    // TICKOVER_RETRY_MS, 300ms here) picks it up once it appears.
    writeFileSync(daemonJsonPath, JSON.stringify({ port: port1, token: 'tok', pid: 1, startedAt: '' }))

    const ext = vscode.extensions.getExtension('tickover.tickover-vscode')
    assert.ok(ext, 'extension not found')
    // If the extension is already active (onStartupFinished got there first), this resolves
    // immediately with the existing exports rather than re-running activate() -- which is fine,
    // since it is the same live DaemonClient/StatusBarItem the retry timer is updating.
    const api = (await ext.activate()) as { item: vscode.StatusBarItem }
    await new Promise((r) => setTimeout(r, 1500))
    assert.strictEqual(api.item.text, '$(comment-discussion) Acme DB · $0.50 · Which tagline?')
    assert.strictEqual(api.item.command, 'tickover.answer')

    // Kill the daemon out from under the open SSE connection -- round1 finding: previously
    // nothing told the extension the stream had died, so the status bar froze on stale data
    // until the window was reloaded. It must fall back to the disconnected state on its own.
    first.kill()
    await new Promise((r) => setTimeout(r, 1500))
    assert.strictEqual(api.item.text, '$(comment-discussion) tickover: daemon off')

    // A new daemon comes up on a new port; the retry timer must pick daemon.json back up and
    // reconnect without any manual nudge.
    const second = fakeDaemon()
    const port2 = await second.listen()
    writeFileSync(daemonJsonPath, JSON.stringify({ port: port2, token: 'tok', pid: 2, startedAt: '' }))
    await new Promise((r) => setTimeout(r, 1500))
    assert.strictEqual(api.item.text, '$(comment-discussion) Acme DB · $0.50 · Which tagline?')

    first.close()
    second.close()
  })
})
