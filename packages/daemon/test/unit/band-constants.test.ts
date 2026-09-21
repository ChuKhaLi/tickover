import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { BAND_FRESH_MS } from '../../src/sessions.js'
import { composeBand } from '../../src/band.js'

/**
 * `BAND_FRESH_MS` (daemon) and `BAND_POLL_MS` (module) are each pinned alone where they live, and
 * nothing watched the one thing that makes them correct: the claim window has to outlast several
 * polls. At `fresh < 3 x poll` a single slow or skipped poll lapses a claim the band is still
 * drawing, and the question appears on both surfaces at once -- R204's cost, reached without either
 * constant ever looking wrong on its own.
 *
 * Read from source text rather than imported: `band.tsx` is a hooks module in another package, with
 * no build step and no export path into this one. Claude Code's loader compiles it, and importing it
 * here would both fail on the JSX and run its module-level state. Reading the file is what lets one
 * assertion span the wire between two packages that never link.
 *
 * `BAND_POLL_MAX_MS` (10 000, above `BAND_FRESH_MS`) is deliberately not part of this: the branch
 * that backs off also calls `show($, { state: 'none' })` (`band.tsx`, the backoff branch at
 * `delay = Math.min`), so the band is drawing
 * nothing and no claim is being refreshed while the interval is stretched.
 */
const BAND_TSX = fileURLToPath(new URL('../../../plugin/hooks/band.tsx', import.meta.url))
const WORLD_TS = fileURLToPath(new URL('../../../plugin/tests/fixtures/world.ts', import.meta.url))

function literal(source: string, name: string): number {
  // The right-hand side is taken to the end of its own line, and nothing else. Unanchored,
  // `([0-9_]+)` matched the first run of digits *inside* an expression -- `1_000 * 2` read as 1 000,
  // `2 * 1_000` read as 2 -- so the comparison below ran against a number this test invented rather
  // than the module's poll interval, and passed. `^` with `m` stops a `//` copy from
  // standing in for the declaration -- but not to one inside a `/* */` block, which is why the match
  // below is exactly-once rather than first-wins (R216). `[^\r\n]` rather than `.`: this working
  // copy is CRLF, and the carriage return would otherwise be captured into the value.
  const all = [...source.matchAll(new RegExp(`^const ${name} =([^\\r\\n]*)`, 'gm'))]
  if (all.length === 0) throw new Error(`${name} is not declared at the start of a line in band.tsx`)
  if (all.length > 1) throw new Error(`${name} is declared ${all.length} times at the start of a line in band.tsx`)
  const m = all[0]!
  // Not a fallback: a constant that stops being a plain literal has to fail loudly here rather than
  // let the comparison below pass on a number this test invented. A trailing line comment is still a
  // plain literal; an expression, another constant or a call is not.
  const rhs = m[1]!.replace(/\/\/.*$/, '').trim().replace(/;$/, '').trim()
  if (!/^\d(?:[\d_]*\d)?$/.test(rhs)) {
    throw new Error(`${name} is no longer a plain numeric literal in band.tsx: ${JSON.stringify(rhs)}`)
  }
  return Number(rhs.replace(/_/g, ''))
}

describe('the band claim window against the module poll interval', () => {
  it('holds a claim across at least three of the module polls that refresh it', () => {
    const pollMs = literal(readFileSync(BAND_TSX, 'utf8'), 'BAND_POLL_MS')
    expect(pollMs).toBeGreaterThan(0)
    expect(BAND_FRESH_MS).toBeGreaterThanOrEqual(3 * pollMs)
  })
})

/**
 * R219's window, against the two constants that bound it, in the one place both sides are visible at
 * once: the module's poll interval beneath it and the daemon's claim window above it. Each of the
 * three is defensible alone, and the relationship is the whole of what makes the release work.
 *
 * Below the lower bound the module releases a claim the band is still drawing -- one slow or folded
 * frame is enough -- and the question is drawn in the band and printed on the status line at the same
 * time, which is R204's cost. At or above the upper bound the daemon's `bandHolds` has already
 * expired the claim by the time the module drops it, so the module's release never changes anything
 * a caller can see: dead code reading as the guarantee that the §23 defect is fixed. Neither failure
 * makes either constant look wrong where it is declared.
 */
