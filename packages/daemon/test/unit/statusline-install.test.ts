import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ensureHome } from '../../src/paths.js'
import { readConfig, writeConfig } from '../../src/config.js'
import { claudeSettingsPath, installStatusLine, restoreStatusLine, setMods, isTickoverStatusLine } from '../../src/statusline-install.js'

// Step 5 of /tickover:setup used to have the model read ~/.claude/settings.json and
// ~/.tickover/config.json and edit both by hand. Captured 2026-09-29: that puts the api token in
// the transcript (it stayed out on this machine only because a project deny rule blocked the
// read), it ignores CLAUDE_CONFIG_DIR, and it wrote a statusLine pointing into the plugin's
// *versioned* cache directory, which Claude Code deletes 14 days after the plugin updates.
describe('statusline install / restore', () => {
  let root: string
  let home: string
  let claudeDir: string
  let script: string
  let env: Record<string, string | undefined>
  const settingsFile = () => join(claudeDir, 'settings.json')
  const settings = () => JSON.parse(readFileSync(settingsFile(), 'utf8'))
  const writeSettings = (s: unknown) => writeFileSync(settingsFile(), JSON.stringify(s, null, 2))
  const backupFile = () => join(home, 'statusline-backup.json')
  const OLD = { type: 'command' as const, command: 'bash ~/.claude/statusline.sh', padding: 0, refreshInterval: 10 }

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'tk-sl-'))
    home = join(root, 'tickover-home')
    ensureHome(home)
    writeConfig(home, { ...readConfig(home), apiToken: 'secret-api-token' })
    claudeDir = join(root, 'claude-config')
    mkdirSync(claudeDir)
    script = join(root, 'plugin', 'statusline.mjs')
    mkdirSync(join(root, 'plugin'))
    writeFileSync(script, '// the plugin status line v1\n')
    env = { CLAUDE_CONFIG_DIR: claudeDir }
  })
  afterEach(() => { rmSync(root, { recursive: true, force: true }) })

  it('honours CLAUDE_CONFIG_DIR and falls back to ~/.claude', () => {
    expect(claudeSettingsPath({ CLAUDE_CONFIG_DIR: claudeDir })).toBe(join(claudeDir, 'settings.json'))
    // The platform is passed, not taken from the machine running the suite: on Linux and macOS the
    // fallback is HOME, and a bare USERPROFILE there resolved to the runner's own home -- green on
    // the Windows dev machine, red on ubuntu-latest and macos-latest for v0.2.15.
    expect(claudeSettingsPath({ USERPROFILE: 'C:/Users/x' }, 'win32')).toBe(join('C:/Users/x', '.claude', 'settings.json'))
    expect(claudeSettingsPath({ HOME: '/home/x' }, 'darwin')).toBe(join('/home/x', '.claude', 'settings.json'))
  })

  it('backs up and wraps an existing status line, and points at a stable copy of the script', () => {
    writeSettings({ model: 'opus', statusLine: OLD, env: { A: '1' } })
    const r = installStatusLine({ home, script, env })
    const s = settings()
    expect(s.model).toBe('opus')
    expect(s.env).toEqual({ A: '1' })
    const copy = join(home, 'statusline.mjs')
    expect(readFileSync(copy, 'utf8')).toBe('// the plugin status line v1\n')
    expect(s.statusLine.type).toBe('command')
    expect(s.statusLine.command).toBe(`node "${copy.replace(/\\/g, '/')}"`)
    expect(s.statusLine.command).not.toMatch(/plugins[\\/]cache/)
    expect(s.statusLine.refreshInterval).toBe(3)
    expect(JSON.parse(readFileSync(backupFile(), 'utf8'))).toEqual(OLD)
    expect(readConfig(home).wrappedStatusLine).toEqual(OLD)
    expect(r.wrapped).toBe('bash ~/.claude/statusline.sh')
  })

  it('never puts the api token in what it reports', () => {
    writeSettings({ statusLine: OLD })
    const r = installStatusLine({ home, script, env })
    expect(JSON.stringify(r)).not.toContain('secret-api-token')
    expect(readConfig(home).apiToken).toBe('secret-api-token')
  })

  it('with no status line, wraps nothing and leaves no backup behind', () => {
    writeFileSync(backupFile(), JSON.stringify({ type: 'command', command: 'stale from an old install' }))
    const r = installStatusLine({ home, script, env })
    expect(existsSync(backupFile())).toBe(false)
    expect(readConfig(home).wrappedStatusLine).toBeNull()
    expect(settings().statusLine.command).toContain('statusline.mjs')
    expect(r.wrapped).toBeNull()
  })

  it('creates settings.json when there is none', () => {
    installStatusLine({ home, script, env })
    expect(settings().statusLine.refreshInterval).toBe(3)
  })

  it('refuses to touch a settings.json it cannot parse', () => {
    writeFileSync(settingsFile(), '{ "model": "opus", }')
    expect(() => installStatusLine({ home, script, env })).toThrow(/settings\.json/)
    expect(readFileSync(settingsFile(), 'utf8')).toBe('{ "model": "opus", }')
  })

  // Re-running /tickover:setup is what the skill itself tells a developer to do after a failure.
  // The old step 5 backed up whatever statusLine it found -- by then Tickover's own -- and wrapped
  // it, so the status line spawned itself.
  it('run twice, keeps the developer\'s original rather than wrapping itself', () => {
    writeSettings({ statusLine: OLD })
    installStatusLine({ home, script, env })
    installStatusLine({ home, script, env })
    expect(readConfig(home).wrappedStatusLine).toEqual(OLD)
    expect(JSON.parse(readFileSync(backupFile(), 'utf8'))).toEqual(OLD)
  })

  it('recognises the plugin-cache status line an older setup wrote as its own', () => {
    expect(isTickoverStatusLine('node "C:/Users/x/.claude/plugins/cache/tickover/tickover/0.1.0/statusline/statusline.mjs"', home)).toBe(true)
    expect(isTickoverStatusLine(`node "${join(home, 'statusline.mjs').replace(/\\/g, '/')}"`, home)).toBe(true)
    expect(isTickoverStatusLine('bash ~/.claude/statusline.sh', home)).toBe(false)
    expect(isTickoverStatusLine('node ~/.claude/statusline.mjs', home)).toBe(false)
  })

  it('upgrading from an older setup keeps its backup instead of wrapping the old cache path', () => {
    writeSettings({ statusLine: { type: 'command', command: 'node "C:/Users/x/.claude/plugins/cache/tickover/tickover/0.1.0/statusline/statusline.mjs"', refreshInterval: 3 } })
    writeFileSync(backupFile(), JSON.stringify(OLD))
    writeConfig(home, { ...readConfig(home), wrappedStatusLine: OLD })
    installStatusLine({ home, script, env })
    expect(readConfig(home).wrappedStatusLine).toEqual(OLD)
    expect(settings().statusLine.command).toContain(home.replace(/\\/g, '/'))
  })

  // Whole-branch review I1, reproduced on the built CLI: a 0.1.0 setup run twice had already backed
  // up and wrapped Tickover's own plugin-cache line. Keeping "the earlier backup" kept that, so the
  // status line still spawned itself, and restore wrote Tickover's line back as the developer's.
  it('treats an earlier backup that is Tickover\'s own line as no backup at all', () => {
    const cacheLine = { type: 'command' as const, command: 'node "C:/Users/x/.claude/plugins/cache/tickover/tickover/0.1.0/statusline/statusline.mjs"', refreshInterval: 3 }
    writeSettings({ statusLine: cacheLine })
    writeFileSync(backupFile(), JSON.stringify(cacheLine))
    writeConfig(home, { ...readConfig(home), wrappedStatusLine: cacheLine })
    const r = installStatusLine({ home, script, env })
    expect(r.wrapped).toBeNull()
    expect(readConfig(home).wrappedStatusLine).toBeNull()
    expect(existsSync(backupFile())).toBe(false)
    restoreStatusLine({ home, env })
    expect(settings().statusLine).toBeUndefined()
  })

  it('restore ignores a backup that is Tickover\'s own line', () => {
    writeSettings({ statusLine: { type: 'command', command: `node "${join(home, 'statusline.mjs').replace(/\\/g, '/')}"` } })
    writeFileSync(backupFile(), JSON.stringify({ type: 'command', command: 'node "C:/Users/x/.claude/plugins/cache/tickover/tickover/0.1.0/statusline/statusline.mjs"' }))
    expect(restoreStatusLine({ home, env }).restored).toBeNull()
    expect(settings().statusLine).toBeUndefined()
  })

  it('does not wrap a status line that is not a command', () => {
    // A `command` field alone does not make it one: only type "command" is run by Claude Code.
    writeSettings({ statusLine: { type: 'static', text: 'hello', command: 'echo not-run' } })
    const r = installStatusLine({ home, script, env })
    expect(r.wrapped).toBeNull()
    expect(readConfig(home).wrappedStatusLine).toBeNull()
    // Still backed up verbatim, so restore puts it back.
    restoreStatusLine({ home, env })
    expect(settings().statusLine).toEqual({ type: 'static', text: 'hello', command: 'echo not-run' })
  })

  it('recognises a copy under the default ~/.tickover even from another home', () => {
    expect(isTickoverStatusLine('node "C:/Users/x/.tickover/statusline.mjs"', home)).toBe(true)
  })

  it('reads a settings.json saved with a byte-order mark', () => {
    writeFileSync(settingsFile(), `\uFEFF${JSON.stringify({ model: 'opus' })}`)
    installStatusLine({ home, script, env })
    expect(settings().model).toBe('opus')
  })

  it('restore with a corrupt backup changes nothing', () => {
    writeSettings({ statusLine: OLD })
    installStatusLine({ home, script, env })
    writeFileSync(backupFile(), '{ not json')
    const before = readFileSync(settingsFile(), 'utf8')
    expect(() => restoreStatusLine({ home, env })).toThrow(/statusline-backup\.json/)
    expect(readFileSync(settingsFile(), 'utf8')).toBe(before)
    expect(readConfig(home).wrappedStatusLine).toEqual(OLD)
  })

  it('restore removes the backup and the slow-line cache with it', () => {
    writeSettings({ statusLine: OLD })
    installStatusLine({ home, script, env })
    mkdirSync(join(home, 'wrapped'))
    writeFileSync(join(home, 'wrapped', 's1.in'), '{"transcript_path":"x"}')
    restoreStatusLine({ home, env })
    expect(existsSync(backupFile())).toBe(false)
    expect(existsSync(join(home, 'wrapped'))).toBe(false)
  })

  // Review, Minor: os.homedir() on Windows ignores HOME, and so does Claude Code, which reads
  // C:\Users\<user>\.claude. Preferring HOME wrote the status line to a file nothing reads.
  it('on Windows, finds ~/.claude under USERPROFILE even when HOME is set elsewhere', () => {
    const p = claudeSettingsPath({ HOME: 'D:/elsewhere', USERPROFILE: 'C:/Users/x' }, 'win32')
    expect(p).toBe(join('C:/Users/x', '.claude', 'settings.json'))
    expect(claudeSettingsPath({ HOME: '/home/x', USERPROFILE: undefined }, 'linux')).toBe(join('/home/x', '.claude', 'settings.json'))
  })

  it('restore puts the original back and removes the copy', () => {
    writeSettings({ model: 'opus', statusLine: OLD })
    installStatusLine({ home, script, env })
    const r = restoreStatusLine({ home, env })
    expect(settings()).toEqual({ model: 'opus', statusLine: OLD })
    expect(existsSync(join(home, 'statusline.mjs'))).toBe(false)
    expect(readConfig(home).wrappedStatusLine).toBeNull()
    expect(r.restored).toBe('bash ~/.claude/statusline.sh')
  })

  it('restore with no original removes the key', () => {
    writeSettings({ model: 'opus' })
    installStatusLine({ home, script, env })
    restoreStatusLine({ home, env })
    expect(settings()).toEqual({ model: 'opus' })
  })

  it('restore leaves a status line the developer has since replaced alone', () => {
    writeSettings({ statusLine: OLD })
    installStatusLine({ home, script, env })
    const theirs = { type: 'command', command: 'starship prompt' }
    writeSettings({ statusLine: theirs })
    const r = restoreStatusLine({ home, env })
    expect(settings().statusLine).toEqual(theirs)
    expect(r.restored).toBeNull()
  })
})

