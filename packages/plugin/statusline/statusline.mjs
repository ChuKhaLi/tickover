// Tickover status line: prints the wrapped original status line (if any) and one Tickover line.
// On any error this falls back to the original only — a broken daemon must never blank out
// whatever status line the developer already had. The wrapped command and the daemon fetch run
// concurrently, not one after another, so a slow wrapped command can't add its time on top of a
// slow (or hanging) daemon — see the 1000ms budget each gets below.
//
// A wrapped command that cannot finish inside that budget is not dropped: it moves to a background
// run on the developer's own refreshInterval, and the line shows its last result (see "Slow wrapped
// commands" below). This script re-runs itself as that background run, with --refresh-wrapped.
import { readFileSync, existsSync, writeFileSync, renameSync, mkdirSync, openSync, closeSync, statSync, unlinkSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const BACKGROUND = process.argv[2] === '--refresh-wrapped'
let finished = false

// hardStop only: there is nothing at stake in the text (always '' here, since at hard-stop time
// nothing downstream has produced a result yet), so there is no reason to wait for it to flush --
// exit immediately to guarantee the timer's own bound.
function hardExit() {
  if (finished) return
  finished = true
  process.stdout.write('')
  process.exit(0)
}

// A hard bound armed before anything below can block, mirroring notify.mjs's hardStop. Reading
// stdin asynchronously (below) removes the thread-blocking side effect of a stuck read, but
// asynchrony alone adds no time bound of its own — this timer is what actually guarantees an
// exit if stdin (or, in principle, anything else upstream of the two 1000ms-bounded operations)
// never resolves. This reruns on every refreshInterval tick, so a version without this bound
// leaks one indefinitely-running orphaned node process per occurrence for as long as the Claude
// Code session stays open. 1400ms comfortably clears the normal worst case (stdin resolving
// quickly, then the wrapped command and daemon fetch running concurrently, each capped at
// 1000ms) so it should never be what fires against an ordinary slow daemon or wrapped command.
// Not armed for the background run, whose whole point is to outlive this budget; it has its own.
const hardStop = BACKGROUND ? null : setTimeout(hardExit, 1400)
hardStop?.unref?.()

const home = process.env.TICKOVER_HOME ?? join(process.env.HOME ?? process.env.USERPROFILE ?? homedir(), '.tickover')
const readJson = (p) => { try { return existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : null } catch { return null } }

function readStdin() {
  return new Promise((resolve) => {
    let data = ''
    process.stdin.setEncoding('utf8')
    process.stdin.on('data', (c) => { data += c })
    process.stdin.on('end', () => resolve(data))
    process.stdin.on('error', () => resolve(data))
  })
}

// `child.kill()` only signals the immediate process. On Windows with shell:true that's cmd.exe,
// not whatever it spawned underneath (e.g. node.exe for `node -e ...`) -- taskkill's /T walks the
// whole tree. On POSIX, a pipeline or `&&`/`;` chain forks children under the shell that a bare
// kill() of the shell's own pid would leave running -- signalling the negative pid instead
// targets the whole process group, which the child must have been made the leader of (see
// `detached: true` below) for this to reach anything beyond the shell itself.
// NOTE: the POSIX branch is unverified on this development machine (Windows-only); reasoned
// through, not empirically tested here.
function killTree(child) {
  if (!child.pid) { try { child.kill() } catch { /* best effort */ } return }
  if (process.platform === 'win32') {
    try { spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true }) } catch { try { child.kill() } catch { /* best effort */ } }
  } else {
    try { process.kill(-child.pid, 'SIGKILL') } catch { try { child.kill() } catch { /* best effort */ } }
  }
}

// Runs the developer's previous status line command via an async spawn (not spawnSync) so it can
// run concurrently with the daemon fetch below instead of the two summing in series. Resolves
// { out, timedOut }: a timeout is what moves the command to the background run below.
function runWrapped(command, input, timeoutMs) {
  return new Promise((resolvePromise) => {
    let child
    try {
      child = spawn(command, {
        shell: true,
        // The background run is detached and has no console; without this, Windows gives the
        // shell a new, visible console window on every run (whole-branch review C1, captured).
        windowsHide: true,
        // POSIX only: makes the command the leader of its own process group so killTree's
        // negative-pid signal reaches the whole group, not just the shell. Windows has no
        // equivalent here (its tree-kill goes through `taskkill /T` instead).
        ...(process.platform === 'win32' ? {} : { detached: true }),
      })
    } catch { resolvePromise({ out: '', timedOut: false }); return }
    let stdout = ''
    let settled = false
    const timer = setTimeout(() => { killTree(child); done('', true) }, timeoutMs)
    function done(out, timedOut = false) { if (settled) return; settled = true; clearTimeout(timer); resolvePromise({ out, timedOut }) }
    child.stdout.on('data', (c) => { stdout += c })
    child.on('error', () => done(''))
    child.on('close', () => done(stdout.replace(/\s+$/, '')))
    // A wrapped command that never reads its stdin closes that pipe as soon as it exits, and any
    // input larger than the OS pipe buffer (64 KB) is therefore still being written when it does
    // -- an EPIPE/EOF on this stream. With no listener that is an UNCAUGHT error event: exit 1
    // with empty stdout, blanking whatever status line the developer already had, which is the one
    // thing this file's header promises can never happen. The write is best-effort by nature (the
    // command is free to ignore its input), so there is nothing to do but drop it; the wrapped
    // command's own output still arrives via 'close' above. Not reachable at Claude Code's current
    // ~1 KB payload -- but that payload only grows, and the failure is silent when it does.
    child.stdin.on('error', () => {})
    try {
      child.stdin.write(input)
      child.stdin.end()
    } catch { /* the pipe was already gone before we got here -- same best-effort story */ }
  })
}

