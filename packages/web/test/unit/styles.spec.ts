// R47 keeps firing the same way: prose in a file Tailwind scans mints a utility, the utility
// ships, and nobody notices until someone measures the emitted CSS by hand. Measuring by hand is
// what keeps failing. This is the same measurement, run.
//
// The trap itself, and the rules for the `@source not` lines that answer it, are in
// `packages/web/README.md`. Not restated here: this file's own count of how many times R47 had
// fired was one of four copies that drifted (R382).
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, it, expect } from 'vitest'
import { PUBLIC_DIR } from '../../scripts/postbuild'

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const assets = resolve(packageRoot, PUBLIC_DIR, 'assets')

/** The build emits exactly one stylesheet; its name carries a content hash. */
function emittedCss(): string | undefined {
  if (!existsSync(assets)) return undefined
  const found = readdirSync(assets).filter((f) => f.endsWith('.css'))
  return found.length === 1 ? resolve(assets, found[0]!) : undefined
}

const css = emittedCss()

/**
 * R80. This file used to sit behind `describe.skipIf(!css)`, and nothing in `pnpm
 * test` built the app: measured with `dist` renamed away, the suite reported
 * `352 passed | 13 skipped (365)` and exited 0 — **the same 365 total** as a run that
 * did measure the artifact, so no number in a report could tell the two apart. The
 * guard R77 installed because hand-measurement had failed five times was itself
 * optional, and its absence was indistinguishable from its success.
 *
 * `pretest` now builds. This says so out loud for any run that reaches here without
 * one, rather than passing quietly.
 */
function stylesheet(): string {
  expect(css, `no stylesheet under ${assets} — run \`pnpm --filter @tickover/web build\` (\`pretest\` does this; a bare \`vitest run\` does not)`).toBeDefined()
  return css!
}

/**
 * The measured size of a clean build. Deliberately exact.
 *
 * **When this goes red, attribute the delta before you touch the number.** Build the
 * previous commit's stylesheet, diff it against this one rule by rule, and write what
 * moved and why in the history below — every entry there does, to the byte, and that
 * history is the most useful thing in this file. Only then put the new figure here,
 * in the same commit as the change that moved it.
 *
 * The order matters, and it is the opposite of what this comment used to say. It used
 * to offer re-measuring first and attribution as an afterthought, opening with "if the
 * CSS *should* have changed — a template gained a utility". That is true of every
 * styling commit, so nobody ever reached the second half. A whole-branch review then
 * showed what it cost: a class on `<body>` in `index.html` and a stray word in
 * `src/main.ts` shipped two stock-ramp rules and a stock type step, and the only guard
 * that noticed was this one — whose own instruction then told the next person to
 * re-baseline and move on. A size cannot tell a legitimate delta from an illegitimate
 * one; it is not carrying that information.
 *
 * It is no longer the last line of defence: `tokens.spec.ts` now asserts against the
 * emitted sheet's contents, fails on *what* is in it rather than on how big it is, and
 * names the offending variable. The two split the work — this one says the size moved
 * and to account for it, that one says the size moved for a reason that is not allowed.
 */
// Every movement of this number, each one measured and attributed, is an entry in the baseline log
// named below; the newest is the log's last one. None is restated here (R382).
const BASELINE_BYTES = 27_589

/**
 * Every earlier movement of this number, attributed to the byte, is in
 * `docs/superpowers/reports/web-stylesheet-baseline-log.md` -- 477 lines of it, which is what this
 * comment used to be and why this file was 96% comment (R381). The record is required reading
 * before changing the constant, and required writing after; only the newest entry stays here,
 * beside the number it explains.
 */

