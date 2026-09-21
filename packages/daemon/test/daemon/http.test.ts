import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import net from 'node:net'
import { startTestDaemon, type TestDaemon } from '../helpers/daemon.js'
import { readDaemonInfo } from '../../src/config.js'
import { requestWithHost } from '../helpers/host-header.js'

// A genuinely missing Host header can't be produced via http.request even with
// req.removeHeader('host'): Node's own HTTP server enforces RFC 7230 §5.4 for HTTP/1.1 and
// returns its own 400 *before* our request listener ever runs (verified: the listener is never
// invoked). That check doesn't apply to HTTP/1.0, so a raw socket sending an HTTP/1.0 request
// line is the only way to reach our own Host guard with req.headers.host actually undefined.
function requestMissingHost(url: string, headers: Record<string, string>): Promise<{ status: number }> {
  const u = new URL(url)
  return new Promise((resolve, reject) => {
    const sock = net.connect(Number(u.port), u.hostname, () => {
      const lines = Object.entries(headers).map(([k, v]) => `${k}: ${v}`).join('\r\n')
      sock.write(`GET ${u.pathname} HTTP/1.0\r\n${lines}\r\n\r\n`)
    })
    let buf = ''
    sock.on('data', (d) => { buf += d.toString() })
    sock.on('end', () => {
      const match = /^HTTP\/\d\.\d (\d+)/.exec(buf)
      resolve({ status: match ? Number(match[1]) : 0 })
    })
    sock.on('error', reject)
  })
}

describe('local http', () => {
  let t: TestDaemon
  // "writes daemon.json and answers health with the token" below asserts loggedIn: false, which
  // is what startTestDaemon gave every caller before Task 7 made "logged in with api-token-1" the
  // default; opt this file back out since it isn't testing the question loop.
  beforeAll(async () => { t = await startTestDaemon({ loggedOut: true }) })
  afterAll(async () => { await t.stop() })

  it('writes daemon.json and answers health with the token', async () => {
    const info = readDaemonInfo(t.home)
    expect(info).toMatchObject({ port: t.daemon.port, token: t.daemon.token })
    const res = await fetch(`${t.base}/v1/health`, { headers: t.headers })
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ ok: true, loggedIn: false, sessions: 0 })
  })

  it('rejects a missing token and a wrong token', async () => {
    expect((await fetch(`${t.base}/v1/health`)).status).toBe(401)
    expect((await fetch(`${t.base}/v1/health`, { headers: { 'x-tickover-token': 'nope' } })).status).toBe(401)
  })

  // Pinning "the gate fires when deleted" isn't enough — these cases pin its shape. Each one is
  // a plausible refactor slip that would still leave a naive test (or the gate's absence) green:
  // a prefix match instead of exact ('127.0.0.1.evil.example' contains '127.0.0.1' and is a host
  // an attacker can really register), a hostname-only compare (drops the port), `host &&
  // !allowed.has(host)` (fails open on a missing/empty Host), and a substring/`includes` check
  // (accepts 'localhost.evil.example'). The positive control matters too: `localhost:<port>` is
  // in the allow-set but nothing else in this file ever sends it (base is built from 127.0.0.1),
  // so deleting that allow-set entry would otherwise stay green.
  it('rejects Host headers that fail the allow-set for any reason, and accepts the real ones', async () => {
    const port = t.daemon.port
    const rejected = [
      'evil.example:80',
      `127.0.0.1.evil.example:${port}`,
      `localhost.evil.example:${port}`,
      `127.0.0.1:${port + 1}`,
    ]
    for (const host of rejected) {
      expect((await requestWithHost(`${t.base}/v1/health`, host, t.headers)).status, `host=${JSON.stringify(host)}`).toBe(421)
    }
    expect((await requestMissingHost(`${t.base}/v1/health`, t.headers)).status).toBe(421)
    // Positive control: localhost:<port> is a real, allowed Host (the URL Task 10's page opens
    // as) that no other request in this file ever exercises.
    expect((await requestWithHost(`${t.base}/v1/health`, `localhost:${port}`, t.headers)).status).toBe(200)
  })

  it('accepts the token as a cookie', async () => {
    const res = await fetch(`${t.base}/v1/health`, { headers: { cookie: `mw_daemon=${t.daemon.token}` } })
    expect(res.status).toBe(200)
  })

  // The `/` route used to carry its own two copies of the auth decision, separate from the
  // shared one every /v1/* route used — three copies of the same security-relevant comparison in
  // one file, with no test touching any of them. This exercises all three cases.
  it('logs in via /?t=<token>, serves the page with the resulting cookie, and 401s bare', async () => {
    const redirect = await fetch(`${t.base}/?t=${t.daemon.token}`, { redirect: 'manual' })
    expect(redirect.status).toBe(302)
    expect(redirect.headers.get('set-cookie')).toContain(`mw_daemon=${t.daemon.token}`)

    const withCookie = await fetch(`${t.base}/`, { headers: { cookie: `mw_daemon=${t.daemon.token}` } })
    expect(withCookie.status).toBe(200)
    expect(await withCookie.text()).toContain('Tickover')

    expect((await fetch(`${t.base}/`)).status).toBe(401)
  })

  it('records hook events and reports sessions', async () => {
    const post = (body: unknown) => fetch(`${t.base}/v1/hook`, { method: 'POST', headers: t.headers, body: JSON.stringify(body) })
    expect((await post({ event: 'SessionStart', session_id: 's1', cwd: 'C:/proj', tool: 'claude-code', tool_version: '2.1.90' })).status).toBe(204)
    await expect((await fetch(`${t.base}/v1/health`, { headers: t.headers })).json()).resolves.toMatchObject({ sessions: 1 })
    expect((await post({ event: 'nonsense', session_id: 's1' })).status).toBe(400)
  })

  it('answers 400 on a malformed body and 413 on an oversize one, instead of 500', async () => {
    const malformed = await fetch(`${t.base}/v1/hook`, { method: 'POST', headers: t.headers, body: 'not json' })
    expect(malformed.status).toBe(400)

    const oversize = await fetch(`${t.base}/v1/hook`, {
      method: 'POST',
      headers: t.headers,
      body: JSON.stringify({ event: 'SessionStart', session_id: 's1', cwd: 'x'.repeat(200_000) }),
    })
    expect(oversize.status).toBe(413)
  })

  it('streams server-sent events', async () => {
    const controller = new AbortController()
    const res = await fetch(`${t.base}/v1/events`, { headers: t.headers, signal: controller.signal })
    expect(res.headers.get('content-type')).toContain('text/event-stream')
    const reader = res.body!.getReader()
    const first = new TextDecoder().decode((await reader.read()).value)
    expect(first).toContain('event: status')
    controller.abort()
  })
})
