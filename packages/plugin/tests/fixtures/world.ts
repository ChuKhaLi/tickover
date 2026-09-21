import type { On, RenderElement, RenderInput } from 'claude-code'
import { mock } from 'claude-code/testing'

export const SESSION = { surface: 'terminal', isInteractive: true, cwd: '/work' } as const
export const BENEATH: RenderElement = { type: 'Text', children: ['(the band beneath)'] }

/**
 * The view the daemon composes for the Acme DB question, hand-written here because a hooks-module
 * test cannot import the daemon. `header` and `min_columns` are held to what `composeBand` actually
 * produces by `packages/daemon/test/unit/band-constants.test.ts`: both of the kit's boundary tests
 * are written relative to `QUESTION.min_columns` and follow it anywhere, so changed here alone the
 * fixture stays 18 pass / 0 fail at 40 while the daemon goes on composing 29.
 */
export const QUESTION = {
  state: 'question', assignment_id: '8f0b0f2e-6f6a-4a3a-9c1f-0f1e2d3c4b5a',
  header: 'tickover · Acme DB · $0.50', text: 'Which tagline?', options: ['Postgres, faster', 'Cached DB'], min_columns: 28,
} as const
export const ANSWERED = { state: 'answered', text: 'tickover · ✓ +$0.50 · today 1/10 · balance $0.50' } as const

/** The band above the prompt on a 120-column terminal, a turn running. */
export function above(props: Record<string, unknown> = {}, surface = 'terminal'): RenderInput<'AbovePrompt'> {
  return {
    component: 'AbovePrompt', surface, requestId: 'above-prompt', viewport: { columns: 120, rows: 40 },
    props: { hasSurvey: false, isWorking: true, maxRows: 18, bodyColumns: 120, scroll: { offset: 0, bodyRows: 17 }, view: {}, ...props },
  } as RenderInput<'AbovePrompt'>
}

/**
 * The drive the engine resolves a POSIX-style absolute path against, taken from this file rather
 * than left open. `scripts/test-mod.mjs` spawns `claude plugin test` with `cwd` inside this package,
 * so the process's current drive is the drive this fixture is stored on -- which is what lets the
 * pattern below be exact instead of accepting `Z:/home/dev/.tickover/daemon.json`. On POSIX there
 * is no drive and the group is empty.
 */
// Cast because tsconfig.mod.json compiles with `lib: ["es2023"]` and `types: []` -- neither the DOM
// lib nor @types/node is present, and `ImportMeta.url` is declared in those rather than in the
// language lib. The loader gives this module a real file URL; if that ever stops being true the
// drive comes back empty and every read violates at once, which is loud rather than silent.
const DRIVE = /^\/([A-Za-z]:)\//.exec(new URL((import.meta as unknown as { url: string }).url).pathname)?.[1] ?? ''

/**
 * The daemon's own file, anchored at both ends. `endsWith('/home/dev/.tickover/daemon.json')` also
 * matches `/evil/home/dev/.tickover/daemon.json` -- a path whose head an attacker chooses, which a
 * tail match both serves from the mock and passes in the assertion. On Windows the engine resolves
 * the path before the `fs.read` hook ever sees it (`/home/dev/...` arrives as `F:\home\dev\...`), so
 * the path is normalised to forward slashes first and the drive comes from `DRIVE`; everything after
 * the root is exact.
 */
export const DAEMON_FILE = new RegExp(`^${DRIVE}/home/dev/\\.tickover/daemon\\.json$`)

/**
 * The one port this world serves, written once. The `fs.read` response below hands it to the module
 * and `DAEMON_URL` is built from it, so the pattern cannot drift from the port the module was
 * actually given.
 */
export const DAEMON_PORT = 47321
export const DAEMON_BASE = `http://127.0.0.1:${DAEMON_PORT}`

/**
 * The only URLs the module may reach. The bare prefix `http://127.0.0.1:` was not enough, and
 * neither was narrowing the path alone while leaving the port open: a loopback port is exactly where
 * a local agent, proxy or language server listens, and a GET carrying a file's contents in its query
 * string never needs a body. Measured with the port left open -- a swallowed fetch of
 * `http://127.0.0.1:9/v1/leak?p=<path>` was **18 pass / 0 fail**, while the same probe at `/leak`
 * was caught. The port is pinned here; the exact URLs, query strings and all, are pinned in the
 * privacy test.
 */
export const DAEMON_URL = new RegExp(`^http://127\\.0\\.0\\.1:${DAEMON_PORT}/v1/`)

/**
 * The world beneath the module: a daemon at HOME/.tickover answering from memory, a clock at 0,
 * and the engine's band beneath. Every request the module makes is kept.
 */
