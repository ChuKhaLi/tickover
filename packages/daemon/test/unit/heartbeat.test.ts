import { describe, it, expect } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { MAX_EXTENSION_KEYS, TELEMETRY_EXTENSIONS } from '@tickover/contract'
import { Heartbeat, HEARTBEAT_MAX_BACKOFF_MS, countExtensions, boundExtensionCounts } from '../../src/heartbeat.js'

describe('countExtensions', () => {
  it('counts by extension, skips heavy directories, and honors the entry cap', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mw-proj-'))
    mkdirSync(join(dir, 'src', 'deep'), { recursive: true })
    mkdirSync(join(dir, 'node_modules', 'x'), { recursive: true })
    writeFileSync(join(dir, 'src', 'a.ts'), '')
    writeFileSync(join(dir, 'src', 'b.TS'), '')
    writeFileSync(join(dir, 'src', 'deep', 'c.py'), '')
    writeFileSync(join(dir, 'README'), '')
    writeFileSync(join(dir, 'node_modules', 'x', 'index.js'), '')
    expect(countExtensions(dir)).toEqual({ ts: 2, py: 1 })
    expect(countExtensions(dir, { maxEntries: 2 })).toEqual({})
  })

  it('returns empty for a missing directory', () => {
    expect(countExtensions(join(tmpdir(), 'does-not-exist-mw'))).toEqual({})
  })

  // The plan-supplied test above only ever proves the default budget and a maxEntries small
  // enough to cut off at the very top level. Neither shows the walk actually stops mid-traversal
  // once *either* bound is hit rather than only ever finishing or immediately bailing.
  it('honors the entry cap after descending into a subdirectory, not just at the top level', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mw-proj-'))
    mkdirSync(join(dir, 'src'), { recursive: true })
    for (let i = 0; i < 20; i++) writeFileSync(join(dir, 'src', `f${i}.ts`), '')
    // Entry 1 is the top-level `src` directory itself; entries 2-6 are its first 5 files. The cap
    // must stop partway through `src`, at exactly 4 counted files, not finish all 20 or bail
    // before descending at all.
    expect(countExtensions(dir, { maxEntries: 5 })).toEqual({ ts: 4 })
  })

  it('honors the time budget: an already-expired budget counts nothing, even in a non-empty directory', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mw-proj-'))
    writeFileSync(join(dir, 'a.ts'), '')
    expect(countExtensions(dir, { budgetMs: 0 })).toEqual({})
  })

  // Whole-branch review C1. `path.extname` returns EVERYTHING after the last dot -- it is not a
  // language-suffix lookup -- so before this was bounded, ordinary filenames put customer and
  // project names on the wire under a consent screen that promises "counts of file extensions".
  // These are the exact filenames the review observed leaking.
  it('never turns a filename tail into a telemetry key, however plausible the file looks', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mw-proj-'))
    writeFileSync(join(dir, 'Dockerfile.acme-internal-prod'), '')
    writeFileSync(join(dir, 'deploy.customer-northwind-2026'), '')
    writeFileSync(join(dir, 'notes.ProjectPhoenix'), '')
    writeFileSync(join(dir, '.env.production'), '')
    writeFileSync(join(dir, `x.${'a'.repeat(120)}`), '')
    // A short, lowercase, alphanumeric tail that a shape check alone would wave straight through.
    writeFileSync(join(dir, 'deploy.northwind'), '')
    writeFileSync(join(dir, 'a.ts'), '')
    writeFileSync(join(dir, 'b.py'), '')
    writeFileSync(join(dir, 'c.md'), '')

    const counts = countExtensions(dir)
    expect(counts).toEqual({ ts: 1, py: 1, md: 1 })
    for (const leaked of ['acme-internal-prod', 'customer-northwind-2026', 'projectphoenix', 'production', 'northwind', 'a'.repeat(120)]) {
      expect(Object.keys(counts)).not.toContain(leaked)
    }
  })
})

