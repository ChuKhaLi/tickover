import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import http from 'node:http'
import { startTestDaemon, type TestDaemon } from '../helpers/daemon.js'

// Audit 2026-10-08 (Lower, C4): same-site CSRF from any 127.0.0.1 port. "Same site" ignores the
// port, so the SameSite=Strict cookie the page logs in with is sent by a page on
// http://127.0.0.1:3000 too -- any local dev server, or anything that can get one served. Before
// this, such a page could POST hooks (forge sessions, burn the serving budget) with the cookie.
// The two gates are a foreign Origin (403) and a body that is not application/json (415): a
// cross-origin page can only send a non-JSON content type without a preflight, and a JSON one
// triggers a preflight this daemon never answers with CORS headers (R918).

const PLUGIN_NOTIFY = fileURLToPath(new URL('../../../plugin/hooks/notify.mjs', import.meta.url))

/** A request with every header exactly as given. undici's fetch would also do, but node:http keeps
 * Host and Origin untouched, which is what an attack from a browser actually sends. */
function raw(t: TestDaemon, path: string, opts: { method?: string; headers?: Record<string, string>; body?: string; host?: string } = {}): Promise<number> {
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: '127.0.0.1', port: t.daemon.port, path, method: opts.method ?? 'GET',
      headers: { host: opts.host ?? `127.0.0.1:${t.daemon.port}`, ...(opts.headers ?? {}) },
    }, (res) => { res.resume(); res.on('end', () => resolve(res.statusCode ?? 0)) })
    req.on('error', reject)
    if (opts.body !== undefined) req.write(opts.body)
    req.end()
  })
}

async function sessions(t: TestDaemon): Promise<number> {
  const r = await fetch(`${t.base}/v1/health`, { headers: t.headers })
  return ((await r.json()) as { sessions: number }).sessions
}

const HOOK = JSON.stringify({ event: 'UserPromptSubmit', session_id: 'forged', tool: 'claude-code' })

