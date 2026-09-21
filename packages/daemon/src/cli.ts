process.removeAllListeners('warning')
process.on('warning', (w) => { if (w.name !== 'ExperimentalWarning') console.error(w) })

import { spawn } from 'node:child_process'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { resolveHome, ensureHome } from './paths.js'
import { readConfig, writeConfig, readDaemonInfo, ensureDaemonBin } from './config.js'
import { startDaemon, VERSION } from './daemon.js'
import { ensureDaemon, healthy } from './launch.js'
import { runLoginCli } from './login.js'
import { runPane } from './pane.js'
import { ServerClient, ServerError } from './server-client.js'

const [, , command = 'help', ...rest] = process.argv
const home = resolveHome()
// Every command below except `version` and the default/help text reads or writes
// config.json/daemon.json under `home` (some, like readConfig in `daemon` and `logout`, before
// startDaemon's own ensureHome would ever run) -- on a brand new machine `home` doesn't exist
// yet, and writeAtomic's tmp-file open would ENOENT. Scoped to just the commands that need it
// rather than every invocation, so `tickover version`/`--help` never creates ~/.tickover as a
// side effect.
const NEEDS_HOME = new Set(['daemon', 'login', 'logout', 'status', 'pane', 'page', 'web', 'register'])
if (NEEDS_HOME.has(command)) ensureHome(home)
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

/**
 * Best-effort "open this in the developer's browser". Every failure mode -- no opener installed
 * (a bare Linux box, a container), the opener refusing, spawn throwing -- is silent, because the
 * URL has already been printed to stdout by the time this runs and that is the part that matters.
 *
 * The URL is safe to hand to `cmd /c start`, whose argument parsing would otherwise be an
 * injection surface: every character in it comes from a numeric port and a base64url token
 * ([A-Za-z0-9_-]), and encodeURIComponent covers the token regardless.
 */
function openInBrowser(url: string): void {
  const [cmd, args] = process.platform === 'win32'
    ? ['cmd', ['/c', 'start', '', url]]
    : process.platform === 'darwin'
      ? ['open', [url]]
      : ['xdg-open', [url]]
  try {
    const child = spawn(cmd as string, args as string[], { detached: true, stdio: 'ignore', windowsHide: true })
    child.on('error', () => { /* no opener on this machine -- the printed URL is the fallback */ })
    child.unref()
  } catch { /* same */ }
}


/**
 * What to tell a developer whose `tickover web` did not produce a link.
 *
 * The 401 is deliberately two-sided. `deleteDeveloperAccount` nulls `api_token_hash`, so a
 * revoked token and a closed account arrive here as the same status and this client cannot tell
 * them apart. `tickover login` can: R79 made it answer "This GitHub account cannot be used with
 * Tickover" for a closed account instead of reporting success. So the honest message names both
 * readings and points at the one command that decides between them.
 *
 * A 5xx says nothing about the developer's login, and telling them to re-run the device flow
 * against a server that is already failing would send them to fix something that is not broken.
 *
 * The unreachable case names the URL and the file it comes from. `serverUrl` is read only from
 * config.json -- there is deliberately no environment variable for it -- so a developer who has
 * never opened that file has no way to guess where the address came from.
 */
export function webFailure(err: unknown, serverUrl: string): string {
  if (err instanceof ServerError) {
    if (err.status === 401) {
      return [
        'The server would not accept your saved login. Either it was revoked, or the account is closed.',
        'Run: tickover login — it will say which. A closed account cannot be used with Tickover again.',
      ].join('\n')
    }
    if (err.status === 429) {
      return 'The server asked you to slow down. Wait a minute and try again.'
    }
    if (err.status >= 500) {
      return `The Tickover server could not mint a sign-in link (${err.status}). This one is ours, not yours — your login is fine. Try again shortly.`
    }
    return `The server refused the request (${err.status}). Your login is fine; try again shortly, and report it if it keeps happening.`
  }
  return [
    `Could not reach the Tickover server at ${serverUrl}.`,
    'Check that you are online and that the address is right — it is the serverUrl in your config.json, and nothing else sets it.',
  ].join('\n')
}