describe('boundExtensionCounts', () => {
  it('drops anything outside the allowlist, whatever a caller merged in', () => {
    expect(boundExtensionCounts({ ts: 3, production: 9, northwind: 1, md: 2 })).toEqual({ ts: 3, md: 2 })
  })

  it('drops zero and negative counts rather than reporting them', () => {
    expect(boundExtensionCounts({ ts: 0, py: -1, md: 2 })).toEqual({ md: 2 })
  })

  it(`keeps at most ${MAX_EXTENSION_KEYS} keys, and keeps the largest counts`, () => {
    const all = Array.from(TELEMETRY_EXTENSIONS)
    expect(all.length).toBeGreaterThan(MAX_EXTENSION_KEYS)
    // Descending counts, so the survivors must be exactly the first MAX_EXTENSION_KEYS entries.
    const counts = Object.fromEntries(all.map((e, i) => [e, all.length - i]))
    const bounded = boundExtensionCounts(counts)
    expect(Object.keys(bounded)).toHaveLength(MAX_EXTENSION_KEYS)
    expect(Object.keys(bounded).sort()).toEqual(all.slice(0, MAX_EXTENSION_KEYS).sort())
  })
})

/**
 * P5 and P7, the two coverage gaps the client plan parked for "the whole-branch
 * review's single fix dispatch" and that nobody picked up.
 *
 * Both are about the failure path, so the deps are stubs: nothing here reaches the
 * success branch, and a real `startTestDaemon` would drag a fake server in to make one
 * request fail.
 */
function failing(clock: { now: Date }) {
  const sent: string[] = []
  const heartbeat = new Heartbeat({
    server: { heartbeat: async () => { sent.push('tried'); throw new Error('down') } },
    sessions: { count: () => 1, cwds: () => [], toolVersion: () => '2.0.0' },
    state: { unsentTurns: () => [] },
    loop: { setSelf: () => {} },
    clock: () => clock.now,
    log: { error: () => {} },
    loggedIn: () => true,
    intervalMs: 60_000,
  } as unknown as ConstructorParameters<typeof Heartbeat>[0])
  return { heartbeat, sent }
}

const advance = (clock: { now: Date }, ms: number) => { clock.now = new Date(clock.now.getTime() + ms) }

describe('Heartbeat backoff', () => {
  /**
   * P5: `forceNext()` is documented not to bypass an active failure backoff -- "a new
   * session starting is not a reason to hammer a server that's already failing" -- and
   * the code is right, because `tick()` checks `nextAttemptAt` on the line above the
   * one that reads `force`. The Task 8 report claimed a test pinned it. That claim was
   * false, and the ordering is one line away from being wrong at any time.
   */
  it('does not let forceNext bypass an active failure backoff (P5)', async () => {
    const clock = { now: new Date('2026-09-10T10:00:00.000Z') }
    const { heartbeat, sent } = failing(clock)

    await heartbeat.tick()
    expect(sent).toHaveLength(1)

    // Inside the backoff window, and asking loudly.
    advance(clock, 1000)
    heartbeat.forceNext()
    await heartbeat.tick()
    expect(sent, 'a forced beat went out while the server was already failing').toHaveLength(1)

    // And it is the backoff holding it, not the beat being lost: past the window it goes.
    advance(clock, HEARTBEAT_MAX_BACKOFF_MS)
    await heartbeat.tick()
    expect(sent).toHaveLength(2)
  })

  /**
   * P7: the ceiling is the heartbeat's own now rather than whatever `answer-queue.ts`
   * happens to use. The two numbers are equal today, so this test cannot tell them
   * apart by value -- what it guarantees is that retuning the *money* retry no longer
   * moves telemetry, which is what the implicit coupling risked. Proved by changing
   * `MAX_BACKOFF_MS` alone and watching this stay green.
   */
  it('caps its retry at its own ceiling rather than the money queue one (P7)', async () => {
    const clock = { now: new Date('2026-09-10T10:00:00.000Z') }
    const { heartbeat, sent } = failing(clock)

    // Saturate the doubling schedule well past the ceiling.
    for (let i = 0; i < 12; i++) {
      await heartbeat.tick()
      advance(clock, HEARTBEAT_MAX_BACKOFF_MS)
    }
    const saturated = sent.length

    await heartbeat.tick()
    advance(clock, HEARTBEAT_MAX_BACKOFF_MS - 1000)
    await heartbeat.tick()
    expect(sent, 'it retried before its own ceiling').toHaveLength(saturated + 1)

    advance(clock, 2000)
    await heartbeat.tick()
    expect(sent, 'it did not retry once the ceiling had passed').toHaveLength(saturated + 2)
  })
})