describe('daemon refuses same-site cross-origin requests (audit C4)', () => {
  let t: TestDaemon
  let cookie: string
  beforeEach(async () => { t = await startTestDaemon({ loggedOut: true }); cookie = `mw_daemon=${t.daemon.token}` })
  afterEach(async () => { await t.stop() })

  describe('the attack', () => {
    it('403s a JSON POST from another 127.0.0.1 port carrying the login cookie, and records nothing', async () => {
      const status = await raw(t, '/v1/hook', { method: 'POST', body: HOOK, headers: { cookie, origin: 'http://127.0.0.1:3000', 'content-type': 'application/json' } })
      expect(status).toBe(403)
      expect(await sessions(t)).toBe(0)
    })

    it('415s a text/plain POST -- the content type a form or no-cors fetch can send without a preflight', async () => {
      // No Origin at all here, so this is the content-type gate on its own: an Origin check
      // alone would wave this through (old browsers, and privacy settings that strip Origin).
      const status = await raw(t, '/v1/hook', { method: 'POST', body: HOOK, headers: { cookie, 'content-type': 'text/plain' } })
      expect(status).toBe(415)
      expect(await sessions(t)).toBe(0)
    })

    it('415s a POST with no content type and a urlencoded one', async () => {
      expect(await raw(t, '/v1/hook', { method: 'POST', body: HOOK, headers: { cookie } })).toBe(415)
      expect(await raw(t, '/v1/hook', { method: 'POST', body: HOOK, headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' } })).toBe(415)
      expect(await raw(t, '/v1/hook', { method: 'POST', body: HOOK, headers: { cookie, 'content-type': 'multipart/form-data; boundary=x' } })).toBe(415)
      // A JSON look-alike is not JSON.
      expect(await raw(t, '/v1/hook', { method: 'POST', body: HOOK, headers: { cookie, 'content-type': 'application/jsonx' } })).toBe(415)
      expect(await sessions(t)).toBe(0)
    })

    it('415s a bodyless POST to login/start sent as a form', async () => {
      // /v1/login/start reads no body, which is exactly why the gate is on every POST and not
      // only on routes that parse one: a form can still start a device login.
      expect(await raw(t, '/v1/login/start', { method: 'POST', headers: { cookie, 'content-type': 'text/plain' } })).toBe(415)
    })

    it('403s every foreign Origin shape, including ones close to the real one', async () => {
      const port = t.daemon.port
      for (const origin of [
        'http://127.0.0.1:3000',
        `http://127.0.0.1:${port + 1}`,
        'http://localhost:3000',
        `https://127.0.0.1:${port}`,
        `http://127.0.0.1:${port}.evil.example`,
        'http://127.0.0.1',
        'null',
        '',
      ]) {
        const status = await raw(t, '/v1/hook', { method: 'POST', body: HOOK, headers: { cookie, origin, 'content-type': 'application/json' } })
        expect(status, `origin=${JSON.stringify(origin)}`).toBe(403)
      }
      expect(await sessions(t)).toBe(0)
    })

    it('403s a cross-origin GET too, so a credentialed fetch cannot drive status or band', async () => {
      expect(await raw(t, '/v1/question', { headers: { cookie, origin: 'http://127.0.0.1:3000' } })).toBe(403)
      expect(await raw(t, '/', { headers: { cookie, origin: 'http://127.0.0.1:3000' } })).toBe(403)
    })
  })

  describe('every legitimate caller still gets through', () => {
    it('the page: same-origin POST with the cookie, its own Origin and JSON (page.ts post())', async () => {
      const status = await raw(t, '/v1/hook', { method: 'POST', body: HOOK, headers: { cookie, origin: `http://127.0.0.1:${t.daemon.port}`, 'content-type': 'application/json' } })
      expect(status).toBe(204)
      expect(await sessions(t)).toBe(1)
    })

    it('the page opened as localhost:<port>: its Origin matches its Host', async () => {
      const port = t.daemon.port
      const status = await raw(t, '/v1/hook', { method: 'POST', body: HOOK, host: `localhost:${port}`, headers: { cookie, origin: `http://localhost:${port}`, 'content-type': 'application/json' } })
      expect(status).toBe(204)
    })

    it('the page: GET / and its EventSource, which send no Origin on a same-origin GET', async () => {
      expect(await raw(t, '/', { headers: { cookie } })).toBe(200)
      const controller = new AbortController()
      const res = await fetch(`${t.base}/v1/events`, { headers: { cookie }, signal: controller.signal })
      expect(res.status).toBe(200)
      controller.abort()
    })

    it('a JSON content type with parameters or in other case is still JSON', async () => {
      expect(await raw(t, '/v1/hook', { method: 'POST', body: HOOK, headers: { cookie, 'content-type': 'application/json; charset=utf-8' } })).toBe(204)
      expect(await raw(t, '/v1/hook', { method: 'POST', body: HOOK, headers: { cookie, 'content-type': 'Application/JSON' } })).toBe(204)
    })

    it('notify.mjs, the real plugin hook script, records a hook', async () => {
      // Spawned for real, not a copy of its headers: it is the caller every Claude Code turn goes
      // through, and it runs in its own process with its own fetch. Async spawn, because the daemon
      // lives in this process and spawnSync would block it from answering.
      const child = spawn(process.execPath, [PLUGIN_NOTIFY], { env: { ...process.env, TICKOVER_HOME: t.home }, stdio: ['pipe', 'ignore', 'ignore'] })
      child.stdin.end(JSON.stringify({ hook_event_name: 'UserPromptSubmit', session_id: 'real-hook' }))
      const code = await new Promise<number | null>((resolve) => child.on('exit', resolve))
      expect(code).toBe(0)
      expect(await sessions(t)).toBe(1)
    })

    // The callers below build their headers inline in their own packages; each shape is copied
    // with the line it comes from, since those packages cannot start this daemon in their tests.
    it('statusline.mjs (statusline.mjs fetchLine): token header, GET, no content type', async () => {
      const r = await fetch(`${t.base}/v1/status?session_id=x&version=1`, { headers: { 'x-tickover-token': t.daemon.token } })
      expect(r.status).toBe(200)
    })

    it('band.tsx request(), pane.ts, the VS Code DaemonClient and login.ts: token + JSON on every method', async () => {
      const headers = { 'x-tickover-token': t.daemon.token, 'content-type': 'application/json' }
      expect((await fetch(`${t.base}/v1/band?session_id=x`, { headers })).status).toBe(200)
      expect((await fetch(`${t.base}/v1/question`, { headers })).status).toBe(200)
      expect((await fetch(`${t.base}/v1/hook`, { method: 'POST', headers, body: HOOK })).status).toBe(204)
      // A skip of an unknown assignment is 404 from the handler -- past both gates.
      expect((await fetch(`${t.base}/v1/skip`, { method: 'POST', headers, body: JSON.stringify({ assignment_id: '00000000-0000-4000-8000-000000000000' }) })).status).toBe(404)
    })
  })

  // R916 (lane A left it unmeasured): whether Claude Code's $.http.fetch, which band.tsx uses, adds an
  // Origin. A request carrying the daemon token in its header cannot be a cross-origin browser
  // request -- a custom header forces a preflight this daemon never grants -- so it is exempt from
  // the Origin gate, and the band keeps working whatever its fetch sends.
  describe('the header token', () => {
    it('is accepted with any Origin, so the band works if its fetch sends one', async () => {
      const headers = { 'x-tickover-token': t.daemon.token, 'content-type': 'application/json', origin: 'app://claude-code' }
      expect(await raw(t, '/v1/band?session_id=x', { headers })).toBe(200)
      expect(await raw(t, '/v1/hook', { method: 'POST', headers, body: HOOK })).toBe(204)
    })

    it('a wrong header token with a foreign Origin is still refused at the Origin gate', async () => {
      const headers = { 'x-tickover-token': 'not-the-token', 'content-type': 'application/json', origin: 'http://127.0.0.1:3000', cookie }
      expect(await raw(t, '/v1/hook', { method: 'POST', headers, body: HOOK })).toBe(403)
      expect(await sessions(t)).toBe(0)
    })
  })
})
