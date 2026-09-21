// Tickover status line: prints the wrapped original status line (if any) and one Tickover line.
// On any error this falls back to the original only — a broken daemon must never blank out
// whatever status line the developer already had. The wrapped command and the daemon fetch run
// concurrently, not one after another, so a slow wrapped command can't add its time on top of a
// slow (or hanging) daemon — see the 1000ms budget each gets below.
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { spawn } from 'node:child_process'

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
const hardStop = setTimeout(hardExit, 1400)
hardStop.unref?.()

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
    try { spawn('taskkill', ['/pid', String(child.pid), '/T', '/F']) } catch { try { child.kill() } catch { /* best effort */ } }
  } else {
    try { process.kill(-child.pid, 'SIGKILL') } catch { try { child.kill() } catch { /* best effort */ } }
  }
}

// Runs the developer's previous status line command via an async spawn (not spawnSync) so it can
// run concurrently with the daemon fetch below instead of the two summing in series.
function runWrapped(command, input, timeoutMs) {
  return new Promise((resolvePromise) => {
    let child
    try {
      child = spawn(command, {
        shell: true,
        // POSIX only: makes the command the leader of its own process group so killTree's
        // negative-pid signal reaches the whole group, not just the shell. Windows has no
        // equivalent here (its tree-kill goes through `taskkill /T` instead).
        ...(process.platform === 'win32' ? {} : { detached: true }),
      })
    } catch { resolvePromise(''); return }
    let stdout = ''
    let settled = false
    const timer = setTimeout(() => { killTree(child); done('') }, timeoutMs)
    function done(result) { if (settled) return; settled = true; clearTimeout(timer); resolvePromise(result) }
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

const raw = await readStdin()
let j = {}
try { j = JSON.parse(raw || '{}') } catch { j = {} }

const config = readJson(join(home, 'config.json'))
const info = readJson(join(home, 'daemon.json'))

// 1000ms each: worst case for the pair together is ~1000ms, not ~2500ms, and a wrapped command
// that hangs can no longer dominate a line meant to repaint every few seconds.
const wrapped = config && config.wrappedStatusLine && typeof config.wrappedStatusLine.command === 'string'
  ? runWrapped(config.wrappedStatusLine.command, raw, 1000)
  : Promise.resolve('')

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
