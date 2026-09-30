import { spawn } from 'node:child_process'
import { openSync, closeSync, unlinkSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { readDaemonInfo, type DaemonInfo } from './config.js'
import { VERSION } from './version.js'

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

export async function healthy(info: DaemonInfo, fetchFn: typeof fetch = fetch): Promise<boolean> {
  try {
    const res = await fetchFn(`http://127.0.0.1:${info.port}/v1/health`, { headers: { 'x-tickover-token': info.token }, signal: AbortSignal.timeout(800) })
    return res.ok
  } catch { return false }
}

// Exclusive spawn lock (round1 finding I3): without it, two `ensureDaemon` calls racing on a cold
// machine both pass the `readDaemonInfo`/`healthy` check before either has written `daemon.json`,
// and both spawn -- orphaning a second daemon on its own port until its own 30-minute idle timer.
// `wx` is exclusive-create: it fails with EEXIST if the file already exists, which is the one
// atomic primitive this needs (a plain existsSync-then-writeFileSync has the same race it's meant
// to close).
function tryAcquireLock(lockPath: string, staleMs: number): boolean {
  try {
    closeSync(openSync(lockPath, 'wx'))
    return true
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err
    // Someone else holds the lock. If it's older than the wait window any holder would have used,
    // its owner is gone (crashed, or killed) without ever releasing it -- reclaim it rather than
    // waiting forever behind a lock nobody is coming back for.
    try {
      if (Date.now() - statSync(lockPath).mtimeMs > staleMs) {
        unlinkSync(lockPath)
        return tryAcquireLock(lockPath, staleMs)
      }
    } catch {
      // The lock vanished between our failed open and this stat (the real owner released it just
      // now) -- try again once rather than reporting a loss that's already stale itself.
      return tryAcquireLock(lockPath, staleMs)
    }
    return false
  }
}

function releaseLock(lockPath: string): void {
  try { unlinkSync(lockPath) } catch { /* already gone -- nothing to release */ }
}

// The version a healthy daemon reports, '' when it reports none (a stub), null when it is not
// healthy at all.
async function healthVersion(info: DaemonInfo, fetchFn: typeof fetch = fetch): Promise<string | null> {
  try {
    const res = await fetchFn(`http://127.0.0.1:${info.port}/v1/health`, { headers: { 'x-tickover-token': info.token }, signal: AbortSignal.timeout(800) })
    if (!res.ok) return null
    const body = (await res.json().catch(() => ({}))) as { version?: unknown }
    return typeof body.version === 'string' ? body.version : ''
  } catch { return null }
}

export async function ensureDaemon(home: string, opts: { cliPath?: string; fetchFn?: typeof fetch; waitMs?: number; expectVersion?: string } = {}): Promise<DaemonInfo> {
  const existing = readDaemonInfo(home)
  const running = existing ? await healthVersion(existing, opts.fetchFn) : null
  const expected = opts.expectVersion ?? VERSION
  if (existing && running !== null) {
    if (running === '' || running === expected) return existing
    // A daemon of another version: setup installs a new CLI while Claude Code's status line keeps
    // the old daemon busy, so it never idles out, and the new CLI's commands would be served by
    // old code -- after R710, an old daemon asking the server for routes that are gone (review I2,
    // reproduced with the published 0.1.2). It answered /v1/health with its token just now, so the
    // pid is the daemon's; it is replaced by one of this CLI's own below.
    try { process.kill(existing.pid, 'SIGTERM') } catch { /* already gone */ }
  }

  const waitMs = opts.waitMs ?? 5000
  const lockPath = join(home, 'daemon.lock')
  // Whoever loses the lock race doesn't spawn, but still waits below exactly as if it had --
  // the lock only prevents a second spawn, not a second waiter for the winner's daemon.
  const gotLock = tryAcquireLock(lockPath, waitMs)
  if (gotLock) {
    const cli = opts.cliPath ?? fileURLToPath(import.meta.url)
    const child = spawn(process.execPath, ['--no-warnings=ExperimentalWarning', cli, 'daemon'], {
      detached: true, stdio: 'ignore', env: { ...process.env, TICKOVER_HOME: home }, windowsHide: true,
    })
    child.unref()
  }
  try {
    const deadline = Date.now() + waitMs
    while (Date.now() < deadline) {
      await sleep(150)
      const info = readDaemonInfo(home)
      // The version is checked here too: while one of this CLI's daemons is starting, a hook can
      // start an older one from daemonBin, and whichever writes daemon.json first would otherwise be
      // accepted (re-review N4). A mismatch keeps waiting for the one spawned above.
      if (info && info.pid !== existing?.pid) {
        const v = await healthVersion(info, opts.fetchFn)
        if (v !== null && (v === '' || v === expected)) return info
      }
    }
    throw new Error('daemon did not start')
  } finally {
    // Released once daemon.json is readable (the return above) or the wait fails (the throw
    // above) -- never held by a caller that lost the race in the first place.
    if (gotLock) releaseLock(lockPath)
  }
}
