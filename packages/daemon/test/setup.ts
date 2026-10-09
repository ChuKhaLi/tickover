// Installed for every file in THIS suite -- the daemon package (vitest.config.ts `setupFiles`) -- so
// its fetches go through the diagnostic rather than each of its 87 call sites having to opt in: a
// wrapper nobody remembers to use is the same as no wrapper.
//
// The plugin package is deliberately NOT instrumented, and not from oversight. `git grep "\bfetch("`
// finds 13 files with call sites here and **none** in `packages/plugin/test`: every fetch in that
// suite happens inside a spawned child (`notify.mjs`, `statusline.mjs`), which keeps its own global
// and is out of reach of a test-process patch. A setup file there would wrap nothing and fire never,
// which is worse than none because it reads as coverage. It follows that one of the two failures this
// diagnostic was written for -- the one reported against `packages/plugin/test/notify.spec.ts`, a file
// containing no fetch at all -- could not have been named by any fetch diagnostic, here or there. That
// one is an attribution question, not an instrumentation gap.
//
// Only this process is patched. The CLI tests spawn a child (`runCli`), which keeps its own `fetch`
// and its own message, so `cli-web.test.ts`, at `not.toContain('fetch failed')`, asserts on text this
// cannot reach and is deliberately unaffected.
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { withFetchDiagnostics } from './helpers/daemon.js'

globalThis.fetch = withFetchDiagnostics(globalThis.fetch)

// No test in this suite may reach the developer's real home (R712). On 2026-09-30 a mutant that
// ignored CLAUDE_CONFIG_DIR fell back to ~/.claude, and the suite rewrote the developer's actual
// settings.json: their status line pointed into a deleted temp dir, Mods switched on. Every test
// passes its own paths, so the fallback is only ever reached by a bug or a mutant -- which is exactly
// when it must land somewhere harmless. os.homedir() reads USERPROFILE on Windows and HOME elsewhere;
// both point at a temp dir, spawned CLIs inherit them, and the two variables that override a home
// outright are removed so a developer's own shell settings cannot leak in either.
const fakeHome = mkdtempSync(join(tmpdir(), 'tk-test-home-'))
process.env.HOME = fakeHome
process.env.USERPROFILE = fakeHome
delete process.env.CLAUDE_CONFIG_DIR
delete process.env.TICKOVER_HOME