// Claude Code exports COLUMNS to the status line command and keeps it current across terminal
// resizes (measured 2026-09-06: 189 -> 120 -> 77 -> 46 -> 189 across a live drag). stdout and
// stderr are both pipes here, so process.stdout.columns is undefined and this is the only channel
// carrying the width. Anything that is not a positive integer is dropped rather than forwarded:
// omitting the parameter is the honest signal for "unknown" and lets the daemon apply its own
// documented fallback, whereas forwarding 'NaN' or 0 would be a width this script invented.
function terminalColumns() {
  const raw = process.env.COLUMNS
  if (!raw) return null
  const n = Number(raw)
  return Number.isInteger(n) && n > 0 ? n : null
}

// `tickover status` is the real recovery: ensureDaemon spawns from its own path, so it works even
// when config.daemonBin was never recorded.
const DAEMON_OFF = 'tickover · daemon off · run: tickover status'

// null means "could not reach the daemon" and is deliberately distinct from '' ("reached it, it has
// nothing to show"). The caller decides what to render, because the right answer depends on whether
// the developer has a wrapped status line to fall back to.
async function fetchLine(info, sessionId, version, cols) {
  if (!info || !info.port || !info.token) return null
  try {
    const url = `http://127.0.0.1:${info.port}/v1/status?session_id=${encodeURIComponent(sessionId)}&version=${encodeURIComponent(version)}${cols === null ? '' : `&cols=${cols}`}`
    const res = await fetch(url, { headers: { 'x-tickover-token': info.token }, signal: AbortSignal.timeout(1000) })
    // A non-ok response is usually 401: the port was recycled by a different daemon and the
    // recorded token no longer matches. Unreachable, as far as the developer is concerned.
    return res.ok ? String((await res.json()).line ?? '') : null
  } catch { return null }
}

// ---- Slow wrapped commands --------------------------------------------------------------------
// Captured 2026-09-29: a developer's `bash ~/.claude/statusline.sh` took 2210-3502ms under Git Bash
// on Windows, so the 1000ms budget killed it on every render and the status line they had before
// Tickover simply vanished. Waiting for it instead is no answer: this script repaints every 3s,
// and Claude Code cancels a status line command that is still running when the next update fires.
//
// So a command that misses the budget once is marked slow for the session. From then on each
// render prints its last output from <home>/wrapped/<session>.json, and a detached copy of this
// script re-runs it -- at most one at a time per session, on the developer's own refreshInterval
// rather than ours, with a 15s budget. A command the background run finds fast again goes back to
// running inline. The cost is staleness: a slow line can lag by up to its own interval.
const BACKGROUND_TIMEOUT_MS = 15_000
const FAST_AGAIN_MS = 800
const LOCK_STALE_MS = 30_000
const PRUNE_AFTER_MS = 24 * 60 * 60 * 1000

function wrappedPaths(sessionId) {
  const dir = join(home, 'wrapped')
  const key = sessionId.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 100) || 'no-session'
  return { dir, cache: join(dir, `${key}.json`), input: join(dir, `${key}.in`), lock: join(dir, `${key}.lock`) }
}

function writeAtomic(path, content) {
  const tmp = `${path}.tmp-${process.pid}`
  writeFileSync(tmp, content)
  renameSync(tmp, path)
}

// Exclusive create is the one atomic "only one of us" primitive here; a lock older than any run
// could take belongs to a background run that died, and is taken over.
function takeLock(lock) {
  for (let attempt = 0; attempt < 2; attempt++) {
    try { closeSync(openSync(lock, 'wx')); return true } catch (err) {
      if (err.code !== 'EEXIST') return false
      try { if (Date.now() - statSync(lock).mtimeMs < LOCK_STALE_MS) return false; unlinkSync(lock) } catch { return false }
    }
  }
  return false
}

