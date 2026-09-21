import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ensureHome } from '../../src/paths.js'
import { readConfig, writeConfig, ensureDaemonBin } from '../../src/config.js'

// Observed 2026-09-06: a developer's hooks could not restart a dead daemon, silently and forever.
// notify.mjs's self-heal is `if (!ok && SessionStart) launch()`, and launch() returns immediately
// when config.daemonBin is unset -- which it is until `tickover register` has been run. The spec
// says SessionStart "spawns the daemon detached if the port file is stale"; that promise only held
// for developers who had completed setup. The daemon knows its own path, so it can record it.
describe('ensureDaemonBin', () => {
  let home: string
  beforeEach(() => { home = mkdtempSync(join(tmpdir(), 'mw-bin-')); ensureHome(home) })
  afterEach(() => { rmSync(home, { recursive: true, force: true }) })

  it('records the path when the config has none', () => {
    expect(readConfig(home).daemonBin).toBeNull()
    ensureDaemonBin(home, 'C:/somewhere/cli.js')
    expect(readConfig(home).daemonBin).toBe('C:/somewhere/cli.js')
  })

  it('leaves a path the developer already set alone', () => {
    // `tickover register` is an explicit act, and the setup skill points it at a global install.
    // A daemon started from a temporary location (an npx cache, say) must not overwrite that with
    // a path that may not survive the week.
    writeConfig(home, { ...readConfig(home), daemonBin: 'C:/chosen/by/the/developer.js' })
    ensureDaemonBin(home, 'C:/some/npx/cache/cli.js')
    expect(readConfig(home).daemonBin).toBe('C:/chosen/by/the/developer.js')
  })

  it('preserves the rest of the config', () => {
    // It rewrites the file, so it must not drop the token that makes the developer identifiable.
    writeConfig(home, { ...readConfig(home), apiToken: 'token-1', serverUrl: 'http://localhost:8787' })
    ensureDaemonBin(home, 'C:/somewhere/cli.js')
    const c = readConfig(home)
    expect(c.apiToken).toBe('token-1')
    expect(c.serverUrl).toBe('http://localhost:8787')
    expect(c.daemonBin).toBe('C:/somewhere/cli.js')
  })

  it('does not rewrite the file when the path is already what it would set', () => {
    // A no-op write on every daemon start is a pointless chance to corrupt the one file holding
    // the api token, and config.json is rewritten atomically precisely because that matters.
    ensureDaemonBin(home, 'C:/somewhere/cli.js')
    const before = readConfig(home)
    ensureDaemonBin(home, 'C:/somewhere/cli.js')
    expect(readConfig(home)).toEqual(before)
  })
})