// `pretest` builds (R80), so what is read here is the artifact this tree produces.
// CLAUDE.md's second trap — a suite that exercises a stale `dist/` — is closed by the
// build, not by trusting R43's process rule to bind whoever comes next.
describe('the emitted stylesheet', () => {
  it('is the size a clean build produces', () => {
    expect(
      statSync(stylesheet()).size,
      `${css} is not the measured baseline. See the note above this constant before changing it.`,
    ).toBe(BASELINE_BYTES)
  })

  /**
   * The utilities prose has minted on this repository. Every one of them shipped
   * once; none is used by any template here.
   *
   * `visible` was the first that this list caught rather than a hand measurement: two
   * comments written while adding the spec §7 legal pages used the word
   * "crawler-visible" and "a visible price", and the byte count went 18,038 -> 18,066.
   * Both were reworded -- those are shipped source files, and the `@source not`
   * exclusions are for trees that are not.
   *
   * `static` is different again, and had been shipping the whole time. It comes from the
   * package *root* -- `vite.config.ts`'s `static: true` and `package.json`'s `tsx
   * e2e/static-server.ts` -- which the exclusions did not cover, so no amount of care in
   * `src` would have stopped it. The branch review found it by extracting all 243 class
   * selectors from the emitted sheet and testing each against every file under `src`:
   * 82 did not match, 81 of them numeric fragments of `oklch()` values, and `static` was
   * the only real name. Two more `@source not` lines removed it, exactly 24 bytes.
   *
   * `hidden` is deliberately **not** in this list. It is minted from shipped copy —
   * spec §4.7's "a hidden sponsor" and "attention (hidden check)" — so it is an
   * orphan by accident of vocabulary, not prose contamination, and it stays.
   *
   * `relative` left this list in the CLS fix round (R384, fix round 1, task 6 finding):
   * `index.page.ts`'s prompt box gained `class="relative"` so the caret has a positioning context to
   * be pinned against, which is exactly the case this comment already asked for below.
   *
   * If a template ever legitimately uses one of these, delete it from the list in
   * the same commit. Do not add an `@source not` line to hide it.
   */
  /**
   * R415. A face with no `unicode-range` matches every character, and the last one declared for a
   * family and weight wins. `@fontsource/ibm-plex-mono`'s per-subset files ship without ranges, so
   * the vietnamese mono faces, declared last, were fetched on every mono render at VeryHigh priority
   * ahead of the preloaded latin ones (captured on `/`, R412). The faces are declared by hand now,
   * and this holds every face in the shipped sheet to a range -- the sans ones included, whose
   * package does carry them, so a version bump that drops them is caught too.
   */
  it('gives every @font-face a unicode-range', () => {
    const faces = readFileSync(stylesheet(), 'utf8').match(/@font-face\{[^}]*\}/g) ?? []
    expect(faces.length, 'no @font-face rules found at all').toBeGreaterThan(0)
    for (const face of faces) expect(face, 'a face without a range matches every character').toContain('unicode-range:')
  })

  // The hand-written faces name their files by bare specifier. A wrong name is not a build
  // error: Vite warns "didn't resolve at build time", exits 0 and ships the specifier as-is,
  // which 404s in the browser (measured in review, R415). Every face must point into /assets/.
  it('leaves no unresolved package url() in the sheet', () => {
    expect(readFileSync(stylesheet(), 'utf8')).not.toMatch(/url\(["']?@/)
  })

  it.each(['visible', 'fixed', 'table', 'filter', 'static'])(
    'does not carry .%s, which no template asks for',
    (utility) => {
      expect(readFileSync(stylesheet(), 'utf8'), `.${utility} is back — something outside src/ is being scanned`)
        .not.toContain(`.${utility}{`)
    },
  )
})

describe('the component prefix', () => {
  // The product was renamed from Meanwhile to Tickover; mw- is the old name (spec 2026-09-29 §3).
  it('is tk- everywhere under src/, and mw- nowhere', () => {
    const hits: string[] = []
    const walk = (dir: string) => { for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = resolve(dir, e.name)
      if (e.isDirectory()) walk(p)
      else if (/\.(ts|css|html)$/.test(e.name) && /(^|[^A-Za-z0-9])mw-/.test(readFileSync(p, 'utf8'))) hits.push(p)
    } }
    walk(resolve(packageRoot, 'src'))
    expect(hits).toEqual([])
  })
  it('is looking at real files: tk-button is declared', () => {
    expect(readFileSync(resolve(packageRoot, 'src/app/ui/button.ts'), 'utf8')).toContain("selector: 'button[tk-button], a[tk-button]'")
  })
})