// Function hooks ("Mods") are the only way to answer inside Claude Code; without them a developer
// types the option number as a prompt. Captured 2026-09-29 on 2.1.284: `env` in settings.json turns
// them on (`claude plugin test --help` prints its usage) and without it the build says "hooks
// modules are not turned on in this build yet (early access)". They are early access and switch
// on every plugin's modules, so this is opt-in, and off only undoes what Tickover itself did.
describe('mods on / off', () => {
  let root: string
  let home: string
  let env: Record<string, string | undefined>
  const settingsFile = () => join(root, 'settings.json')
  const settings = () => JSON.parse(readFileSync(settingsFile(), 'utf8'))

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'tk-mods-'))
    home = join(root, 'home')
    ensureHome(home)
    env = { CLAUDE_CONFIG_DIR: root }
    writeFileSync(settingsFile(), JSON.stringify({ env: { KEEP: 'x' } }))
  })
  afterEach(() => { rmSync(root, { recursive: true, force: true }) })

  it('on sets the flag, and off removes only what on added', () => {
    expect(setMods(true, { home, env })).toBe('enabled')
    expect(settings().env).toEqual({ KEEP: 'x', CLAUDE_CODE_ENABLE_FUNCTION_HOOKS: '1' })
    expect(setMods(false, { home, env })).toBe('disabled')
    expect(settings().env).toEqual({ KEEP: 'x' })
  })

  // Review, Minor: off never reset the "ours" mark, so a flag the developer set later was removed by
  // the next off.
  it('forgets that it turned Mods on once it has turned them off', () => {
    setMods(true, { home, env })
    setMods(false, { home, env })
    writeFileSync(settingsFile(), JSON.stringify({ env: { CLAUDE_CODE_ENABLE_FUNCTION_HOOKS: '1' } }))
    expect(setMods(false, { home, env })).toBe('not-ours')
  })

  it('treats a flag set to 0 as off, and turns it on', () => {
    writeFileSync(settingsFile(), JSON.stringify({ env: { CLAUDE_CODE_ENABLE_FUNCTION_HOOKS: '0' } }))
    expect(setMods(true, { home, env })).toBe('enabled')
    expect(settings().env.CLAUDE_CODE_ENABLE_FUNCTION_HOOKS).toBe('1')
  })

  it('leaves a flag the developer set themselves', () => {
    writeFileSync(settingsFile(), JSON.stringify({ env: { CLAUDE_CODE_ENABLE_FUNCTION_HOOKS: '1' } }))
    expect(setMods(true, { home, env })).toBe('already-on')
    expect(setMods(false, { home, env })).toBe('not-ours')
    expect(settings().env).toEqual({ CLAUDE_CODE_ENABLE_FUNCTION_HOOKS: '1' })
  })
})