export function world(on: On, band: unknown = QUESTION) {
  const clock = mock.clock(on)
  mock.env(on, { HOME: '/home/dev' })
  const requests: { url: string; method: string; body?: string; headers: Record<string, string> }[] = []
  // Every path the module asks for, served or not. On a real machine $.fs.read is not mocked, so
  // what this kit has to detect is the asking, not the answer (spec 5.5, DISCLOSURE.never).
  const reads: string[] = []
  // Spec 5.5's promise, enforced for every test in the kit rather than in the one test that reads
  // `reads` and `requests` back. A leak inside an existing helper adds no new call site, so
  // `validate`'s `calls:` line cannot see it; and most of the kit's tests never look at these two
  // arrays -- the malformed-view test that drives `ui.render`'s catch block, for one -- so a leak on
  // a path only they reach would be recorded and asserted against by nobody. So the moment the
  // module asks for a path or a URL it promised never to ask for, this world stops being a working
  // daemon: the throw names the violation under the failure ("test's fs.read hook was skipped: ..."),
  // and every later read and fetch is refused, so the band cannot draw and most of the file goes red.
  // Both halves are needed: the throw alone is swallowed by the module's own failure containment
  // (every call site is wrapped), and a leak written with its own `.catch` would swallow it too.
  //
  // Corrected in round 4 (R215). "Most of the file goes red" is true, and it is not the same claim
  // as "the test that reaches the leak goes red". The malformed-view test named above is the one
  // place this seal cannot reach: both of its assertions are *absence* assertions -- the prompt
  // keeps what is beneath it, and no claim is sent -- and a sealed world makes both of them more
  // likely to pass. Measured: a swallowed fetch inside `ui.render`'s catch block was **19 pass / 0
  // fail**, recorded here and read back by nobody. That test now asserts `violations` itself, and
  // reddens on the fetch and on a swallowed `fs.read('/etc/passwd')` alike (18 / 1). The seal still
  // does what it was measured to do for every other test: the two are complements, not substitutes.
  const violations: string[] = []
  const violate = (what: string): never => {
    violations.push(what)
    throw new Error(`tickover privacy (spec 5.5 DISCLOSURE.never): ${what}`)
  }
  const toasts: string[] = []
  const state = {
    band,
    down: false,
    // What GET /v1/band answers with. Anything but 200 and 401 is the case the module cached its way
    // past: not a throw, not an auth failure, so neither of its two reset paths fired.
    bandStatus: 200,
    // How long the band beneath takes to answer, in mock-clock milliseconds. Zero by default, so no
    // existing test changes behaviour. A render is not instantaneous on a real terminal: `next(e)`
    // runs every other plugin's AbovePrompt hook against a 10 s host budget, and `$.ui.resolve`
    // precedes it. Setting this makes the render's *duration* visible to a test, which is the only way
    // to catch a freshness window measured from the wrong end of it (R220).
    beneathDelayMs: 0,
    answer: { status: 200, text: JSON.stringify({ accepted: true, reason: 'ok', earned_cents: 50 }) },
  }
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('session.id', () => ({ value: 'session-1' }))
  on('fs.read', ($, e) => {
    reads.push(e.path)
    if (violations.length > 0) violate(`sealed by ${violations[0]}`)
    if (!DAEMON_FILE.test(e.path.replace(/\\/g, '/'))) violate(`read of ${e.path}`)
    return { value: JSON.stringify({ port: DAEMON_PORT, token: 'tok' }) }
  })
  on('http.fetch', ($, e) => {
    // Every header, not just the token: a leak rides in a header it invents as easily as in a body,
    // and a header nothing records is a header nothing can assert about.
    requests.push({ url: e.url, method: e.init?.method ?? 'GET', body: e.init?.body, headers: { ...(e.init?.headers ?? {}) } })
    if (violations.length > 0) violate(`sealed by ${violations[0]}`)
    // Checked before `down`: a daemon that is refusing connections is still the daemon, and a URL
    // that is not the daemon's is a violation whether or not this world would have answered it.
    if (!DAEMON_URL.test(e.url)) violate(`fetch of ${e.url}`)
    if (state.down) return { deny: 'ECONNREFUSED' }
    if (e.url.includes('/v1/band')) return { value: { status: state.bandStatus, ok: state.bandStatus === 200, headers: {}, text: JSON.stringify(state.band) } }
    if (e.url.endsWith('/v1/answer')) return { value: { status: state.answer.status, ok: state.answer.status === 200, headers: {}, text: state.answer.text } }
    return { value: { status: 204, ok: true, headers: {}, text: '' } }
  })
  on('ui.toast', ($, e) => { toasts.push(e.text); return { value: undefined } })
  // Recorded rather than merely answered (R219). The module asks for a redraw on every poll while it
  // believes it is drawing, and that request is the whole reason a *missing* render means anything:
  // a steady question never changes, so without it an idle terminal is indistinguishable from a
  // survey holding the band. A hook that answers and keeps nothing leaves that request readable by
  // no test, so dropping it would cost the module its only evidence and turn nothing red.
  const invalidates: string[] = []
  on('ui.invalidate', ($, e) => { invalidates.push(e.event); return { value: undefined } })
  on('ui.render', { component: 'AbovePrompt' }, async () => {
    if (state.beneathDelayMs > 0) await clock.sleep(state.beneathDelayMs)
    return BENEATH
  })
  const bandPolls = () => requests.filter((r) => r.url.includes('/v1/band'))
  return { clock, requests, reads, toasts, state, bandPolls, violations, invalidates }
}
