import { describe, it, expect } from 'vitest'
import { withFetchDiagnostics } from '../helpers/daemon.js'

/**
 * The diagnostic itself, watched working. A diagnostic nobody has seen fire is the same as no
 * diagnostic -- this repo has shipped twelve tests that asserted nothing -- and this one exists to be
 * read at the *next* failure, by someone who will trust whatever it prints.
 *
 * Written against an injected `fetch` rather than a real socket: the failures it explains are rare
 * and timing-dependent, so waiting for a genuine ECONNRESET would be waiting for the very thing that
 * could not be reproduced in seven runs. What must be true is a property of the wrapper, and that is
 * testable directly.
 */
const throwing = (err: unknown): typeof fetch => (async () => { throw err }) as unknown as typeof fetch

describe('the fetch diagnostic', () => {
  it('names the url and the cause code that `TypeError: fetch failed` hides', async () => {
    const inner = throwing(Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNRESET' } }))
    await expect(withFetchDiagnostics(inner)('http://127.0.0.1:47321/v1/status'))
      .rejects.toThrow('fetch http://127.0.0.1:47321/v1/status failed: ECONNRESET')
  })

  // The half that keeps the diagnostic from becoming the thing it was written to prevent. An error it
  // cannot explain must arrive exactly as it was thrown -- same object, same message -- because a
  // wrapper that rewrites what it does not understand destroys the evidence it exists to preserve.
  // Asserted with `toBe`, on identity, so a rewrite that happened to keep the message still fails.
  // This assertion was the opposite one round ago, and the change is the point. `code` is optional:
  // measured on this machine, a refused connection carries `cause.message` of "bad port" and no code
  // at all, while only a DNS failure carries ENOTFOUND. Conditioning on `code` left the diagnostic
  // silent on the commonest local shape -- a dead port, which is what a torn-down daemon produces --
  // and it was caught by the next failure rather than by this file.
  it('names the cause by its message when the cause carries no code', async () => {
    const noCode = Object.assign(new TypeError('fetch failed'), { cause: { message: 'bad port' } })
    await expect(withFetchDiagnostics(throwing(noCode))('http://127.0.0.1:1/x'))
      .rejects.toThrow('fetch http://127.0.0.1:1/x failed: bad port')
  })

  // The no-swallow half, intact where it still matters: an error with no cause at all, or a cause
  // that names neither a code nor a message, arrives exactly as it was thrown. `pane.test.ts` throws
  // bare `new Error('ECONNREFUSED')` with no cause, and rewriting that destroys the evidence this
  // exists to preserve. Asserted on identity, so a rewrite that happened to keep the message fails.
  it('rethrows an error that names nothing exactly as it arrived', async () => {
    const original = new Error('something else entirely')
    await expect(withFetchDiagnostics(throwing(original))('http://x/')).rejects.toBe(original)

    const emptyCause = Object.assign(new TypeError('fetch failed'), { cause: {} })
    await expect(withFetchDiagnostics(throwing(emptyCause))('http://x/')).rejects.toBe(emptyCause)
  })

  // Three shapes the earlier versions could not name, each measured rather than imagined. A `cause`
  // that is a STRING has no `.code` and no `.message`, so the detail came back null and the error was
  // rethrown naming nothing -- the same silence as the code-only bug, one shape further out.
  it('names a cause that is a string', async () => {
    const strCause = Object.assign(new TypeError('fetch failed'), { cause: 'ECONNREFUSED' })
    await expect(withFetchDiagnostics(throwing(strCause))('http://x/'))
      .rejects.toThrow('fetch http://x/ failed: ECONNREFUSED')
  })

  // undici nests: the outer cause can carry an empty message with the real code one level further
  // down. Only the first level was inspected, so this named nothing either.
  it('names a code carried one level deeper than the first cause', async () => {
    const nested = Object.assign(new TypeError('fetch failed'), { cause: { message: '', cause: { code: 'ECONNRESET' } } })
    await expect(withFetchDiagnostics(throwing(nested))('http://x/'))
      .rejects.toThrow('fetch http://x/ failed: ECONNRESET')
  })

  // Double wrapping is not hypothetical. vitest forks each file today, but the daemon config pins
  // neither `pool` nor `isolate`, and turning isolation off -- the standard speed knob -- would run
  // two setups in one process and wrap the wrapper. The inner wrapper's Error then becomes the outer's
  // cause and the message degrades to `failed: fetch failed`: naming nothing, while still satisfying a
  // loose installation check. Wrapping is idempotent so the degradation cannot occur, which holds
  // however the config is later tuned -- a guard that survives the knob is worth more than pinning it.
  // The depth bound, which nothing held until this test: removing it left all 8 green, so it was
  // decoration. A cause chain can be circular -- an error whose cause is itself -- and an unbounded
  // walk recurses until `RangeError: Maximum call stack size exceeded`, which does not merely fail to
  // name the cause: it DESTROYS the original error and reports the diagnostic's own stack overflow in
  // its place. Exactly the evidence-destroying behaviour the no-swallow rule exists to prevent, so it
  // is asserted on identity.
  it('rethrows the original when the cause chain is circular, rather than recursing into it', async () => {
    const circular: { code?: string; message?: string; cause?: unknown } = {}
    circular.cause = circular
    const looping = Object.assign(new TypeError('fetch failed'), { cause: circular })
    await expect(withFetchDiagnostics(throwing(looping))('http://x/')).rejects.toBe(looping)
  })

  it('is idempotent, so wrapping a wrapper cannot degrade the message', async () => {
    const inner = throwing(Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNRESET' } }))
    const once = withFetchDiagnostics(inner)
    expect(withFetchDiagnostics(once)).toBe(once)
    await expect(withFetchDiagnostics(once)('http://x/')).rejects.toThrow('fetch http://x/ failed: ECONNRESET')
  })

  // Watched passing on input that should pass (R99, plan 2): a wrapper that rejected everything would
  // satisfy both checks above.
  it('passes a successful response through untouched', async () => {
    const res = new Response('ok')
    const inner = (async () => res) as unknown as typeof fetch
    await expect(withFetchDiagnostics(inner)('http://x/')).resolves.toBe(res)
  })

  // The checks above prove the wrapper; this proves the SUITE has it. When the diagnostic stayed
  // silent on the failure it was written for, "it was never installed" was a live hypothesis, and it
  // took a Duration line (`setup 462ms`) to rule out rather than a test. A diagnostic nobody has
  // watched fire in situ is the same as no diagnostic, so this fires it through the real global
  // `fetch` that `test/setup.ts` patched. Port 1 is never listening, so the failure is real and
  // immediate, and the assertion is on the shape rather than on a code: the cause is "bad port" here
  // and ECONNREFUSED on POSIX, and pinning either would make this a test about one operating system.
  it('is installed on the global fetch this suite uses', async () => {
    // The negative lookahead is the point: `failed: .` was satisfied by `failed: fetch failed`, which
    // names nothing and is exactly what a double-wrapped diagnostic produces. An installation check
    // that passes on the degraded message would report health while reporting nothing.
    await expect(fetch('http://127.0.0.1:1/x')).rejects.toThrow(/^fetch http:\/\/127\.0\.0\.1:1\/x failed: (?!fetch failed)\S/)
  })
})
