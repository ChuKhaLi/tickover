import { describe, it, expect } from 'vitest'
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { assertFreshBundle } from '../helpers/dist.js'

// npm only *warns* on `engines`, so `npm i -g tickover-cli` succeeds on Node 20 and the CLI then
// dies inside ESM linking on `node:sqlite` -- ERR_UNKNOWN_BUILTIN_MODULE, before a line of ours runs,
// and the status line just says "daemon off". The installed `tickover` command therefore points at
// dist/bin.js, which checks the version first and only then loads the CLI.
//
// The old Node is simulated by a preload that rewrites process.versions.node, because the test has
// to run on the Node that runs the suite. A real Node 20 run is recorded in the decisions file.
const spoof = (v: string) =>
  `data:text/javascript,Object.defineProperty(process,'versions',{value:{...process.versions,node:'${v}'}})`

function run(version: string | null, args: string[]) {
  const pre = version === null ? [] : ['--import', spoof(version)]
  return spawnSync(process.execPath, [...pre, resolve('dist/bin.js'), ...args], { encoding: 'utf8' })
}

describe('node version gate', () => {
  it('is what the installed command runs', () => {
    const pkg = JSON.parse(readFileSync(resolve('package.json'), 'utf8')) as { bin: Record<string, string> }
    expect(pkg.bin.tickover).toBe('./dist/bin.js')
  })

  it('refuses an old Node with the reason, and exits 1', () => {
    assertFreshBundle()
    const r = run('22.12.0', ['version'])
    expect(r.status).toBe(1)
    expect(r.stderr).toContain('Tickover needs Node 22.13 or newer')
    expect(r.stderr).toContain('22.12.0')
    expect(r.stdout).toBe('')
  })

  // Review, Minor: node:sqlite is unflagged in 22.13 and again only from 23.4 -- 23.0 to 23.3 still
  // need --experimental-sqlite, so "22.13 or newer" let them through to the same crash.
  it('refuses 23.0 to 23.3, which still hide node:sqlite behind a flag', () => {
    assertFreshBundle()
    for (const v of ['23.0.0', '23.3.9']) expect(run(v, ['version']).status, `node ${v}`).toBe(1)
  })

  it('runs the CLI on the minimum version and above', () => {
    assertFreshBundle()
    const pkg = JSON.parse(readFileSync(resolve('package.json'), 'utf8')) as { version: string }
    for (const v of ['22.13.0', '23.4.0', '24.0.0', null]) {
      const r = run(v, ['version'])
      expect(r.stderr, `node ${v}`).toBe('')
      expect(r.stdout.trim(), `node ${v}`).toBe(pkg.version)
    }
  })
})
