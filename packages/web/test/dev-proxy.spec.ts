// @vitest-environment node
//
// The dev proxy is a channel no other test in this package can see: the unit tests
// mock HttpClient, and the production build never runs Vite's dev middleware at all.
// So this spec starts the real dev server the way a developer does — `vite` in a
// child process, reading the real `vite.config.ts` — and puts a request through it.
//
// The bug it guards against: Analog's Nitro plugin mounts a catch-all dev handler on
// its `apiPrefix` inside a non-returning `configureServer` hook, which runs before
// Vite installs `server.proxy`. With the default prefix, every `/api/**` call in
// `pnpm dev` gets Nitro's own 404 and never reaches the NestJS server. It is
// invisible everywhere else: `/webhooks` proxies fine, and `vite preview` proxies
// `/api` fine too, so the symptom reads as a broken API server.
import { spawn, type ChildProcess } from 'node:child_process'
import { createServer as createHttpServer, type Server } from 'node:http'
import { AddressInfo } from 'node:net'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const viteBin = resolve(packageRoot, 'node_modules/vite/bin/vite.js')

// The upstream stub binds an ephemeral port and the spawned dev server is pointed at
// it through `TICKOVER_API_TARGET`. It used to bind 8787 — the port
// `scripts/e2e-up.ps1` gives the API server — so this suite and the local stack could
// not run at the same time. What the default *is* stays pinned, in
// `test/unit/dev-proxy-target.spec.ts`, against the script that has to match it.
const DEV_PORT = 5187

function startUpstream(): Promise<Server> {
  return new Promise((ok, fail) => {
    const server = createHttpServer((req, res) => {
      res.setHeader('content-type', 'application/json')
      res.end(JSON.stringify({ upstream: true, path: req.url }))
    })
    server.once('error', fail)
    // No host argument on purpose: the proxy target below names `localhost`, which
    // resolves to ::1 before 127.0.0.1 on Windows. Binding one family would leave
    // the proxy connecting to nothing.
    server.listen(0, () => ok(server))
  })
}

/** Polls until the dev server answers, or the child dies, or we run out of patience. */
async function waitForDevServer(child: ChildProcess, url: string, timeoutMs: number): Promise<void> {
  let exited: string | null = null
  child.once('exit', (code) => { exited = `vite exited early with code ${code}` })
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (exited) throw new Error(exited)
    try {
      await fetch(url)
      return
    } catch {
      await new Promise((ok) => setTimeout(ok, 250))
    }
  }
  throw new Error(`dev server did not come up within ${timeoutMs}ms`)
}

describe('vite dev server', () => {
  let upstream: Server
  let vite: ChildProcess
  const base = `http://localhost:${DEV_PORT}`

  beforeAll(async () => {
    upstream = await startUpstream()
    // Analog decides it is running under test from `VITEST`/`NODE_ENV` alone
    // (`platform-plugin.js`: `isTest = NODE_ENV === 'test' || !!VITEST`), and a test
    // build compiles against `tsconfig.spec.json` and drops the deps plugin. Inherit
    // vitest's environment and the child is not the dev server developers run.
    const env = { ...process.env }
    delete env['VITEST']
    delete env['VITEST_WORKER_ID']
    delete env['VITEST_POOL_ID']
    if (env['NODE_ENV'] === 'test') delete env['NODE_ENV']
    // The one thing this test changes about the real config. The defect it watches --
    // Nitro's catch-all answering /api before the proxy sees it -- does not depend on
    // which port the proxy points at.
    env['TICKOVER_API_TARGET'] = `http://localhost:${(upstream.address() as AddressInfo).port}`
    vite = spawn(process.execPath, [viteBin, '--port', String(DEV_PORT), '--strictPort'], {
      cwd: packageRoot,
      stdio: ['ignore', 'ignore', 'inherit'],
      env,
    })
    await waitForDevServer(vite, base, 120_000)
  }, 180_000)

  afterAll(async () => {
    vite?.kill()
    await new Promise<void>((ok) => (upstream ? upstream.close(() => ok()) : ok()))
  })

  it('proxies /api to the API server instead of answering it itself', async () => {
    const res = await fetch(`${base}/api/buyer/me`)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ upstream: true, path: '/api/buyer/me' })
  }, 60_000)

  it('proxies /webhooks to the API server', async () => {
    const res = await fetch(`${base}/webhooks/paddle`, { method: 'POST' })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ upstream: true, path: '/webhooks/paddle' })
  }, 60_000)
})
