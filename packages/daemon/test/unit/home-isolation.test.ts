import { describe, it, expect } from 'vitest'
import { homedir, tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { claudeSettingsPath } from '../../src/statusline-install.js'
import { resolveHome } from '../../src/paths.js'

// Incident, 2026-09-30 (R712): a mutation run that made installStatusLine ignore CLAUDE_CONFIG_DIR
// fell through to the real ~/.claude/settings.json, and the suite then wrote the developer's actual
// status line (pointing it into a test's temp dir, since deleted) and turned Mods on in their env.
// Every test supplies its own paths, so nothing caught that the fallback was the real home. The
// setup file now points the process's home at a temp dir, so any fallback -- in source, in a
// mutant, or in a spawned CLI that inherits the environment -- lands there instead.
describe('the test process home', () => {
  const inTemp = (p: string) => resolve(p).toLowerCase().startsWith(resolve(tmpdir()).toLowerCase())

  it('is a temp dir, not the developer\'s', () => {
    expect(inTemp(homedir())).toBe(true)
  })

  it('so the default Claude Code settings and Tickover home fall back into it too', () => {
    expect(inTemp(claudeSettingsPath())).toBe(true)
    expect(inTemp(resolveHome())).toBe(true)
  })
})
