import { spawn } from 'node:child_process'
import { openSync, closeSync, unlinkSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { readDaemonInfo, type DaemonInfo } from './config.js'

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

export async function ensureDaemon(home: string, opts: { cliPath?: string; fetchFn?: typeof fetch; waitMs?: number } = {}): Promise<DaemonInfo> {
  const existing = readDaemonInfo(home)
  if (existing && (await healthy(existing, opts.fetchFn))) return existing

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
      if (info && info.pid !== existing?.pid && (await healthy(info, opts.fetchFn))) return info
    }
    throw new Error('daemon did not start')
  } finally {
    // Released once daemon.json is readable (the return above) or the wait fails (the throw
    // above) -- never held by a caller that lost the race in the first place.
    if (gotLock) releaseLock(lockPath)
  }
}