describe('the band render-staleness window against the constants that bound it', () => {
  it('releases a claim after more than one poll, and before the daemon expires it', () => {
    const src = readFileSync(BAND_TSX, 'utf8')
    const pollMs = literal(src, 'BAND_POLL_MS')
    const staleMs = literal(src, 'BAND_RENDER_STALE_MS')
    expect(staleMs).toBeGreaterThan(pollMs)
    expect(staleMs).toBeLessThanOrEqual(BAND_FRESH_MS)
  })
})

/**
 * R220's window, between the poll interval beneath it and the claim window above it. A press spends a
 * paid, once-only answer, so it is held to a tighter freshness than the claim: `drawing` alone stays
 * true for up to `BAND_RENDER_STALE_MS` after the band has gone dark, and a press in that gap posts
 * an answer for a question nobody can see -- measured at 3 000 ms by the branch review, with the
 * claim still held.
 *
 * At or below `BAND_POLL_MS` a legitimate press on a normally-rendering band is refused: `poll()`
 * asks for a redraw once per interval, so a healthy drawing is up to one interval old, and the
 * keystroke would silently do nothing. At or above `BAND_RENDER_STALE_MS` the press window is the
 * claim window again and the split buys nothing. Neither failure makes any of the three constants
 * look wrong where it is declared, which is why the relationship is pinned rather than the values.
 */
describe('the press-freshness window against the windows on either side of it', () => {
  it('is looser than one poll interval and tighter than the claim it was split from', () => {
    const src = readFileSync(BAND_TSX, 'utf8')
    const pollMs = literal(src, 'BAND_POLL_MS')
    const pressMs = literal(src, 'BAND_PRESS_FRESH_MS')
    const staleMs = literal(src, 'BAND_RENDER_STALE_MS')
    expect(pressMs).toBeGreaterThan(pollMs)
    expect(pressMs).toBeLessThan(staleMs)
  })
})

/**
 * The guard on the guard, because `literal` is the whole reason the comparison above means anything
 * and it passed on exactly the case it was written to fail on. With nothing anchoring the right-hand
 * side, `([0-9_]+)` read the first run of digits it found inside an expression: `1_000 * 2` gave
 * 1 000 and the comparison ran `6000 >= 3000`, and `2 * 1_000` gave 2 and ran `6000 >= 6`, which
 * passes for any poll interval whatever. Both reported **1 passed**. `toBeGreaterThan(0)` is what let
 * them through -- 1 000 and 2 are both greater than 0 -- so what has to be checked is the shape of
 * the declaration, not the value it yields.
 *
 * Watched in both directions (R99, plan 2): each expression throws, and a plain literal is still
 * read correctly, across the CRLF endings this working copy actually stores.
 */
