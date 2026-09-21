import { describe, it, expect, vi } from 'vitest'
import { EventEmitter } from 'node:events'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runPane } from '../../src/pane.js'
import { writeDaemonInfo } from '../../src/config.js'
import { servedQuestion } from '../helpers/fake-server.js'
import type { QuestionView } from '../../src/http.js'

// Minimal stand-ins for process.stdin/stdout: an EventEmitter carries the 'data'/'resize' events
// runPane listens on, plus the handful of methods/properties it actually touches. rawModeCalls
// records every setRawMode call in order, which is exactly what C1/C2 need to verify -- that the
// terminal is put back, and put back exactly once, on every exit path.
class FakeStdin extends EventEmitter {
  rawModeCalls: boolean[] = []
  paused = false
  setRawMode(v: boolean): this { this.rawModeCalls.push(v); return this }
  resume(): this { this.paused = false; return this }
  pause(): this { this.paused = true; return this }
  setEncoding(): this { return this }
}
class FakeStdout extends EventEmitter {
  writes: string[] = []
  columns = 80
  rows = 24
  write(s: string): boolean { this.writes.push(s); return true }
}

// A `/v1/events` response body that never emits and never closes -- these tests aren't about SSE
// updates, so the reader's loop just parks on `reader.read()` forever, harmlessly, and never fires
// pane.ts's own "connection ended" cleanup (which is covered separately by the answer-failure
// case below reaching its cleanup via the key-handler path instead).
function hangingEventsBody(): ReadableStream {
  return new ReadableStream()
}

// Closes immediately with no data and no error -- simulates the daemon ending the SSE connection
// cleanly (e.g. a graceful shutdown), which must be treated as "connection ended" exactly like an
// outright network failure (round2: restore()'s four documented exit paths -- quit, key-handler
// throw, SSE end, process-exit backstop -- only had committed tests for the first two).
function closingEventsBody(): ReadableStream {
  return new ReadableStream({ start: (controller) => controller.close() })
}

// A `/v1/events` body a test can push real SSE frames into, one at a time, and close when done.
function scriptedEventsBody(): { body: ReadableStream; send: (event: string, data: unknown) => void; close: () => void } {
  let controller!: ReadableStreamDefaultController<Uint8Array>
  const encoder = new TextEncoder()
  const body = new ReadableStream<Uint8Array>({ start: (c) => { controller = c } })
  return {
    body,
    send: (event, data) => controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)),
    close: () => controller.close(),
  }
}

async function waitForListener(emitter: EventEmitter, event: string): Promise<void> {
  while (emitter.listenerCount(event) === 0) await new Promise((r) => setTimeout(r, 5))
}

// The pane redraws by writing the whole screen, so the last write is the current display.
async function lastDraw(stdout: { writes: string[] }): Promise<string> {
  await new Promise((r) => setTimeout(r, 20))
  return stdout.writes[stdout.writes.length - 1] ?? ''
}

function baseView(question: ReturnType<typeof servedQuestion> | null = null): QuestionView {
  return { question, shown_at: null, balance_pending_cents: 0, balance_available_cents: 0, today_paid_answers: 0, logged_in: true }
}

