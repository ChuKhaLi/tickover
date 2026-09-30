import { describe, it, expect, afterEach } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync, readFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { assertFreshBundle } from '../helpers/dist.js'

// The built CLI, because that is what /tickover:setup runs, and its stdout is what lands in the
// developer's transcript.
function cli(args: string[], env: Record<string, string>) {
  return spawnSync(process.execPath, [resolve('dist/cli.js'), ...args], { encoding: 'utf8', env: { ...process.env, ...env } })
}

describe('tickover statusline / mods / help (built CLI)', () => {
  const dirs: string[] = []
  afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }) })

  it('installs and restores without printing the api token', () => {
    assertFreshBundle()
    const root = mkdtempSync(join(tmpdir(), 'tk-cli-sl-')); dirs.push(root)
    const home = join(root, 'home')
    const claude = join(root, 'claude'); mkdirSync(claude)
    mkdirSync(home)
    writeFileSync(join(home, 'config.json'), JSON.stringify({ apiToken: 'secret-api-token' }))
    const old = { type: 'command', command: 'bash ~/.claude/statusline.sh', refreshInterval: 10 }
    writeFileSync(join(claude, 'settings.json'), JSON.stringify({ statusLine: old }))
    const script = join(root, 'statusline.mjs'); writeFileSync(script, '// v1\n')
    const env = { TICKOVER_HOME: home, CLAUDE_CONFIG_DIR: claude }

    const i = cli(['statusline', 'install', '--script', script], env)
    expect(i.status, i.stderr).toBe(0)
    expect(i.stdout + i.stderr).not.toContain('secret-api-token')
    expect(i.stdout).toContain('bash ~/.claude/statusline.sh')
    expect(JSON.parse(readFileSync(join(claude, 'settings.json'), 'utf8')).statusLine.command).toContain('statusline.mjs')

    const r = cli(['statusline', 'restore'], env)
    expect(r.status, r.stderr).toBe(0)
    expect(r.stdout + r.stderr).not.toContain('secret-api-token')
    expect(JSON.parse(readFileSync(join(claude, 'settings.json'), 'utf8')).statusLine).toEqual(old)
  })

  it('fails with a usage line, exit 1, when install has no script', () => {
    assertFreshBundle()
    const root = mkdtempSync(join(tmpdir(), 'tk-cli-sl-')); dirs.push(root)
    const r = cli(['statusline', 'install'], { TICKOVER_HOME: root, CLAUDE_CONFIG_DIR: root })
    expect(r.status).toBe(1)
    expect(r.stderr).toContain('--script')
  })

  it('mods on / off round-trips through settings.json', () => {
    assertFreshBundle()
    const root = mkdtempSync(join(tmpdir(), 'tk-cli-mods-')); dirs.push(root)
    const env = { TICKOVER_HOME: join(root, 'home'), CLAUDE_CONFIG_DIR: root }
    expect(cli(['mods', 'on'], env).stdout).toContain('turned on')
    expect(JSON.parse(readFileSync(join(root, 'settings.json'), 'utf8')).env).toEqual({ CLAUDE_CODE_ENABLE_FUNCTION_HOOKS: '1' })
    expect(cli(['mods', 'off'], env).stdout).toContain('turned off')
    expect(JSON.parse(readFileSync(join(root, 'settings.json'), 'utf8')).env).toBeUndefined()
  })

  // Whole-branch review I2: 0.1.1 answered `tickover stop` -- a command it does not have -- with its
  // usage line and exit 0, so the new uninstall skill "succeeded" at doing nothing. An unknown
  // command is an error; asking for help is not.
  it('exits 1 on a command it does not know, and 0 when asked for help', () => {
    assertFreshBundle()
    const unknown = cli(['no-such-command'], {})
    expect(unknown.status).toBe(1)
    expect(unknown.stderr).toContain('unknown command: no-such-command')
    for (const ask of [[], ['help'], ['--help'], ['-h']]) expect(cli(ask, {}).status, ask.join(' ')).toBe(0)
  })

  it('answers --version and -v like version', () => {
    assertFreshBundle()
    const pkg = JSON.parse(readFileSync(resolve('package.json'), 'utf8')) as { version: string }
    for (const ask of ['version', '--version', '-v']) {
      const r = cli([ask], {})
      expect(r.status, ask).toBe(0)
      expect(r.stdout.trim(), ask).toBe(pkg.version)
    }
  })

  it('help describes the commands, including how to answer', () => {
    assertFreshBundle()
    const r = cli(['help'], {})
    expect(r.stdout).toMatch(/pane\s+answer questions/)
    expect(r.stdout).toMatch(/page \[--print\]\s+open the local answer page/)
  })
})
