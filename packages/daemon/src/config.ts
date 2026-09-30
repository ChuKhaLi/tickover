import { existsSync, readFileSync, writeFileSync, renameSync, chmodSync, unlinkSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
import { SITE } from '@tickover/contract'
import { paths } from './paths.js'

// The developer's own status line as Claude Code stored it. refreshInterval is kept because the
// status line script re-runs a slow wrapped command on the developer's own interval, not ours.
export interface WrappedStatusLine { type: 'command'; command: string; refreshInterval?: number; padding?: number }

export interface Config {
  serverUrl: string
  apiToken: string | null
  installToken: string
  wrappedStatusLine: WrappedStatusLine | null
  daemonBin: string | null
  transcriptWatch: boolean
  // Explicit terminal width override, for a terminal whose width the status line script cannot
  // detect (COLUMNS is unset). null means "detect, else fall back" -- see resolveColumns.
  statusLineColumns: number | null
  // Whether `tickover mods on` added CLAUDE_CODE_ENABLE_FUNCTION_HOOKS to settings.json, so
  // `mods off` removes it only then and never a flag the developer set themselves.
  modsEnabledByTickover: boolean
}

export interface DaemonInfo { port: number; token: string; pid: number; startedAt: string }

// Derived, never typed: this is the value every fresh config.json gets, and a domain we do not
// own here is the defect R137 was written about.
export const DEFAULT_SERVER_URL: string = SITE.API_ORIGIN

function writeAtomic(path: string, content: string): void {
  const tmp = `${path}.tmp-${process.pid}`
  try {
    // Set the mode at creation time (config.json holds the API token) rather than chmod-ing
    // after the fact, so the file is never briefly world/group-readable.
    writeFileSync(tmp, content, { encoding: 'utf8', mode: 0o600 })
    if (process.platform !== 'win32') chmodSync(tmp, 0o600)
    renameSync(tmp, path)
  } catch (err) {
    if (existsSync(tmp)) unlinkSync(tmp)
    throw err
  }
}

function freshConfig(): Config {
  return { serverUrl: DEFAULT_SERVER_URL, apiToken: null, installToken: randomBytes(32).toString('base64url'), wrappedStatusLine: null, daemonBin: null, transcriptWatch: false, statusLineColumns: null, modsEnabledByTickover: false }
}

export function readConfig(home: string): Config {
  const p = paths(home).config
  if (!existsSync(p)) {
    const fresh = freshConfig()
    writeAtomic(p, JSON.stringify(fresh, null, 2))
    return fresh
  }
  let parsed: Partial<Config>
  try {
    parsed = JSON.parse(readFileSync(p, 'utf8')) as Partial<Config>
  } catch {
    // A corrupt config is treated as absent: mint and persist a fresh one rather than throwing
    // out of startDaemon.
    const fresh = freshConfig()
    writeAtomic(p, JSON.stringify(fresh, null, 2))
    return fresh
  }
  const mintedInstallToken = !parsed.installToken
  const config: Config = {
    serverUrl: parsed.serverUrl ?? DEFAULT_SERVER_URL,
    apiToken: parsed.apiToken ?? null,
    installToken: parsed.installToken ?? randomBytes(32).toString('base64url'),
    wrappedStatusLine: parsed.wrappedStatusLine ?? null,
    daemonBin: parsed.daemonBin ?? null,
    transcriptWatch: parsed.transcriptWatch ?? false,
    statusLineColumns: parsed.statusLineColumns ?? null,
    modsEnabledByTickover: parsed.modsEnabledByTickover ?? false,
  }
  // installToken is a secret identity, not a stable default like serverUrl — persist it the
  // moment it's minted so a second read (or another process) doesn't get a different one.
  if (mintedInstallToken) writeAtomic(p, JSON.stringify(config, null, 2))
  return config
}

export function writeConfig(home: string, c: Config): void {
  writeAtomic(paths(home).config, JSON.stringify(c, null, 2))
}

/**
 * Records how to start the daemon again, if nothing has recorded it yet.
 *
 * notify.mjs restarts a dead daemon on SessionStart, but only when `daemonBin` names something to
 * spawn -- and until `tickover register` has run, it names nothing, so the hook's self-heal is a
 * silent no-op and the developer's questions stop forever with no signal. The daemon knows its own
 * entry path, so the first start by any route can close that gap.
 *
 * Never overwrites an existing value: `tickover register` is a deliberate act pointing at a global
 * install, and a daemon started from a temporary location (an npx cache) must not replace it with a
 * path that may not outlive the week. Writes nothing when the value already matches, because a
 * pointless rewrite of the file holding the api token is a pointless chance to corrupt it.
 */
export function ensureDaemonBin(home: string, bin: string): void {
  const config = readConfig(home)
  if (config.daemonBin === bin || config.daemonBin) return
  writeConfig(home, { ...config, daemonBin: bin })
}

export function readDaemonInfo(home: string): DaemonInfo | null {
  const p = paths(home).daemon
  if (!existsSync(p)) return null
  try { return JSON.parse(readFileSync(p, 'utf8')) as DaemonInfo } catch { return null }
}

export function writeDaemonInfo(home: string, d: DaemonInfo): void {
  writeAtomic(paths(home).daemon, JSON.stringify(d))
}

export function removeDaemonInfo(home: string): void {
  const p = paths(home).daemon
  if (existsSync(p)) unlinkSync(p)
}
