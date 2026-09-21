import { describe, it, expect } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, appendFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { TranscriptWatcher } from '../../src/transcript-watch.js'
import type { HookEvent } from '../../src/http.js'

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/**
 * P9: both tests below used to fail about one run in thirty, and the reason was in
 * the tests rather than in the watcher.
 *
 * `touch()` arms the silence timer on the **first** write, not on the last one, so a
 * test that writes, sleeps 150ms and appends is betting twice on a 150ms margin
 * against a 300ms window: once that the append lands before the turn ends, and again
 * that the assertion runs before it. A `sleep(150)` has no upper bound on a loaded
 * machine. When the first one overshot, the turn ended between the two writes and the
 * second write correctly opened a new one -- which is how a test that writes the file
 * exactly twice observed `['UserPromptSubmit', 'Stop', 'UserPromptSubmit']`. The third
 * event was the watcher being right.
 *
 * So the fixed-length sleeps are gone wherever an event can be waited for instead, and
 * the window is wide enough that what remains is not a coin toss. What cannot be waited
 * for is an *absence* -- "no Stop yet" -- and that one keeps a sleep, with the margin
 * raised from 150ms to 800ms.
 */
const SILENCE = 1000
/** Comfortably inside `SILENCE`, and the only place a sleep still carries an assertion. */
const QUIET = 200

/** Waits for the watcher to have emitted `n` events instead of sleeping until it probably has. */
async function seen(events: HookEvent[], n: number, within = 4000): Promise<void> {
  const deadline = Date.now() + within
  while (events.length < n && Date.now() < deadline) await sleep(10)
  expect(events.length, `only ${events.length} of ${n} events arrived in ${within}ms`).toBeGreaterThanOrEqual(n)
}

/**
 * Writes until the watcher answers, because `fs.watch`'s recursive attach is not
 * synchronous and a write that lands first is simply never seen. Sleeping long enough
 * that it has probably attached was a third margin nobody had counted.
 *
 * Repeating the write is safe and is in fact a stronger setup than one write: every
 * one of them is inside the silence window, so the assertion that exactly one start
 * event came out is now made against several writes rather than one.
 */
async function writeUntilSeen(file: string, events: HookEvent[]): Promise<void> {
  for (let i = 0; i < 150 && events.length === 0; i++) {
    writeFileSync(file, '{"type":"user"}\n')
    await sleep(20)
  }
  await seen(events, 1)
}

function stage(): { root: string; file: string; events: HookEvent[] } {
  const root = mkdtempSync(join(tmpdir(), 'mw-claude-'))
  const project = join(root, 'C--proj')
  mkdirSync(project)
  return { root, file: join(project, '8f0b0f2e-6f6a-4a3a-9c1f-0f1e2d3c4b5a.jsonl'), events: [] }
}

describe('TranscriptWatcher', () => {
  it('starts a turn on jsonl writes and ends it after silence', async () => {
    const { root, file, events } = stage()
    const w = new TranscriptWatcher({ root, onHook: (e) => events.push(e), silenceMs: SILENCE })
    w.start()
    try {
      await writeUntilSeen(file, events)
      expect(events.map((e) => e.event)).toEqual(['UserPromptSubmit'])
      expect(events[0]!.session_id).toBe('8f0b0f2e-6f6a-4a3a-9c1f-0f1e2d3c4b5a')

      // On the observed start rather than after a fixed sleep: the timer was armed when
      // that event fired, so appending now lands with the whole window still to run.
      appendFileSync(file, '{"type":"assistant"}\n')
      await sleep(QUIET)
      expect(events.map((e) => e.event), 'an append inside the window neither re-announces nor ends the turn').toEqual(['UserPromptSubmit'])

      await seen(events, 2)
      expect(events.map((e) => e.event)).toEqual(['UserPromptSubmit', 'Stop'])
    } finally {
      w.stop()
    }
  })

  // The test above only shows a fresh write starting a turn once. Without this, a watcher that
  // fired 'UserPromptSubmit' on *every* write (never tracking "already active") would still pass
  // it -- the appends would just add unasserted events that .toEqual happens to reject only
  // because of the trailing Stop. Assert the appends never re-announce the start, and that a
  // write after the turn has ended starts a genuinely new one.
  it('does not re-announce an already-active turn, and starts a new one after the turn ends', async () => {
    const { root, file, events } = stage()
    const w = new TranscriptWatcher({ root, onHook: (e) => events.push(e), silenceMs: SILENCE })
    w.start()
    try {
      await writeUntilSeen(file, events)
      appendFileSync(file, '{"type":"assistant"}\n')
      await sleep(QUIET)
      appendFileSync(file, '{"type":"user"}\n')
      await sleep(QUIET)
      expect(events.map((e) => e.event), 'writes inside the window add no second start').toEqual(['UserPromptSubmit'])

      await seen(events, 2)
      expect(events.map((e) => e.event)).toEqual(['UserPromptSubmit', 'Stop'])

      // A write after the turn ended is a new turn, not silence extending the old one.
      // This is the sequence P9's flake stumbled into by accident; here it is on purpose.
      appendFileSync(file, '{"type":"user"}\n')
      await seen(events, 3)
      expect(events.map((e) => e.event)).toEqual(['UserPromptSubmit', 'Stop', 'UserPromptSubmit'])
    } finally {
      w.stop()
    }
  })

  // Round1 review, finding4: `fs.watch` throws SYNCHRONOUSLY (not via the 'error' event) when
  // `root` doesn't exist -- entirely plausible for this fallback's default root
  // (~/.claude/projects) on a machine that's never run Claude Code at all. Before this fix,
  // start() had no try/catch around it, so enabling this opt-in fallback on such a machine would
  // throw out of start() (and, since daemon.ts's `watcher?.start()` isn't wrapped either, crash
  // the whole daemon at startup) instead of just leaving the fallback inert and reported.
  it('does not throw when the root does not exist yet, and reports it instead of failing silently', () => {
    const errors: Array<{ msg: string; data?: unknown }> = []
    const w = new TranscriptWatcher({
      root: join(tmpdir(), 'mw-transcript-root-does-not-exist'),
      onHook: () => {},
      log: { error: (msg, data) => errors.push({ msg, data }) },
    })
    expect(() => w.start()).not.toThrow()
    expect(errors).toHaveLength(1)
    w.stop()
  })

  /**
   * P6: a watch that started fine can still fail later -- the root removed mid-run, an
   * OS-level watch limit -- and the handler for that was the one path in this file with
   * no test. The comment beside it says going dark silently would leave a developer
   * relying on this fallback with no clue why it stopped, which is a claim nothing
   * checked.
   *
   * Reaching through to the live `FSWatcher` rather than contriving a real failure: there
   * is no portable way to make a running recursive watch fail on demand, and the
   * alternative is the one P6 recorded -- leaving it untested. The handler is three lines
   * and this asserts all three.
   */
  it('reports a watcher that fails after it started, instead of going dark (P6)', () => {
    const root = mkdtempSync(join(tmpdir(), 'mw-claude-'))
    const errors: Array<{ msg: string; data?: unknown }> = []
    const w = new TranscriptWatcher({ root, onHook: () => {}, log: { error: (msg, data) => errors.push({ msg, data }) } })
    w.start()
    const live = (w as unknown as { watcher: { emit(event: string, err: Error): boolean } | null }).watcher
    expect(live, 'the watcher never started, so this would have proved nothing').not.toBeNull()

    live!.emit('error', new Error('EMFILE: too many open files'))
    expect(errors).toEqual([{ msg: 'transcript watcher error', data: { message: 'EMFILE: too many open files' } }])
    w.stop()
  })
})
