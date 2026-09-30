import { describe, it, expect } from 'vitest'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { assertFreshBundle } from '../helpers/dist.js'

// Captured 2026-09-29: `npm i -g tickover-cli@0.1.1` then `tickover version` printed 0.1.0, because
// VERSION was a literal in daemon.ts that nobody bumped with package.json. The same string goes to
// `tickover status`, /v1/health and the daemon log, so a bug report quoted the wrong release.
// Asserted on the built CLI, which is what a developer runs and what the literal lived in.
describe('version', () => {
  it('prints the version package.json publishes', () => {
    assertFreshBundle()
    const pkg = JSON.parse(readFileSync(resolve('package.json'), 'utf8')) as { version: string }
    const out = execFileSync(process.execPath, [resolve('dist/cli.js'), 'version'], { encoding: 'utf8' }).trim()
    expect(out).toBe(pkg.version)
  })
})
