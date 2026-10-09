import { spawn as nodeSpawn } from 'node:child_process'

interface Child { on(event: 'error', fn: () => void): unknown; unref(): void }
export interface OpenDeps {
  spawn: (cmd: string, args: string[], opts: { detached: true; stdio: 'ignore'; windowsHide: true }) => Child
  platform: NodeJS.Platform
  /** Where a refusal is explained; stderr, so stdout stays just the URL for scripts. */
  warn?: (message: string) => void
}

const defaults: OpenDeps = { spawn: nodeSpawn as unknown as OpenDeps['spawn'], platform: process.platform, warn: (m) => console.error(m) }

/**
 * Best-effort "open this in the developer's browser". Every failure mode -- no opener installed
 * (a bare Linux box, a container), the opener refusing, spawn throwing -- is silent, because the
 * URL has already been printed to stdout by the time this runs and that is the part that matters.
 *
 * On Windows the URL is an argument to `cmd /c start`, and Node does not quote an argument with no
 * spaces, so cmd.exe reads `&`, `|`, `^`, `%` and quotes in it as syntax. `tickover web` opens a URL
 * the server chose, so a compromised or impersonated API origin could run commands (R901; the
 * 2026-10-08 audit ran `whoami` this way). Hence an allowlist of what a real URL here contains --
 * https anywhere, plain http only to the loopback page -- checked on every platform so the rule
 * cannot be lost in a refactor that only one OS runs. A refused URL is still on stdout.
 */
const SAFE_URL = /^(https:\/\/[A-Za-z0-9.-]+(:\d+)?|http:\/\/127\.0\.0\.1:\d+)\/[A-Za-z0-9/?=._~-]*$/

export function openInBrowser(url: string, deps: OpenDeps = defaults): boolean {
  if (!SAFE_URL.test(url)) {
    // Silence here read the same as "no opener installed" (whole-branch review M2).
    ;(deps.warn ?? defaults.warn)!('Not opened automatically: this URL has characters the browser opener does not pass on. Open the URL above yourself.')
    return false
  }
  const [cmd, args] = deps.platform === 'win32'
    ? ['cmd', ['/c', 'start', '', url]]
    : deps.platform === 'darwin'
      ? ['open', [url]]
      : ['xdg-open', [url]]
  try {
    const child = deps.spawn(cmd as string, args as string[], { detached: true, stdio: 'ignore', windowsHide: true })
    child.on('error', () => { /* no opener on this machine -- the printed URL is the fallback */ })
    child.unref()
  } catch { /* same */ }
  return true
}
