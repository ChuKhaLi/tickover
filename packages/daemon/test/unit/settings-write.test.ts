import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, readFileSync, mkdirSync, symlinkSync, lstatSync, statSync, chmodSync, readlinkSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ensureHome } from '../../src/paths.js'
import { installStatusLine, restoreStatusLine, setMods } from '../../src/statusline-install.js'

// Audit 2026-10-08 (Lower, C6). Every settings.json write was a temp file renamed over the path:
// on POSIX that dropped the developer's mode (a 0600 file came back 0644 under the default umask)
// and, where settings.json is a symlink into a dotfiles repo, replaced the link with a plain file,
// silently detaching it. Every path here is under a temp dir via CLAUDE_CONFIG_DIR, and the suite
// setup points HOME/USERPROFILE at a temp dir too, so nothing can reach the real ~/.claude (R712).
describe('settings.json is rewritten in place (audit C6)', () => {
  let root: string
  let home: string
  let claudeDir: string
  let dotfiles: string
  let script: string
  let env: Record<string, string | undefined>
  const link = () => join(claudeDir, 'settings.json')
  const target = () => join(dotfiles, 'claude-settings.json')

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'tk-sw-'))
    home = join(root, 'tickover-home')
    ensureHome(home)
    claudeDir = join(root, 'claude-config')
    dotfiles = join(root, 'dotfiles')
    mkdirSync(claudeDir)
    mkdirSync(dotfiles)
    script = join(root, 'statusline.mjs')
    writeFileSync(script, '// plugin status line\n')
    env = { CLAUDE_CONFIG_DIR: claudeDir }
  })
  afterEach(() => { rmSync(root, { recursive: true, force: true }) })

  function linkSettings(content: unknown): void {
    writeFileSync(target(), JSON.stringify(content, null, 2))
    // Windows needs Developer Mode (or admin) for this; measured available on the dev machine.
    symlinkSync(target(), link(), 'file')
  }

  it('writes through a symlinked settings.json to its target and leaves the link a link', () => {
    linkSettings({ model: 'opus' })
    installStatusLine({ home, script, env })
    expect(lstatSync(link()).isSymbolicLink()).toBe(true)
    expect(readlinkSync(link())).toBe(target())
    const written = JSON.parse(readFileSync(target(), 'utf8'))
    expect(written.model).toBe('opus')
    expect(written.statusLine.command).toContain('statusline.mjs')
  })

  it('keeps the link through setMods and restore too, and leaves no temp file beside either', () => {
    linkSettings({ model: 'opus' })
    installStatusLine({ home, script, env })
    setMods(true, { home, env })
    restoreStatusLine({ home, env })
    expect(lstatSync(link()).isSymbolicLink()).toBe(true)
    const written = JSON.parse(readFileSync(target(), 'utf8'))
    expect(written.env).toEqual({ CLAUDE_CODE_ENABLE_FUNCTION_HOOKS: '1' })
    expect(written.statusLine).toBeUndefined()
    expect(readdirSync(dotfiles)).toEqual(['claude-settings.json'])
    expect(readdirSync(claudeDir)).toEqual(['settings.json'])
  })

  it('still writes a plain settings.json, and creates one that did not exist', () => {
    installStatusLine({ home, script, env })
    expect(lstatSync(link()).isFile()).toBe(true)
    writeFileSync(link(), JSON.stringify({ model: 'opus' }))
    setMods(true, { home, env })
    expect(lstatSync(link()).isFile()).toBe(true)
    expect(JSON.parse(readFileSync(link(), 'utf8')).model).toBe('opus')
  })

  // Windows reports every writable file as 0666 whatever chmod was given (measured: chmod 0600 then
  // stat gives 666), so a mode cannot be observed there and this runs on macOS/Linux only.
  it.skipIf(process.platform === 'win32')('keeps the file mode of the original, through a link too', () => {
    // 0640 rather than 0600: a fix that hardcoded 0600 would pass a 0600 fixture.
    writeFileSync(link(), JSON.stringify({ model: 'opus' }))
    chmodSync(link(), 0o640)
    installStatusLine({ home, script, env })
    expect(statSync(link()).mode & 0o777).toBe(0o640)
    rmSync(link())

    linkSettings({ model: 'opus' })
    chmodSync(target(), 0o600)
    setMods(true, { home, env })
    expect(statSync(target()).mode & 0o777).toBe(0o600)
  })
})