describe('runPane', () => {
  it('quits and restores the terminal on Ctrl-C (round1 finding C1)', async () => {
    const home = mkdtempSync(join(tmpdir(), 'mw-pane-'))
    writeDaemonInfo(home, { port: 1, token: 'tok', pid: 999_001, startedAt: new Date().toISOString() })
    const stdin = new FakeStdin()
    const stdout = new FakeStdout()
    const fetchFn = (async (url: string | URL) => {
      const u = url.toString()
      if (u.endsWith('/v1/health')) return new Response(JSON.stringify({ ok: true }), { status: 200 })
      if (u.endsWith('/v1/question')) return new Response(JSON.stringify(baseView()), { status: 200 })
      if (u.endsWith('/v1/events')) return new Response(hangingEventsBody(), { status: 200 })
      return new Response('{}', { status: 200 })
    }) as unknown as typeof fetch

    const donePromise = runPane(home, { stdin: stdin as unknown as NodeJS.ReadStream, stdout: stdout as unknown as NodeJS.WriteStream, fetchFn })
    await waitForListener(stdin, 'data')

    // The real Ctrl-C byte, not an empty string -- these are easy to confuse once typed directly
    // into a string literal (round1's review made exactly that mistake reading pane-view.ts).
    stdin.emit('data', String.fromCharCode(3))
    await donePromise

    expect(stdin.rawModeCalls).toEqual([true, false])
    expect(stdin.paused).toBe(true)
    // Pins the clear-screen sequence's actual bytes (round2: this exact literal was found
    // pasted as a raw, invisible ESC byte in source -- the same hazard class as C1 -- and
    // nothing here had ever asserted on draw()'s content to catch it).
    expect(stdout.writes[0]).toMatch(/^\x1B\[2J\x1B\[H/)
    rmSync(home, { recursive: true, force: true })
  })

  it('does not treat a real empty string as Ctrl-C and does not quit', async () => {
    const home = mkdtempSync(join(tmpdir(), 'mw-pane-'))
    writeDaemonInfo(home, { port: 1, token: 'tok', pid: 999_002, startedAt: new Date().toISOString() })
    const stdin = new FakeStdin()
    const stdout = new FakeStdout()
    const fetchFn = (async (url: string | URL) => {
      const u = url.toString()
      if (u.endsWith('/v1/health')) return new Response(JSON.stringify({ ok: true }), { status: 200 })
      if (u.endsWith('/v1/question')) return new Response(JSON.stringify(baseView()), { status: 200 })
      if (u.endsWith('/v1/events')) return new Response(hangingEventsBody(), { status: 200 })
      return new Response('{}', { status: 200 })
    }) as unknown as typeof fetch

    const donePromise = runPane(home, { stdin: stdin as unknown as NodeJS.ReadStream, stdout: stdout as unknown as NodeJS.WriteStream, fetchFn })
    await waitForListener(stdin, 'data')

    stdin.emit('data', '')
    // Give the (non-quitting) key a moment to be handled, then quit for real so the test ends.
    await new Promise((r) => setTimeout(r, 20))
    expect(stdin.rawModeCalls).toEqual([true]) // not yet restored -- '' didn't quit
    stdin.emit('data', String.fromCharCode(3))
    await donePromise
    expect(stdin.rawModeCalls).toEqual([true, false])
    rmSync(home, { recursive: true, force: true })
  })

  it('restores the terminal and does not crash the process when an answer request fails (round1 finding C2)', async () => {
    const home = mkdtempSync(join(tmpdir(), 'mw-pane-'))
    writeDaemonInfo(home, { port: 1, token: 'tok', pid: 999_003, startedAt: new Date().toISOString() })
    const stdin = new FakeStdin()
    const stdout = new FakeStdout()
    const question = servedQuestion()
    const fetchFn = (async (url: string | URL, init?: { method?: string }) => {
      const u = url.toString()
      if (u.endsWith('/v1/health')) return new Response(JSON.stringify({ ok: true }), { status: 200 })
      if (u.endsWith('/v1/question')) return new Response(JSON.stringify(baseView(question)), { status: 200 })
      if (u.endsWith('/v1/events')) return new Response(hangingEventsBody(), { status: 200 })
      // The exact scenario this pane must survive: the daemon is gone by the time an answer is
      // submitted. Before the fix, this rejection was awaited inside an `on('data', async ...)`
      // handler with no try/catch -- an unhandled rejection that kills the process outside the
      // 'quit' branch, so setRawMode(false) never ran.
      if (u.endsWith('/v1/answer') && init?.method === 'POST') throw new Error('ECONNREFUSED')
      return new Response('{}', { status: 200 })
    }) as unknown as typeof fetch

    const donePromise = runPane(home, { stdin: stdin as unknown as NodeJS.ReadStream, stdout: stdout as unknown as NodeJS.WriteStream, fetchFn })
    await waitForListener(stdin, 'data')

    stdin.emit('data', '1') // answers option 1, which the fake fetchFn fails
    // If this hangs, the promise below never settles and the test times out -- that failure mode
    // itself would mean the process was left broken (raw mode never restored) exactly as C2
    // described, whether or not vitest also reports an unhandled rejection.
    await donePromise

    expect(stdin.rawModeCalls).toEqual([true, false])
    expect(stdout.writes.some((w) => w.includes('lost connection to the daemon'))).toBe(true)
    rmSync(home, { recursive: true, force: true })
  })

  it('restores the terminal and exits when the SSE connection fails outright (round2)', async () => {
    const home = mkdtempSync(join(tmpdir(), 'mw-pane-'))
    writeDaemonInfo(home, { port: 1, token: 'tok', pid: 999_004, startedAt: new Date().toISOString() })
    const stdin = new FakeStdin()
    const stdout = new FakeStdout()
    const fetchFn = (async (url: string | URL) => {
      const u = url.toString()
      if (u.endsWith('/v1/health')) return new Response(JSON.stringify({ ok: true }), { status: 200 })
      if (u.endsWith('/v1/question')) return new Response(JSON.stringify(baseView()), { status: 200 })
      // The daemon vanished mid-session before the pane ever got a keypress -- the SSE fetch
      // itself rejects, exercising onSseEnded's error arm (`.then(_, (err) => onSseEnded(err))`).
      if (u.endsWith('/v1/events')) throw new Error('ECONNRESET')
      return new Response('{}', { status: 200 })
    }) as unknown as typeof fetch

    const donePromise = runPane(home, { stdin: stdin as unknown as NodeJS.ReadStream, stdout: stdout as unknown as NodeJS.WriteStream, fetchFn })
    // No keypress at all -- the SSE failure alone must end the pane and restore the terminal.
    await donePromise

    expect(stdin.rawModeCalls).toEqual([true, false])
    expect(stdout.writes.some((w) => w.includes('lost connection to the daemon'))).toBe(true)
    rmSync(home, { recursive: true, force: true })
  })

  it('restores the terminal and exits when the SSE connection ends cleanly (round2)', async () => {
    const home = mkdtempSync(join(tmpdir(), 'mw-pane-'))
    writeDaemonInfo(home, { port: 1, token: 'tok', pid: 999_005, startedAt: new Date().toISOString() })
    const stdin = new FakeStdin()
    const stdout = new FakeStdout()
    const fetchFn = (async (url: string | URL) => {
      const u = url.toString()
      if (u.endsWith('/v1/health')) return new Response(JSON.stringify({ ok: true }), { status: 200 })
      if (u.endsWith('/v1/question')) return new Response(JSON.stringify(baseView()), { status: 200 })
      // The daemon closed the stream without ever erroring (e.g. a graceful shutdown) --
      // exercises onSseEnded's success arm (`.then(() => onSseEnded(), _)`), which a bare
      // `.catch(() => {})` (the pre-round1 code) would never have reached at all.
      if (u.endsWith('/v1/events')) return new Response(closingEventsBody(), { status: 200 })
      return new Response('{}', { status: 200 })
    }) as unknown as typeof fetch

    const donePromise = runPane(home, { stdin: stdin as unknown as NodeJS.ReadStream, stdout: stdout as unknown as NodeJS.WriteStream, fetchFn })
    await donePromise

    expect(stdin.rawModeCalls).toEqual([true, false])
    expect(stdout.writes.some((w) => w.includes('lost connection to the daemon'))).toBe(true)
    rmSync(home, { recursive: true, force: true })
  })

  // Whole-branch review I5. The daemon expires the answered confirmation after 10 seconds and
  // says so with a `question` frame carrying `question: null`; the pane only cleared on a frame
  // that CARRIED a question, so the ✓ survived until the next question -- five minutes at best.
  // Driven over real SSE frames, because that is the channel the signal travels on: a test that
  // called renderPane directly could never see the frame-handling decision at all.
  it('clears the ✓ when the daemon expires it, but not on hook-driven status traffic (I5)', async () => {
    const home = mkdtempSync(join(tmpdir(), 'mw-pane-'))
    writeDaemonInfo(home, { port: 1, token: 'tok', pid: 999_007, startedAt: new Date().toISOString() })
    const stdin = new FakeStdin()
    const stdout = new FakeStdout()
    const events = scriptedEventsBody()
    const fetchFn = (async (url: string | URL) => {
      const u = url.toString()
      if (u.endsWith('/v1/health')) return new Response(JSON.stringify({ ok: true }), { status: 200 })
      if (u.endsWith('/v1/question')) return new Response(JSON.stringify(baseView(servedQuestion())), { status: 200 })
      if (u.endsWith('/v1/events')) return new Response(events.body, { status: 200 })
      return new Response('{}', { status: 200 })
    }) as unknown as typeof fetch

    const donePromise = runPane(home, { stdin: stdin as unknown as NodeJS.ReadStream, stdout: stdout as unknown as NodeJS.WriteStream, fetchFn })
    await waitForListener(stdin, 'data')

    // The daemon's own answer sequence: the cleared-question frame, then the payment.
    events.send('question', baseView())
    events.send('answered', { accepted: true, reason: 'ok', earned_cents: 50 })
    expect(await lastDraw(stdout)).toContain('✓ +$0.50')

    // A hook lands mid-window (a turn ending, say). Nothing about the payment changed, so the
    // confirmation must survive -- clearing here would cut it short by eight seconds.
    events.send('status', baseView())
    expect(await lastDraw(stdout)).toContain('✓ +$0.50')

    // Now the daemon's 10-second TTL fires. This frame is the only signal the pane ever gets.
    events.send('question', baseView())
    expect(await lastDraw(stdout)).not.toContain('✓')

    // I6: `duplicate` arrives accepted:true with zero cents. A checkmark and a $0.00 reads as a
    // payment of nothing; the pane must say what actually happened instead.
    events.send('answered', { accepted: true, reason: 'duplicate', earned_cents: 0 })
    const afterDuplicate = await lastDraw(stdout)
    expect(afterDuplicate).not.toContain('✓')
    expect(afterDuplicate).not.toContain('✓ +$0.00') // the exact rendering the finding named
    expect(afterDuplicate).toMatch(/already/i)

    stdin.emit('data', String.fromCharCode(3))
    await donePromise
    rmSync(home, { recursive: true, force: true })
  })

  it('restores the terminal via the process-exit backstop when nothing else has quit yet (round2)', async () => {
    const home = mkdtempSync(join(tmpdir(), 'mw-pane-'))
    writeDaemonInfo(home, { port: 1, token: 'tok', pid: 999_006, startedAt: new Date().toISOString() })
    const stdin = new FakeStdin()
    const stdout = new FakeStdout()
    const fetchFn = (async (url: string | URL) => {
      const u = url.toString()
      if (u.endsWith('/v1/health')) return new Response(JSON.stringify({ ok: true }), { status: 200 })
      if (u.endsWith('/v1/question')) return new Response(JSON.stringify(baseView()), { status: 200 })
      if (u.endsWith('/v1/events')) return new Response(hangingEventsBody(), { status: 200 })
      return new Response('{}', { status: 200 })
    }) as unknown as typeof fetch

    // Spy on the real process.on rather than emitting a real 'exit' event: process.emit('exit')
    // would also fire every other listener registered on the shared test-worker process (vitest's
    // own included), which is unrelated blast radius this test has no business causing. Capturing
    // runPane's own listener and invoking it directly exercises exactly the backstop under test.
    const onSpy = vi.spyOn(process, 'on')
    const donePromise = runPane(home, { stdin: stdin as unknown as NodeJS.ReadStream, stdout: stdout as unknown as NodeJS.WriteStream, fetchFn })
    await waitForListener(stdin, 'data')
    expect(stdin.rawModeCalls).toEqual([true]) // still running -- nothing has quit yet

    const exitCall = onSpy.mock.calls.find(([event]) => event === 'exit')
    expect(exitCall).toBeDefined()
    const exitListener = exitCall![1] as () => void
    exitListener() // simulate the process exiting some other way entirely (e.g. an uncaught error)

    expect(stdin.rawModeCalls).toEqual([true, false])
    onSpy.mockRestore()
    // The backstop restores the terminal but -- correctly -- never resolves runPane's own promise
    // (a real process exit needs no one left to await it); nothing further to await here.
    stdin.removeAllListeners()
    void donePromise
    rmSync(home, { recursive: true, force: true })
  })
})