function startBackground(p, input) {
  try {
    mkdirSync(p.dir, { recursive: true })
    if (!takeLock(p.lock)) return
    writeAtomic(p.input, input)
    const child = spawn(process.execPath, [fileURLToPath(import.meta.url), '--refresh-wrapped', p.cache], {
      detached: true, stdio: 'ignore', windowsHide: true,
    })
    child.unref()
  } catch { /* the last output keeps showing; the next render tries again */ }
}

async function refreshInBackground(cache) {
  const p = { cache, input: cache.replace(/\.json$/, '.in'), lock: cache.replace(/\.json$/, '.lock'), dir: join(cache, '..') }
  try {
    const command = readJson(join(home, 'config.json'))?.wrappedStatusLine?.command
    if (typeof command !== 'string') return
    const started = Date.now()
    const { out, timedOut } = await runWrapped(command, readFileSync(p.input, 'utf8'), BACKGROUND_TIMEOUT_MS)
    const previous = readJson(p.cache)
    // A timeout keeps the last good output rather than blanking the line.
    writeAtomic(p.cache, JSON.stringify({ output: timedOut ? (previous?.output ?? '') : out, at: Date.now(), slow: timedOut || Date.now() - started > FAST_AGAIN_MS }))
    for (const f of readdirSync(p.dir)) {
      const full = join(p.dir, f)
      try { if (Date.now() - statSync(full).mtimeMs > PRUNE_AFTER_MS) unlinkSync(full) } catch { /* in use, or gone */ }
    }
  } catch { /* nothing to report to: this process has no terminal */ } finally {
    // The input is Claude Code's whole status line payload (cwd, transcript path); it is needed
    // only for this run, so it is not left on disk between runs.
    try { unlinkSync(p.input) } catch { /* already gone */ }
    try { unlinkSync(p.lock) } catch { /* already gone */ }
  }
}

if (BACKGROUND) {
  await refreshInBackground(process.argv[3])
  process.exit(0)
}

const raw = await readStdin()
let j = {}
try { j = JSON.parse(raw || '{}') } catch { j = {} }

const config = readJson(join(home, 'config.json'))
const info = readJson(join(home, 'daemon.json'))

// 1000ms each: worst case for the pair together is ~1000ms, not ~2500ms, and a wrapped command
// that hangs can no longer dominate a line meant to repaint every few seconds.
function wrappedLine() {
  const w = config && config.wrappedStatusLine
  if (!w || typeof w.command !== 'string') return Promise.resolve('')
  const p = wrappedPaths(String(j.session_id ?? ''))
  const cached = readJson(p.cache)
  if (cached && cached.slow) {
    // Claude Code runs a command with no refreshInterval on events only; 5s stands in for that.
    const intervalMs = Math.max(Number(w.refreshInterval) || 5, 3) * 1000
    if (Date.now() - (Number(cached.at) || 0) >= intervalMs) startBackground(p, raw)
    return Promise.resolve(typeof cached.output === 'string' ? cached.output : '')
  }
  return runWrapped(w.command, raw, 1000).then(({ out, timedOut }) => {
    if (!timedOut) return out
    // The last good output stays, here as in the background run: writing '' over it lost the
    // developer's line on every render of a command hovering around the budget (review I4).
    const last = cached && typeof cached.output === 'string' ? cached.output : ''
    try { mkdirSync(p.dir, { recursive: true }); writeAtomic(p.cache, JSON.stringify({ output: last, at: 0, slow: true })) } catch { /* retried next render */ }
    startBackground(p, raw)
    return last
  })
}
const wrapped = wrappedLine()

const [original, fetched] = await Promise.all([
  wrapped,
  fetchLine(info, String(j.session_id ?? ''), String(j.version ?? ''), terminalColumns()),
])

// Two rules, and they only conflict when you state them badly:
//   1. An unreachable daemon must never disturb a status line the developer already has. That is
//      this file's header promise, and it is why an error falls back to the original ALONE.
//   2. It must never render nothing at all. Silence is indistinguishable from a broken plugin --
//      observed 2026-09-06, where an unclean daemon exit left a stale daemon.json behind and every
//      failure path collapsed to '', producing a completely blank status line with no diagnostic
//      anywhere. A *missing* daemon.json already said "daemon off", so the worse state gave the
//      less useful output.
// So: say nothing when there is something else to show, and say why when there is not.
const line = fetched === null ? (original ? '' : DAEMON_OFF) : fetched

// Normal completion: stdout to a pipe is asynchronous on POSIX (synchronous on Windows), so an
// immediate process.exit() right after write() can truncate the line before the OS write
// completes -- unlike the hardStop branch above, there is real content here worth not losing.
// Setting exitCode and letting the module end (rather than forcing exit) lets Node drain stdout
// on its own; hardStop is unref'd, so it can't hold the process open once nothing else is
// pending, and the `finished` guard keeps it from firing at all once we reach here.
if (!finished) {
  finished = true
  clearTimeout(hardStop)
  process.exitCode = 0
  process.stdout.write(original && line ? `${original}\n${line}` : original || line)
}
