import { describe, it, expect } from 'vitest'
import { mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ensureHome, paths, resolveHome } from '../../src/paths.js'
import { readConfig, writeConfig, readDaemonInfo, writeDaemonInfo, removeDaemonInfo } from '../../src/config.js'

describe('paths and config', () => {
  it('resolves TICKOVER_HOME and falls back to ~/.tickover', () => {
    expect(resolveHome({ TICKOVER_HOME: 'C:/x/mw' })).toBe('C:/x/mw')
    expect(resolveHome({ HOME: '/home/u' })).toBe(join('/home/u', '.tickover'))
  })

  it('creates a default config with an install token and round-trips it', () => {
    const home = mkdtempSync(join(tmpdir(), 'mw-'))
    ensureHome(home)
    // POSIX-only: mode bits don't map onto Windows ACLs the same way. Verified for real on
    // Linux/macOS by Task 13's release checklist, not by this (Windows) dev machine's test run.
    if (process.platform !== 'win32') expect(statSync(home).mode & 0o777).toBe(0o700)
    const c = readConfig(home)
    expect(c.installToken).toHaveLength(43)
    expect(c.apiToken).toBeNull()
    expect(c.serverUrl).toBe('https://api.tickover.dev')
    writeConfig(home, { ...c, apiToken: 'tok' })
    expect(readConfig(home).apiToken).toBe('tok')
    expect(readConfig(home).installToken).toBe(c.installToken)
    // POSIX-only, see the comment above.
    if (process.platform !== 'win32') expect(statSync(paths(home).config).mode & 0o777).toBe(0o600)
  })

  it('mints an install token when missing from an existing config and persists it', () => {
    const home = mkdtempSync(join(tmpdir(), 'mw-'))
    ensureHome(home)
    // Existing config on disk, written by an older version of the daemon, with no installToken.
    writeFileSync(paths(home).config, JSON.stringify({ serverUrl: 'https://api.tickover.dev', apiToken: 'tok', wrappedStatusLine: null, daemonBin: null }))
    const first = readConfig(home)
    expect(first.installToken).toHaveLength(43)
    // The minted token must be written back, not re-minted on every read.
    expect(JSON.parse(readFileSync(paths(home).config, 'utf8')).installToken).toBe(first.installToken)
    expect(readConfig(home).installToken).toBe(first.installToken)
  })

  it('treats a corrupt config.json as absent: mints a fresh one and persists it instead of throwing', () => {
    const home = mkdtempSync(join(tmpdir(), 'mw-'))
    ensureHome(home)
    writeFileSync(paths(home).config, '{not valid json')
    const c = readConfig(home)
    expect(c.serverUrl).toBe('https://api.tickover.dev')
    expect(c.installToken).toHaveLength(43)
    // The corrupt file must actually be replaced, not just papered over in memory.
    expect(JSON.parse(readFileSync(paths(home).config, 'utf8')).installToken).toBe(c.installToken)
  })

  it('writes and removes daemon info', () => {
    const home = mkdtempSync(join(tmpdir(), 'mw-'))
    ensureHome(home)
    expect(readDaemonInfo(home)).toBeNull()
    writeDaemonInfo(home, { port: 47321, token: 'abc', pid: 1, startedAt: '2026-09-10T10:00:00.000Z' })
    expect(readDaemonInfo(home)).toMatchObject({ port: 47321, token: 'abc' })
    expect(JSON.parse(readFileSync(paths(home).daemon, 'utf8')).pid).toBe(1)
    removeDaemonInfo(home)
    expect(readDaemonInfo(home)).toBeNull()
  })
})