async function main(): Promise<void> {
  switch (command) {
    case 'daemon': {
      const existing = readDaemonInfo(home)
      if (existing && (await healthy(existing))) { console.log(`already running on port ${existing.port}`); return }
      // Same path `register` records, and the same one notify.mjs needs to restart us later. Doing
      // it here means a developer who never ran the setup skill still gets a daemon that can be
      // revived by a hook, instead of one that dies once and stays dead.
      ensureDaemonBin(home, fileURLToPath(import.meta.url))
      const config = readConfig(home)
      const d = await startDaemon({ home, transcriptWatch: config.transcriptWatch ? { root: join(homedir(), '.claude', 'projects') } : null })
      console.log(`tickover daemon ${VERSION} on 127.0.0.1:${d.port}`)
      const shutdown = () => d.stop().then(() => process.exit(0)).catch((err: unknown) => { console.error(err); process.exit(1) })
      process.on('SIGINT', shutdown)
      process.on('SIGTERM', shutdown)
      return
    }
    case 'login': return runLoginCli(home, { out: (s) => console.log(s), sleep })
    case 'logout': { writeConfig(home, { ...readConfig(home), apiToken: null }); console.log('logged out'); return }
    case 'status': {
      const info = await ensureDaemon(home)
      const headers = { 'x-tickover-token': info.token }
      const health = await (await fetch(`http://127.0.0.1:${info.port}/v1/health`, { headers })).json()
      const q = await (await fetch(`http://127.0.0.1:${info.port}/v1/question`, { headers })).json()
      console.log(JSON.stringify({ port: info.port, ...health, ...q }, null, 2))
      return
    }
    // The answer page needs the daemon token in its URL (the `/?t=` bootstrap sets the cookie the
    // page is then served against), and `status` deliberately omits the token -- it is the command
    // people paste into issues and scrape for health, so a token in its output would leak by
    // accident. This command exists so there IS a documented way to reach the page: the exposure
    // is deliberate, asked for, and one line long. The setup skill points here.
    case 'page': {
      const info = await ensureDaemon(home)
      const url = `http://127.0.0.1:${info.port}/?t=${encodeURIComponent(info.token)}`
      console.log(url)
      // `--print` skips the browser, for an SSH session, a script, or anywhere a spawned opener
      // would be wrong or unwanted. The URL is on stdout either way.
      if (!rest.includes('--print')) openInBrowser(url)
      return
    }
    // The hosted developer page, as opposed to `page`'s local answer pane. The api token can't be
    // put in the URL -- it is long-lived and would end up in shell history and browser history --
    // so the server trades it for a one-time link, and this command is the only place the trade
    // happens. Talks to the server directly rather than through the daemon: the daemon may not be
    // running, and nothing here needs its state.
    case 'web': {
      const config = readConfig(home)
      if (!config.apiToken) { console.log('Not logged in. Run: tickover login'); return }
      let url: string
      try {
        ;({ url } = await new ServerClient(config.serverUrl, () => config.apiToken).webSession())
      } catch (err) {
        // Everything below exists because this used to be `server 401` or `fetch failed` on
        // stderr and nothing else -- a status code, and the developer's own guess about what to
        // do with it. Each branch says what happened and what to run next; none of them prints
        // a status alone.
        console.error(webFailure(err, config.serverUrl))
        process.exit(1)
      }
      console.log(url)
      if (!rest.includes('--print')) openInBrowser(url)
      return
    }
    case 'pane': return runPane(home, { stdin: process.stdin, stdout: process.stdout })
    case 'version': { console.log(VERSION); return }
    case 'register': {
      const bin = fileURLToPath(import.meta.url)
      writeConfig(home, { ...readConfig(home), daemonBin: bin })
      console.log(bin)
      return
    }
    default: console.log('usage: tickover daemon | login | logout | status | pane | page [--print] | web [--print] | register | version')
  }
}

main().catch((err) => { console.error(err instanceof Error ? err.message : err); process.exit(1) })
