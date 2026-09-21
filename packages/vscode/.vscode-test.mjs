import { defineConfig } from '@vscode/test-cli'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// TICKOVER_HOME and TICKOVER_RETRY_MS must be set on the VS Code process before it launches,
// not from inside the test module: the extension activates on `onStartupFinished`, which can
// fire (and did, in practice) before the test file's own top-level code runs, so a later
// `process.env.X = ...` inside the test is too late to change what `activate()` already read.
const home = mkdtempSync(join(tmpdir(), 'mw-e2e-'))

export default defineConfig({
  files: 'dist/e2e/**/*.test.js',
  version: 'stable',
  env: { TICKOVER_HOME: home, TICKOVER_RETRY_MS: '300' },
  mocha: { timeout: 60_000 },
})
