import { existsSync, readFileSync, writeFileSync, renameSync, unlinkSync, statSync, rmSync, realpathSync, chmodSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { readConfig, writeConfig, type WrappedStatusLine } from './config.js'

// Everything /tickover:setup step 5 and /tickover:uninstall step 1 used to ask the model to do by
// hand to ~/.claude/settings.json and ~/.tickover/config.json. As a command it never shows the api
// token to anyone, honours CLAUDE_CONFIG_DIR, and cannot wrap its own status line on a re-run.

type Env = Record<string, string | undefined>
type Settings = Record<string, unknown> & { statusLine?: unknown; env?: Record<string, unknown> }

const MODS_FLAG = 'CLAUDE_CODE_ENABLE_FUNCTION_HOOKS'
// A byte-order mark, written as an escape because the character itself is invisible in an editor.
const BOM = new RegExp('^' + String.fromCharCode(0xfeff))
// Short, because the question line should follow the daemon within a few seconds; a slow wrapped
// command is refreshed on its own interval in the background (statusline.mjs), not on this one.
const REFRESH_INTERVAL_S = 3

// On Windows, Claude Code reads C:\Users\<user>\.claude whatever HOME says, as os.homedir() does;
// preferring HOME there wrote the status line to a file nothing reads (whole-branch review, Minor).
export function claudeSettingsPath(env: Env = process.env, platform: NodeJS.Platform = process.platform): string {
  const base = platform === 'win32' ? (env.USERPROFILE ?? homedir()) : (env.HOME ?? homedir())
  return join(env.CLAUDE_CONFIG_DIR || join(base, '.claude'), 'settings.json')
}

/**
 * Whether a status line command is one Tickover wrote: the copy under this Tickover home, one under
 * the default ~/.tickover, or the plugin-cache path that setups before 0.1.2 pointed at.
 */
export function isTickoverStatusLine(command: string, home: string): boolean {
  const norm = (x: string) => x.replace(/\\/g, '/').toLowerCase()
  const c = norm(command)
  return c.includes(norm(join(home, 'statusline.mjs'))) || c.includes('/.tickover/statusline.mjs') || c.includes('/plugins/cache/tickover/')
}

function readSettings(path: string): Settings {
  if (!existsSync(path)) return {}
  // An editor that saves with a byte-order mark leaves valid JSON that JSON.parse refuses.
  const raw = readFileSync(path, 'utf8').replace(BOM, '')
  try {
    const parsed: unknown = JSON.parse(raw)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed as Settings
  } catch { /* reported below */ }
  // Refused rather than repaired: this is the developer's own file and every other key in it is
  // theirs. Overwriting a file we could not read would lose all of them.
  throw new Error(`${path} is not valid JSON, so Tickover will not change it. Fix the file and run the command again.`)
}

function writeFileAtomic(path: string, content: string): void {
  const tmp = `${path}.tmp-${process.pid}`
  try {
    writeFileSync(tmp, content, 'utf8')
    renameSync(tmp, path)
  } catch (err) {
    if (existsSync(tmp)) unlinkSync(tmp)
    throw err
  }
}

/**
 * settings.json is the developer's file, so it is rewritten *in place* (audit C6, R920): through a
 * symlink to the file it names -- a settings.json linked from a dotfiles repo stays linked, where a
 * rename over the path replaced the link with a plain file -- and with the original's mode, which a
 * fresh temp file would otherwise take from the umask (a 0600 file came back 0644). Still a temp
 * file and a rename, beside the real target so the rename never crosses a filesystem.
 */
function writeSettings(path: string, s: Settings): void {
  const real = existsSync(path) ? realpathSync(path) : path
  const mode = existsSync(real) ? statSync(real).mode & 0o7777 : undefined
  const content = `${JSON.stringify(s, null, 2)}\n`
  const tmp = `${real}.tmp-${process.pid}`
  try {
    writeFileSync(tmp, content, 'utf8')
    // chmod rather than writeFileSync's `mode`, which the umask still narrows.
    if (mode !== undefined) chmodSync(tmp, mode)
    renameSync(tmp, real)
  } catch (err) {
    if (existsSync(tmp)) unlinkSync(tmp)
    throw err
  }
}

function commandOf(v: unknown): string | null {
  return v && typeof v === 'object' && typeof (v as { command?: unknown }).command === 'string' ? (v as { command: string }).command : null
}

export interface InstallResult { settingsPath: string; command: string; wrapped: string | null; keptEarlierBackup: boolean }

export function installStatusLine(o: { home: string; script: string; env?: Env }): InstallResult {
  const settingsPath = claudeSettingsPath(o.env)
  const settings = readSettings(settingsPath)
  if (!existsSync(o.script) || !statSync(o.script).isFile()) throw new Error(`status line script not found: ${o.script}`)

  const backupPath = join(o.home, 'statusline-backup.json')
  const current = settings.statusLine
  const currentCommand = commandOf(current)
  const config = readConfig(o.home)
  let wrapped: WrappedStatusLine | null
  let keptEarlierBackup = false
  if (currentCommand !== null && isTickoverStatusLine(currentCommand, o.home)) {
    // Ours already: the developer's original is whatever the earlier install recorded -- unless
    // that is ours too. A 0.1.0 setup run twice backed up and wrapped its own plugin-cache line,
    // and keeping it kept the status line spawning itself (whole-branch review I1).
    const earlier = config.wrappedStatusLine
    if (earlier && !isTickoverStatusLine(earlier.command, o.home)) {
      wrapped = earlier
      keptEarlierBackup = true
    } else {
      wrapped = null
      if (backupIsOurs(backupPath, o.home)) unlinkSync(backupPath)
    }
  } else if (current !== undefined) {
    writeFileAtomic(backupPath, `${JSON.stringify(current, null, 2)}\n`)
    wrapped = currentCommand !== null && (current as { type?: unknown }).type === 'command' ? (current as WrappedStatusLine) : null
  } else {
    // Nothing to restore later: a backup left by an earlier install would put back a status line
    // the developer has since removed.
    if (existsSync(backupPath)) unlinkSync(backupPath)
    wrapped = null
  }

  const copy = join(o.home, 'statusline.mjs')
  writeFileAtomic(copy, readFileSync(o.script, 'utf8'))
  writeConfig(o.home, { ...config, wrappedStatusLine: wrapped })
  const command = `node "${copy.replace(/\\/g, '/')}"`
  writeSettings(settingsPath, { ...settings, statusLine: { type: 'command', command, refreshInterval: REFRESH_INTERVAL_S } })
  return { settingsPath, command, wrapped: wrapped?.command ?? null, keptEarlierBackup }
}

export interface RestoreResult { settingsPath: string; restored: string | null; left: string | null }

export function restoreStatusLine(o: { home: string; env?: Env }): RestoreResult {
  const settingsPath = claudeSettingsPath(o.env)
  const settings = readSettings(settingsPath)
  const currentCommand = commandOf(settings.statusLine)
  const backupPath = join(o.home, 'statusline-backup.json')
  // Read before anything is changed, so a corrupt backup stops the restore with nothing half done.
  const backup = readBackup(backupPath)
  const config = readConfig(o.home)
  writeConfig(o.home, { ...config, wrappedStatusLine: null })

  // Replaced by the developer since setup: theirs now, not ours to overwrite.
  if (currentCommand !== null && !isTickoverStatusLine(currentCommand, o.home)) return { settingsPath, restored: null, left: currentCommand }

  const next: Settings = { ...settings }
  // A backup of Tickover's own line (review I1) is no original: putting it back would leave the
  // developer's status line pointing into a plugin directory Claude Code deletes.
  const original = backup !== undefined && !(commandOf(backup) !== null && isTickoverStatusLine(commandOf(backup) as string, o.home)) ? backup : undefined
  if (original !== undefined) next.statusLine = original
  else delete next.statusLine
  writeSettings(settingsPath, next)
  if (existsSync(backupPath)) unlinkSync(backupPath)
  const copy = join(o.home, 'statusline.mjs')
  if (existsSync(copy)) unlinkSync(copy)
  // The slow-line cache, whose *.in files hold Claude Code's status line payload (statusline.mjs).
  rmSync(join(o.home, 'wrapped'), { recursive: true, force: true })
  return { settingsPath, restored: original === undefined ? null : commandOf(original), left: null }
}

function readBackup(path: string): unknown {
  if (!existsSync(path)) return undefined
  try { return JSON.parse(readFileSync(path, 'utf8').replace(BOM, '')) as unknown } catch {
    throw new Error(`${path} is not valid JSON, so Tickover will not restore from it. Your status line is unchanged; set it back in your Claude Code settings by hand.`)
  }
}

function backupIsOurs(path: string, home: string): boolean {
  if (!existsSync(path)) return false
  try { const c = commandOf(readBackup(path)); return c !== null && isTickoverStatusLine(c, home) } catch { return false }
}

export type ModsResult = 'enabled' | 'already-on' | 'disabled' | 'not-ours' | 'already-off'

export function setMods(on: boolean, o: { home: string; env?: Env }): ModsResult {
  const settingsPath = claudeSettingsPath(o.env)
  const settings = readSettings(settingsPath)
  const env = { ...(settings.env ?? {}) }
  const config = readConfig(o.home)
  if (on) {
    // Only a value that turns them on counts as on: "0" is the developer saying off, and they have
    // just said yes to turning them on.
    if (env[MODS_FLAG] === '1' || env[MODS_FLAG] === 'true') return 'already-on'
    env[MODS_FLAG] = '1'
    writeSettings(settingsPath, { ...settings, env })
    writeConfig(o.home, { ...config, modsEnabledByTickover: true })
    return 'enabled'
  }
  if (env[MODS_FLAG] === undefined) return 'already-off'
  // The developer turned Mods on for their own reasons; uninstalling Tickover must not undo that.
  if (!config.modsEnabledByTickover) return 'not-ours'
  delete env[MODS_FLAG]
  const next: Settings = { ...settings, env }
  if (Object.keys(env).length === 0) delete next.env
  writeSettings(settingsPath, next)
  writeConfig(o.home, { ...config, modsEnabledByTickover: false })
  return 'disabled'
}
