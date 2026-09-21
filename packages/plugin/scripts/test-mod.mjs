// Runs the hooks module's checks with Claude Code's own tooling. Not part of `pnpm test`: it needs
// a `claude` on PATH with function hooks available, and `claude plugin test` does not exist at all
// where they are off (Spike E: "error: unknown command 'test'"). So this refuses loudly rather than
// reporting a skip as a pass (CLAUDE.md trap 4).
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const env = { ...process.env, CLAUDE_CODE_ENABLE_FUNCTION_HOOKS: '1' }
const run = (cmd, args, capture = false) =>
  spawnSync(cmd, args, { cwd: root, env, encoding: 'utf8', stdio: capture ? 'pipe' : 'inherit' })
const fail = (message, detail = '') => { console.error(`test:mod: ${message}${detail ? `\n${detail}` : ''}`); process.exit(1) }

// 1. The kit exists here.
const help = run('claude', ['plugin', 'test', '--help'], true)
if (help.status !== 0 || !/function-hooks plugin/.test(help.stdout ?? '')) {
  fail('`claude plugin test` is not available, so the hooks module was NOT tested. Install a Claude Code with function hooks.', `${help.stdout ?? ''}${help.stderr ?? ''}`)
}

// 2. Declarations for this Claude Code, written locally and never committed (.claude/types/).
if (run('claude', ['-p', '/plugin-types']).status !== 0) fail('`claude -p /plugin-types` failed')

// 3. Typecheck the module and its tests against them.
const tsc = createRequire(import.meta.url).resolve('typescript/bin/tsc')
if (run(process.execPath, [tsc, '-p', 'tsconfig.mod.json']).status !== 0) fail('band.tsx or its tests do not typecheck')

// 4. The inventory (R201): exactly two hooks, no prompt.submit, three environment names.
const validate = run('claude', ['plugin', 'validate', '.', '--strict'], true)
const out = `${validate.stdout ?? ''}${validate.stderr ?? ''}`
if (validate.status !== 0) fail('claude plugin validate failed', out)
const lines = out.split(/\r?\n/)
const hooksLine = lines.find((l) => l.includes('./band.tsx hooks:'))
if (hooksLine?.split('hooks:')[1]?.trim() !== 'session.start, ui.render{component=AbovePrompt}') {
  fail('band.tsx must register exactly session.start and ui.render{component=AbovePrompt}', out)
}
if (/prompt\.submit/.test(out)) fail('band.tsx must never hook prompt.submit (R201)', out)
const envNames = new Set(lines.filter((l) => /env/i.test(l)).flatMap((l) => l.match(/\b[A-Z][A-Z0-9_]{2,}\b/g) ?? []))
const expected = ['HOME', 'TICKOVER_HOME', 'USERPROFILE']
if ([...envNames].sort().join(',') !== expected.join(',')) {
  fail(`band.tsx must read exactly ${expected.join(', ')}; validate lists ${[...envNames].sort().join(', ') || 'none'}`, out)
}

// 5. The reach: exactly these `$` verbs and no others. This half and tests/band.test.ts catch
// different things, and neither catches the other's:
//   - A *new verb* -- $.fs.write, a transcript or agent reader, a second `$.http` call site -- is
//     invisible to the kit, which can only record the hooks world() installs (today fs.read and
//     http.fetch). This line is the only thing that sees it.
//   - A *bad argument* to a verb already listed -- a read of another path, a POST to another host,
//     written inside the existing readDaemon or request -- adds no call site, so this line is
//     byte-identical with the leak in place (measured: same SHA-256, R208). Only the kit sees it.
// Pinned as the set of verbs: the `(via helper)` annotations validate prints are dropped, because
// renaming a helper changes what this line says without changing what the module can reach.
const callsLine = lines.find((l) => l.includes('./band.tsx calls:'))
// The annotations are stripped *before* the split, not after: validate writes them as
// `$.ui.invalidate (via armLater, show)`, so a split on commas first tears one verb into two.
const called = (callsLine?.split('calls:')[1] ?? '').replace(/\s*\([^)]*\)/g, '')
const verbs = [...new Set(called.split(',').map((c) => c.trim()).filter(Boolean))].sort()
const expectedCalls = ['$.clock.after', '$.clock.every', '$.clock.now', '$.env.get', '$.fs.read', '$.http.fetch', '$.session.id', '$.ui.invalidate', '$.ui.resolve', '$.ui.toast']
if (verbs.join(',') !== expectedCalls.join(',')) {
  fail(`band.tsx must call exactly ${expectedCalls.join(', ')}; validate lists ${verbs.join(', ') || 'none'}`, out)
}

// 6. The kit tests.
process.exit(run('claude', ['plugin', 'test', '.']).status ?? 1)