describe('reading the module constant out of band.tsx', () => {
  it('reads a plain numeric literal, underscores and all, across CRLF line endings', () => {
    const src = 'const BAND_POLL_MS = 2_000\r\nconst BAND_POLL_MAX_MS = 10_000\r\n'
    expect(literal(src, 'BAND_POLL_MS')).toBe(2000)
    expect(literal(src, 'BAND_POLL_MAX_MS')).toBe(10000)
  })

  it('throws on an expression rather than reading the first number out of it', () => {
    for (const rhs of ['1_000 * 2', '2 * 1_000', 'BASE', 'Number(x) * 2', '2_000 + 0']) {
      expect(() => literal(`const BAND_POLL_MS = ${rhs}\r\n`, 'BAND_POLL_MS'), rhs)
        .toThrow(/no longer a plain numeric literal/)
    }
  })

  it('throws when the constant is not declared at the start of a line at all', () => {
    expect(() => literal('const OTHER = 2_000\r\n', 'BAND_POLL_MS')).toThrow(/not declared/)
    // A commented-out copy is not a declaration; reading one would pin a number the module never uses.
    expect(() => literal('// const BAND_POLL_MS = 2_000\r\n', 'BAND_POLL_MS')).toThrow(/not declared/)
  })

  // The decoy the line anchor does not stop, and the one that costs the most: a `//` copy is moved
  // off the start of its line, but a copy inside a `/* */` block is not, so `^const NAME =` matched
  // inside the comment and `.exec` took the *first* match in the file. Measured with exactly the
  // shape below in band.tsx -- the guard read 100, compared `6000 >= 300` and reported **5 passed**
  // while the module polled every 60 s, which is R204's cost arriving with its own guard green.
  it('refuses a second line-anchored declaration rather than reading the first', () => {
    const src = '/*\r\nconst BAND_POLL_MS = 100\r\n*/\r\nconst BAND_POLL_MS = 60_000\r\n'
    expect(() => literal(src, 'BAND_POLL_MS')).toThrow(/declared 2 times/)
  })
})

/**
 * R220, fix rounds 3 and 4. The press guard compares two module variables, and both halves of how it
 * reads them are load-bearing:
 *
 *  - they are read inside one **synchronous** function, so no `await` can fall between them. That
 *    matters because the kit cannot construct the interleaving that would catch a straddle: the
 *    mutation inserting an await between the two reads was **26 pass / 0 fail**;
 *  - they are `drawing` and `drawnAt`, which the render hook writes beside each other, rather than
 *    `drawing` and `lastRenderAt`, which it writes two awaits apart. Synchronous reads of the second
 *    pair are atomic and still wrong: for the whole of a render drawing a *different* assignment they
 *    return (previous assignment, fresh timestamp).
 *
 * What the language cannot prevent is someone adding `async`, or leaving this helper intact and
 * unused while doing the comparison inline somewhere else -- the second bypass passed the first
 * version of this guard with the whole branch green. So the call site is pinned too: a `drawnFresh`
 * nobody calls is an orphan, and the tear is back wherever the caller went.
 *
 * Read from source for the same reason the constants above are: `band.tsx` is a hooks module in
 * another package, with no build step and no export path into this one. Exactly-once rather than
 * first-wins, for R216's reason -- a copy inside a `/* *\/` block is still at the start of a line.
 */
