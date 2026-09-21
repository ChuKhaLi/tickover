import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { startDaemon, type RunningDaemon, type DaemonOptions } from '../../src/daemon.js'
import { ensureHome } from '../../src/paths.js'
import { readConfig, writeConfig } from '../../src/config.js'
import { startFakeServer, type FakeServer } from './fake-server.js'

/**
 * Wraps a `fetch` so that a connection-level failure names its own cause.
 *
 * `TypeError: fetch failed` is what undici raises for every connection failure alike, and the real
 * error is carried on `err.cause`; the reporter is what drops it. Two failures on this branch arrived
 * as exactly that string, with no way to tell ephemeral-port exhaustion (EADDRNOTAVAIL) from a dead
 * pooled socket (ECONNRESET) from a daemon that never started (ECONNREFUSED) -- three different
 * defects behind one message, and the investigation had to proceed by elimination because the error
 * named nothing. The next occurrence names itself.
 *
 * `code` is not always there, which the first version of this got wrong and was caught by the next
 * failure rather than by a test. Measured on this machine: a refused connection carries
 * `cause.message` of "bad port" and **no `code` at all**, while a DNS failure carries ENOTFOUND.
 * Conditioning the whole diagnostic on `code` therefore left it silent on the commonest local shape
 * -- a dead port is exactly the case a torn-down daemon produces -- and two failures printed the bare
 * `TypeError: fetch failed` with the wrapper installed and working. So the cause is named by its
 * `code` when it has one and by its `message` when it does not.
 *
 * It still never swallows: an error with no `cause`, or a cause that names neither, is rethrown
 * exactly as it arrived, because a diagnostic that replaces an unrecognised error with a string of
 * its own hides more than it explains -- `pane.test.ts` throws bare `new Error('ECONNREFUSED')` with
 * no cause at all. Where it does rewrite, the original is kept on `cause`.
 *
 * Three further shapes, each measured and each previously silent: a `cause` that is a **string**
 * (`cause: 'ECONNREFUSED'`) carries neither `.code` nor `.message`; undici can **nest**, putting an
 * empty message on the first cause and the real code one level down; and **wrapping a wrapper**
 * degrades the message to `failed: fetch failed`, because the inner wrapper's own Error becomes the
 * outer's cause. The third is the dangerous one -- it names nothing while still satisfying a loose
 * installation check -- and it is not hypothetical: vitest forks each file today, but this package's
 * config pins neither `pool` nor `isolate`, so turning isolation off would run two setups in one
 * process. Wrapping is therefore idempotent, which holds however that config is later tuned; pinning
 * the knob would defend one configuration and forfeit a speed setting for a guarantee the marker
 * gives unconditionally.
 *
 * This covers the **daemon** suite only. `packages/plugin` has no `setupFiles`, and instrumenting it
 * would wrap nothing -- but the scope has to be stated precisely, because the first version of this
 * comment said "none there" and that is false. `git grep "\bfetch(" -- packages/plugin` returns four
 * hits; the claim that holds is the one `test/setup.ts` makes, scoped to `packages/plugin/test`, which
 * has none. What the four actually are is the load-bearing part: `notify.mjs` and `statusline.mjs` run
 * in spawned children, which keep their own global and are out of reach of a test-process patch;
 * `band.tsx` uses `$.http.fetch`, which the kit mocks and which opens no socket; and the fourth is
 * inside a comment. So there is nothing in that package a wrapper installed here could ever see.
 */
const DIAGNOSED = Symbol.for('tickover.fetch-diagnostics')

/**
 * The shortest true name for a cause: its `code`, else its own `message`, else whatever the cause it
 * carries is called. Bounded at two levels because a cause chain can be circular, and because a name
 * three links from the error is no longer describing this failure.
 */
function nameCause(cause: unknown, depth = 0): string | null {
  if (typeof cause === 'string') return cause === '' ? null : cause
  if (typeof cause !== 'object' || cause === null) return null
  const c = cause as { code?: unknown; message?: unknown; cause?: unknown }
  if (typeof c.code === 'string' && c.code !== '') return c.code
  if (typeof c.message === 'string' && c.message !== '') return c.message
  return depth < 2 ? nameCause(c.cause, depth + 1) : null
}

export function withFetchDiagnostics(inner: typeof fetch): typeof fetch {
  // `as unknown as` rather than a direct cast: TS2352 refuses `typeof fetch` -> `Record<symbol, ...>`
  // because the two do not overlap, and says so. The return below already needed the same form.
  if ((inner as unknown as Record<symbol, unknown>)[DIAGNOSED] === true) return inner
  const wrapped = async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    try {
      return await inner(input, init)
    } catch (err) {
      const detail = nameCause((err as { cause?: unknown } | null)?.cause)
      if (detail === null) throw err
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : (input as Request).url
      throw Object.assign(new Error(`fetch ${url} failed: ${detail}`), { cause: err })
    }
  }
  return Object.assign(wrapped, { [DIAGNOSED]: true }) as unknown as typeof fetch
}

