import { randomBytes } from 'node:crypto'
import type { AddressInfo } from 'node:net'
import { ensureHome, paths } from './paths.js'
import { readConfig, writeDaemonInfo, removeDaemonInfo } from './config.js'
import { State } from './state.js'
import { Log } from './log.js'
import { SseHub } from './events.js'
import { createLocalServer, type LocalHandlers } from './http.js'
import { SessionTracker } from './sessions.js'
import { formatStatusLine, resolveColumns } from '@tickover/contract'
import { ServerClient } from './server-client.js'
import { AnswerQueue } from './answer-queue.js'
import { QuestionLoop } from './question-loop.js'
import { Heartbeat } from './heartbeat.js'
import { IdleWatch } from './idle.js'
import { TranscriptWatcher } from './transcript-watch.js'
import { LoginFlow } from './login.js'
import { composeBand } from './band.js'
import { VERSION } from './version.js'
export { VERSION }
export const PORT_RANGE = Array.from({ length: 10 }, (_, i) => 47321 + i)

export interface DaemonOptions {
  home: string
  serverUrl?: string
  // Where the GitHub device flow is run from this machine (R710). Tests point it at their fake;
  // nothing else sets it, and there is deliberately no environment variable for it.
  githubUrl?: string
  port?: number
  clock?: () => Date
  fetchFn?: typeof fetch
  idleExitMs?: number
  tickIntervalMs?: number
  heartbeatIntervalMs?: number
  // Off unless config asks for it (Spike B: hooks fire inside the VS Code extension panel, so
  // this fallback stays opt-in) -- see cli.ts, which sources it from config.transcriptWatch.
  transcriptWatch?: { root: string; silenceMs?: number } | null
  // Tests provide this so idle exit is observable without actually killing the test process; the
  // real CLI leaves it unset and gets the stop()-then-process.exit(0) default below.
  onIdle?: () => void
}

export interface RunningDaemon {
  port: number
  token: string
  sessions: SessionTracker
  loop: QuestionLoop
  heartbeat: Heartbeat
  idle: IdleWatch
  /** One pass of everything the interval does, awaitable. Exposed so a test can drive the whole
   * composite -- pruning included -- rather than the individual pieces: the defect the prune call
   * closes (whole-branch review I4) lived in the composite and in nothing it calls. */
  tick(): Promise<void>
  stop(): Promise<void>
}

async function listenOnSomePort(
  server: ReturnType<typeof createLocalServer>,
  preferred: number | undefined,
  onListening: (port: number) => void,
): Promise<number> {
  const candidates = preferred === undefined ? PORT_RANGE : [preferred]
  for (const p of candidates) {
    try {
      return await new Promise<number>((resolve, reject) => {
        server.once('error', reject)
        server.listen(p, '127.0.0.1', () => {
          server.off('error', reject)
          const actual = (server.address() as AddressInfo).port
          // Set the shared `port` binding synchronously, in the same tick the socket starts
          // accepting — not after control returns to the caller's `await` — so no request can
          // ever see ctx.port() read the stale value 0 and get a spurious 421.
          onListening(actual)
          resolve(actual)
        })
      })
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EADDRINUSE') throw err
    }
  }
  throw preferred === undefined
    ? new Error(`no free port in range ${PORT_RANGE[0]}-${PORT_RANGE[PORT_RANGE.length - 1]!}`)
    : new Error(`port ${preferred} is already in use`)
}