describe('the press guard reads its two facts synchronously, and from one place', () => {
  const guardSource = (): string => readFileSync(BAND_TSX, 'utf8')

  /**
   * Block comments are removed BEFORE splitting, rather than whole lines being dropped when they
   * start with an opener. Dropping by line start was a trade that looked like an alignment: it caught
   * a decoy declaration inside a `/* *\/` block (R216) and silently lost the opposite bypass, an
   * `await` written after a `*\/` on the same line — code the predicate discarded as comment. Removing
   * the block first catches both, because what survives is exactly the code.
   */
  const codeLines = (): string[] =>
    guardSource()
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .split(/\r?\n/)
      .filter((l) => !/^\s*\/\//.test(l))
      .map((l) => l.trim())

  it('declares drawnFresh without async, so no await can separate the two reads', () => {
    const all = [...guardSource().matchAll(/^(async )?function drawnFresh\b/gm)]
    if (all.length !== 1) throw new Error(`drawnFresh is declared ${all.length} times at the start of a line in band.tsx`)
    expect(all[0]![1]).toBeUndefined()
  })

  // The orphan bypass, which the declaration check alone cannot see: leave drawnFresh byte-identical
  // and unused, and do the comparison inline in drawnNow with an await between the two reads. Counting
  // calls rather than matching drawnNow's body, because the body is one expression today and a guard
  // that pins its exact text would fail on a reformat while still not saying what it means.
  it('calls drawnFresh exactly once, so the helper cannot be left an orphan', () => {
    // The declaration matches `drawnFresh(` as well, so it is excluded rather than counted. The first
    // version of this asserted a total of 1 and was exactly INVERTED: the baseline has two (the
    // declaration and the call) and failed, while the orphan bypass has one and passed. A guard
    // written to catch that bypass would have waved it through. Found by mutating the guard, not by
    // reading it -- which is the argument for mutating guards as well as implementations.
    const calls = [...guardSource().matchAll(/(?<!function\s)drawnFresh\(/g)]
    expect(calls).toHaveLength(1)
  })

  // And the comparison reads `drawnAt`, in exactly one place: the write in the render hook and this
  // read. A second read site is the inline tear wearing the right variable name. Comment lines are
  // dropped first so that prose about `drawnAt` cannot mask a real read, or invent one.
  // The reads are held synchronous by `drawnFresh`; nothing held the WRITES adjacent, and an await
  // between them reopens the tear from the other end. Measured: one inserted there was 28 pass / 0
  // fail -- round 3's surviving mutant reappearing a layer down, in the writes rather than the reads.
  it('writes drawnAt and drawing on consecutive lines, so no await can fall between them', () => {
    // Exactly-once and comment-stripped, like its two siblings above. The first version was
    // first-wins and read comments, which contradicted R216 and the doc comment thirty lines up in
    // this same file -- a guard whose own file already said why that is wrong. It was mitigated only
    // by the read-count sibling catching the decoy, which is luck rather than design.
    const code = codeLines()
    const at = code.filter((l) => /^drawnAt = \w/.test(l))
    if (at.length !== 1) throw new Error(`drawnAt is assigned ${at.length} times outside comments in band.tsx`)
    expect(code[code.indexOf(at[0]!) + 1]).toBe('drawing = v.assignment_id')
  })

  it('reads drawnAt in exactly one place, beside its single write', () => {
    const code = codeLines().join('\n')
    expect([...code.matchAll(/\bdrawnAt\b/g)]).toHaveLength(3)
  })
})

/**
 * The kit's fixture is a hand-written golden, and nothing tied it to what this package composes.
 * `packages/plugin/tests/fixtures/world.ts` hardcodes `min_columns: 28` while `composeBand` derives
 * 28 from `displayWidth(header) + 2` (R209), and both of the kit's boundary tests are written
 * relative to the fixture's own value -- so they follow it anywhere. Measured: set to 40, the kit is
 * 18 pass / 0 fail while the daemon goes on composing 28, and the band would hide on terminals it
 * could legitimately draw on. Pinned from this side because this is the side that owns the
 * arithmetic, and read out of the fixture's source for the same reason `BAND_POLL_MS` is: the
 * fixture imports `claude-code/testing`, which does not resolve from this package.
 */
function fixture(source: string, pattern: RegExp): string {
  const all = [...source.matchAll(new RegExp(pattern.source, 'g'))]
  if (all.length !== 1) throw new Error(`expected exactly one ${pattern} in world.ts, found ${all.length}`)
  return all[0]![1]!
}

describe('the kit fixture against what the daemon composes', () => {
  it('serves the module the header and min_columns composeBand actually produces', () => {
    const source = readFileSync(WORLD_TS, 'utf8')
    const v = composeBand({
      loggedIn: true, answered: null, todayPaid: 1, pendingCents: 0, availableCents: 50,
      question: {
        assignment_id: '8f0b0f2e-6f6a-4a3a-9c1f-0f1e2d3c4b5a', kind: 'choice', text: 'Which tagline?',
        options: ['Postgres, faster', 'Cached DB'], context: null, sponsor: 'Acme DB', price_cents: 50,
        served_at: '2026-09-10T10:00:00.000Z', expires_at: '2026-09-10T10:10:00.000Z',
      },
    })
    expect(v).toMatchObject({
      header: fixture(source, /header: '([^']*)'/),
      min_columns: Number(fixture(source, /min_columns: (\d+)/)),
    })
  })
})