export class FakeClock {
  constructor(public now: Date) {}
  advanceMs(ms: number): void { this.now = new Date(this.now.getTime() + ms) }
  advanceMinutes(n: number): void { this.advanceMs(n * 60_000) }
}

export interface TestDaemon {
  daemon: RunningDaemon
  home: string
  base: string
  headers: Record<string, string>
  clock: FakeClock
  fake: FakeServer
  stop(): Promise<void>
}

/**
 * Whether `fetch` will refuse to talk to this port at all, asked of the runtime
 * rather than written down.
 *
 * **This is the whole of P8, and P8 was not a race.** The suite failed roughly one
 * run in fifteen with `fetch http://127.0.0.1:<port>/v1/health failed: bad port`, and
 * the explanation in this file said a dead port is what a torn-down daemon produces.
 * The daemon was not torn down. WHATWG fetch carries a list of blocked ports and
 * refuses them *before connecting* — 2049 is nfs, 6665-6669 are irc — and
 * `startDaemon({ port: 0 })` lets the operating system hand out an ephemeral port
 * that sometimes lands on it. Measured: a fetch to 127.0.0.1:2049, 6669, 1719 or 6000
 * answers "bad port" with nothing listening, while 47321 answers ECONNREFUSED. The
 * two ports the failures actually named were 6669 and 2049.
 *
 * Probed rather than compared against a copy of the list, because the list belongs to
 * the runtime and a copy of it here would be a second source of truth that drifts
 * silently — which is the same argument the palette guards make about the stylesheet.
 * Production never meets this: `PORT_RANGE` is 47321-47330 and none of those are on
 * the list, so only the harness binds a port it did not choose.
 */
export async function fetchRefusesPort(port: number): Promise<boolean> {
  try {
    await fetch(`http://127.0.0.1:${port}/`)
    return false
  } catch (e) {
    return namesBadPort(e)
  }
}

/**
 * Walks the cause chain, because the shape depends on whether the wrapper above is
 * installed — and the first version of this read `e.cause.message` directly, which is
 * right at a bare node prompt and wrong in the suite this lives in. `test/setup.ts`
 * installs `withFetchDiagnostics`, which rethrows as `Error('fetch <url> failed: bad
 * port')` carrying the original underneath, so the phrase moves a level down and
 * gains a prefix. Caught by its own test on the first run, which is the arrangement
 * working rather than a near miss.
 */
function namesBadPort(e: unknown, depth = 0): boolean {
  if (depth > 3 || typeof e !== 'object' || e === null) return false
  const message = (e as { message?: unknown }).message
  if (typeof message === 'string' && (message === 'bad port' || message.endsWith(': bad port'))) return true
  return namesBadPort((e as { cause?: unknown }).cause, depth + 1)
}

export async function startTestDaemon(over: Partial<DaemonOptions> & { loggedOut?: boolean } = {}): Promise<TestDaemon> {
  const home = mkdtempSync(join(tmpdir(), 'mw-home-'))
  const clock = new FakeClock(new Date('2026-09-10T10:00:00.000Z'))
  const fake = await startFakeServer()
  ensureHome(home)
  writeConfig(home, { ...readConfig(home), apiToken: over.loggedOut ? null : 'api-token-1' })
  const { loggedOut: _loggedOut, ...daemonOver } = over
  const opts = { home, port: 0, clock: () => clock.now, serverUrl: fake.url, idleExitMs: 0, tickIntervalMs: 0, ...daemonOver }

  // Rebinding rather than picking a port ourselves: the operating system knows which
  // ones are free and this only rejects the handful it may hand back that `fetch`
  // will not use. Bounded, and it throws rather than running on a port every request
  // in the test would fail against -- a silent fallback here would put the flake back
  // as a mystery, which is what it was for two rounds.
  let daemon = await startDaemon(opts)
  for (let attempt = 0; (await fetchRefusesPort(daemon.port)) && attempt < 8; attempt++) {
    const refused = daemon.port
    await daemon.stop()
    daemon = await startDaemon(opts)
    if (daemon.port === refused) throw new Error(`the daemon rebound the same blocked port ${refused}`)
  }
  if (await fetchRefusesPort(daemon.port)) {
    throw new Error(`could not get a port fetch will use; last was ${daemon.port}`)
  }

  const base = `http://127.0.0.1:${daemon.port}`
  return {
    daemon, home, base, clock, fake,
    headers: { 'x-tickover-token': daemon.token, 'content-type': 'application/json' },
    async stop() { await daemon.stop(); await fake.close(); rmSync(home, { recursive: true, force: true }) },
  }
}