export async function startDaemon(opts: DaemonOptions): Promise<RunningDaemon> {
  ensureHome(opts.home)
  const p = paths(opts.home)
  const config = readConfig(opts.home)
  const clock = opts.clock ?? (() => new Date())
  const log = new Log(p.log)
  const state = new State(p.db)
  const hub = new SseHub()
  const token = randomBytes(24).toString('base64url')
  const sessions = new SessionTracker(clock, (t) => { state.addTurn(t); log.info('turn', t) })
  let port = 0

  const serverUrl = opts.serverUrl ?? config.serverUrl
  const serverClient = new ServerClient(serverUrl, () => readConfig(opts.home).apiToken, opts.fetchFn ?? fetch)
  // Reads config fresh on every call (rather than the `config` snapshot captured once at
  // startup) so a real login landing after startup (Task 9) is reflected everywhere immediately.
  const loggedIn = () => readConfig(opts.home).apiToken !== null
  // `loop` is assigned immediately below, before control ever returns to the event loop -- the
  // callback itself is only ever invoked later, asynchronously, from inside a flush() pass, by
  // which point `loop` is always set. This is what lets QuestionLoop register itself as
  // AnswerQueue's `onResolved` callback "at construction" (round3) despite needing the queue as
  // one of its own constructor dependencies.
  let loop: QuestionLoop
  const queue = new AnswerQueue(state, serverClient, clock, log, (result) => loop.handleFlushResult(result))
  loop = new QuestionLoop({ server: serverClient, sessions, state, queue, clock, log, hub, loggedIn })

  const heartbeat = new Heartbeat({ server: serverClient, sessions, state, loop, clock, log, loggedIn, intervalMs: opts.heartbeatIntervalMs })
  const login = new LoginFlow(serverClient, opts.home, loop, log, opts.githubUrl, opts.fetchFn ?? fetch, clock)
  // `running` is assigned once, in the return statement below, before startDaemon's caller can
  // ever trigger idle exit -- same forward-reference idiom as `loop` above. Needed so the default
  // onIdle can stop the daemon it's a part of without capturing a half-built object.
  let running: RunningDaemon
  const stopAndExit = async () => { await running.stop(); process.exit(0) }
  const idle = new IdleWatch(sessions, clock, opts.idleExitMs ?? 30 * 60_000, opts.onIdle ?? (() => { void stopAndExit() }))
  const watcher = opts.transcriptWatch
    ? new TranscriptWatcher({ root: opts.transcriptWatch.root, silenceMs: opts.transcriptWatch.silenceMs, onHook: (e) => handlers.hook(e), log })
    : null
  watcher?.start()

  const handlers: LocalHandlers = {
    hook: (e) => {
      sessions.hook(e)
      log.info('hook', e)
      // A new session is exactly when it's worth checking in with the server sooner than the
      // next scheduled interval -- e.g. to pick up a fresh eligibility/balance state promptly.
      if (e.event === 'SessionStart') heartbeat.forceNext()
      hub.broadcast('status', handlers.question())
    },
    status: (sessionId, version, cols) => {
      // The status line polls this every few seconds while Claude Code renders it, which makes it
      // the best liveness signal the daemon has -- better than hooks, which can be hours apart
      // while a developer reads code. touch() only refreshes a session already known; it never
      // opens one, so a poll carrying a stale id cannot resurrect a pruned session.
      if (sessionId) sessions.touch(sessionId)
      if (sessionId && version) sessions.noteVersion(sessionId, version)
      const v = loop.view()
      // Read fresh rather than from the startup snapshot: a developer who sets statusLineColumns
      // should not have to restart the daemon for it to take effect.
      const configured = readConfig(opts.home).statusLineColumns
      const question = loop.current?.question ?? null
      // R204: a band that drew this assignment for this session within BAND_FRESH_MS holds the
      // question, so this session's status line shows the balance instead of the question twice.
      const heldByBand = sessionId !== null && question !== null && sessions.bandHolds(sessionId, question.assignment_id)
      return formatStatusLine({
        maxColumns: resolveColumns({ detected: cols, configured }),
        loggedIn: v.logged_in,
        question: heldByBand ? null : question,
        answered: loop.answered ? { earnedCents: loop.answered.earnedCents } : null,
        todayPaid: v.today_paid_answers,
        pendingCents: v.balance_pending_cents,
        availableCents: v.balance_available_cents,
      })
    },
    band: (sessionId, drawn) => {
      // Band polls are evidence of life like status polls, and like them never open a session.
      if (sessionId) sessions.touch(sessionId)
      const question = loop.current?.question ?? null
      if (sessionId && drawn && question && drawn === question.assignment_id) sessions.claimBand(sessionId, drawn)
      const v = loop.view()
      return composeBand({
        loggedIn: v.logged_in,
        question,
        answered: loop.answered ? { earnedCents: loop.answered.earnedCents } : null,
        todayPaid: v.today_paid_answers,
        pendingCents: v.balance_pending_cents,
        availableCents: v.balance_available_cents,
      })
    },
    question: () => loop.view(),
    answer: (input) => loop.answer(input),
    skip: (id) => loop.skip(id),
    // loggedIn reads live via loop.view() (which itself reads config fresh) rather than the
    // `config` snapshot captured once at startup -- otherwise this would report logged-out
    // forever once a real login (Task 9) lands after startup.
    health: () => ({ ok: true, version: VERSION, loggedIn: loop.view().logged_in, sessions: sessions.count(), activeTurn: sessions.activeTurn() !== null, queuedAnswers: queue.pending() }),
    loginStart: () => login.start(),
    loginStatus: () => login.status(),
  }

  const server = createLocalServer({ token, port: () => port, clock, log, hub, handlers })
  try {
    port = await listenOnSomePort(server, opts.port, (p) => { port = p })
  } catch (err) {
    // The DB handle was opened before we knew the server could bind; don't leak it (and don't
    // leave the file locked, which matters on Windows).
    state.close()
    throw err
  }
  writeDaemonInfo(opts.home, { port, token, pid: process.pid, startedAt: clock().toISOString() })
  log.info('started', { port, version: VERSION, serverUrl: opts.serverUrl ?? config.serverUrl })

  const tick = (): Promise<void> => {
    // First, before anything reads the session map. A session that died without SessionEnd (the
    // terminal window closed, the process killed, a crash, the laptop suspended) is otherwise
    // permanent: sessions.count() never reaches zero, so IdleWatch never fires, the daemon never
    // exits, heartbeats keep leaving the machine, and a paid question can be served to a session
    // nobody is looking at -- burning a study's reservation. prune() existed for exactly this from
    // Task 5 and had no production caller at all until the whole-branch review (I4/X1) found it;
    // Task 5 wrote it and Task 8 built IdleWatch on count() === 0, and neither owned this line.
    // Pruning here rather than just before idle.tick() also stops a dead session contributing its
    // cwd to the heartbeat or its turn to the question loop on the very tick that buries it.
    sessions.prune()
    // Started concurrently and deliberately not awaited before idle runs: next() long-polls for up
    // to RULES.LONG_POLL_SECONDS, and the idle check, the prune above and the heartbeat must not
    // be held hostage to it. The returned promise is for tests, which need a settled point.
    const loopDone = loop.tick().catch((e) => log.error('tick', { message: (e as Error).message }))
    // Heartbeat.tick() already catches and logs its own failures internally (a down server must
    // never crash this interval) -- this .catch is only a backstop against something upstream of
    // that (e.g. a throwing countExtensions or state.unsentTurns()) escaping unexpectedly.
    const heartbeatDone = heartbeat.tick().catch((e) => log.error('heartbeat', { message: (e as Error).message }))
    idle.tick()
    return Promise.all([loopDone, heartbeatDone]).then(() => undefined)
  }

  // tickIntervalMs: 0 disables the interval so tests can drive tick() directly instead of racing
  // a real timer against a fake clock.
  const tickIntervalMs = opts.tickIntervalMs ?? 2000
  const timer = tickIntervalMs === 0 ? null : setInterval(() => { void tick() }, tickIntervalMs)
  timer?.unref()

  running = {
    port, token, sessions, loop, heartbeat, idle, tick,
    async stop() {
      if (timer) clearInterval(timer)
      watcher?.stop()
      // server.close() only stops accepting new connections and waits for in-flight responses
      // to end on their own — an SSE stream never ends by itself, so without this, stop() hangs
      // forever the moment any surface has an /v1/events connection open.
      hub.closeAll()
      const closed = new Promise<void>((resolve) => server.close(() => resolve()))
      server.closeAllConnections()
      await closed
      state.close()
      removeDaemonInfo(opts.home)
      log.info('stopped')
    },
  }
  return running
}
