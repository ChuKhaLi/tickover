import { existsSync, readdirSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { expect } from 'vitest'

/**
 * Fails loudly if `dist/cli.js` is missing or older than any file in `src/`.
 *
 * The package's own `pretest` script runs `tsup`, so the bundle is always fresh on the normal
 * path -- but `vitest run <one file>` invoked directly skips `pretest` entirely, which is exactly
 * how someone re-runs a single test while investigating. The tests that spawn the built CLI would
 * then pass green against a stale bundle, and this branch has already shipped three defects that
 * existed ONLY in `dist/` and were invisible to source-running tests (node:sqlite stripped by
 * tsup, a mangled ANSI escape, zod bundled into the vscode extension). These are the only tests
 * that exercise the built artifact at all, so a silent false green here is worth more than it
 * looks.
 *
 * Asserting rather than building: a build inside a test is slow and surprising, and the message
 * below tells the reader exactly what to run.
 */
export function assertFreshBundle(): void {
  const dist = resolve('dist/cli.js')
  const src = resolve('src')
  expect(existsSync(dist), `${dist} is missing -- run \`pnpm --filter tickover-cli build\` (the package's own pretest does this; a bare \`vitest run <file>\` does not)`).toBe(true)

  const builtAt = statSync(dist).mtimeMs
  let newestSource = 0
  let newestName = ''
  const walk = (dir: string): void => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name)
      if (e.isDirectory()) { walk(p); continue }
      const m = statSync(p).mtimeMs
      if (m > newestSource) { newestSource = m; newestName = p }
    }
  }
  walk(src)

  expect(builtAt, `dist/cli.js is older than ${newestName} -- run \`pnpm --filter tickover-cli build\`. These tests spawn the BUILT cli, so a stale bundle makes them pass against code that is not the code under review.`).toBeGreaterThanOrEqual(newestSource)
}
