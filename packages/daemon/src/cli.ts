process.removeAllListeners('warning')
process.on('warning', (w) => { if (w.name !== 'ExperimentalWarning') console.error(w) })

import { homedir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { resolveHome, ensureHome } from './paths.js'
import { readConfig, writeConfig, readDaemonInfo, removeDaemonInfo, ensureDaemonBin } from './config.js'
import { startDaemon, VERSION } from './daemon.js'
import { ensureDaemon, healthy } from './launch.js'
import { runLoginCli } from './login.js'
import { runPane } from './pane.js'
import { installStatusLine, restoreStatusLine, setMods } from './statusline-install.js'
import { statusReport } from './status-report.js'
import { openInBrowser } from './open-url.js'
import { ServerClient, ServerError } from './server-client.js'

const [, , command = 'help', ...rest] = process.argv
const home = resolveHome()
// Every command below except `version` and the default/help text reads or writes
// config.json/daemon.json under `home` (some, like readConfig in `daemon` and `logout`, before
// startDaemon's own ensureHome would ever run) -- on a brand new machine `home` doesn't exist
// yet, and writeAtomic's tmp-file open would ENOENT. Scoped to just the commands that need it
// rather than every invocation, so `tickover version`/`--help` never creates ~/.tickover as a
// side effect.
const NEEDS_HOME = new Set(['daemon', 'login', 'logout', 'status', 'pane', 'page', 'web', 'register', 'statusline', 'mods', 'stop'])
if (NEEDS_HOME.has(command)) ensureHome(home)
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

// Signal 0 tests for existence without sending anything.
function processAlive(pid: number): boolean {
  try { process.kill(pid, 0); return true } catch (err) { return (err as NodeJS.ErrnoException).code === 'EPERM' }
}

// One line per command: this was a bare list of names, which told a developer nothing about which
// one answers a question.
const USAGE = `usage: tickover <command>

  pane                  answer questions in this terminal (keep it open beside Claude Code)
  page [--print]        open the local answer page in the browser
  status                daemon health and the current question, as JSON
  web [--print]         open your developer page on tickover.dev
  login | logout        sign in with GitHub, or forget the login on this machine
  statusline install --script <path> | restore
                        put Tickover in Claude Code's status line, or put yours back
  mods on | off         turn Claude Code function hooks on, to answer above the prompt
  daemon | stop         run the local daemon, or stop it and keep the hooks from restarting it
  register              record the daemon's path so the hooks can restart it
  version`



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
      const q = (await (await fetch(`http://127.0.0.1:${info.port}/v1/question`, { headers })).json()) as Record<string, unknown>
      console.log(JSON.stringify(statusReport(info.port, health as Record<string, unknown>, q), null, 2))
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
    // Stops the daemon so that it stays stopped: the plugin's hooks restart it from daemonBin on the
    // next prompt, so that is cleared first. What /tickover:uninstall runs, so the model never has
    // to edit config.json (it holds the api token) to do it.
    case 'stop': {
      writeConfig(home, { ...readConfig(home), daemonBin: null })
      const info = readDaemonInfo(home)
      // Killed only once it has answered /v1/health with its own token: a stale daemon.json (a
      // reboot, a crash) can name a pid that now belongs to anything, and on Windows SIGTERM is an
      // immediate termination (whole-branch review I3).
      const running = info !== null && (await healthy(info))
      if (running) {
        try { process.kill(info.pid, 'SIGTERM') } catch { /* already gone */ }
        removeDaemonInfo(home)
        console.log(`daemon stopped (pid ${info.pid}); the hooks will not restart it`)
      } else if (info !== null && processAlive(info.pid)) {
        // Alive but not answering as the daemon: either the pid was reused, or a daemon too busy to
        // answer within 800ms. The record is kept, so a busy daemon is not left running with
        // nothing pointing at it (re-review).
        console.log(`daemon.json names pid ${info.pid}, which did not answer as the daemon, so it was left alone; the hooks will not start a new one`)
      } else {
        if (info) removeDaemonInfo(home)
        console.log('no daemon was running; the hooks will not start one')
      }
      return
    }
    case 'version': case '--version': case '-v': { console.log(VERSION); return }
    case 'register': {
      const bin = fileURLToPath(import.meta.url)
      writeConfig(home, { ...readConfig(home), daemonBin: bin })
      console.log(bin)
      return
    }
    // What /tickover:setup step 5 and /tickover:uninstall step 1 run, so that neither asks the
    // model to open config.json (it holds the api token) or edit settings.json by hand.
    case 'statusline': {
      const sub = rest[0]
      if (sub === 'install') {
        const at = rest.indexOf('--script')
        const script = at === -1 ? undefined : rest[at + 1]
        if (!script) throw new Error('usage: tickover statusline install --script <path to the plugin\'s statusline/statusline.mjs>')
        const r = installStatusLine({ home, script })
        console.log(`status line: ${r.command} (every 3s) in ${r.settingsPath}`)
        console.log(r.wrapped === null ? 'your previous status line: none' : `your previous status line, shown above the Tickover line: ${r.wrapped}`)
        if (r.keptEarlierBackup) console.log('Tickover was already installed here; the earlier backup was kept.')
        return
      }
      if (sub === 'restore') {
        const r = restoreStatusLine({ home })
        if (r.left !== null) console.log(`status line left as it is (${r.left}): it is no longer Tickover's.`)
        else console.log(r.restored === null ? `status line removed from ${r.settingsPath}` : `status line restored: ${r.restored}`)
        return
      }
      throw new Error('usage: tickover statusline install --script <path> | restore')
    }
    case 'mods': {
      const sub = rest[0]
      if (sub !== 'on' && sub !== 'off') throw new Error('usage: tickover mods on | off')
      const r = setMods(sub === 'on', { home })
      console.log({
        'enabled': 'Function hooks (Mods) turned on in settings.json. Start a new Claude Code session to see questions above the prompt.',
        'already-on': 'Function hooks (Mods) were already on; nothing changed.',
        'disabled': 'Function hooks (Mods) turned off again.',
        'not-ours': 'Function hooks (Mods) were turned on before Tickover, so they were left on.',
        'already-off': 'Function hooks (Mods) are already off.',
      }[r])
      return
    }
    case 'help': case '--help': case '-h': console.log(USAGE); return
    // Exit 1: 0.1.1 printed its usage and exited 0 for commands it lacked, so a newer skill run
    // against it "succeeded" at doing nothing (whole-branch review I2).
    default: throw new Error(`unknown command: ${command}\n\n${USAGE}`)
  }
}

main().catch((err) => { console.error(err instanceof Error ? err.message : err); process.exit(1) })
