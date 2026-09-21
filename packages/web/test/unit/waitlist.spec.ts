import { describe, it, expect } from 'vitest'
import { submitWaitlist } from '../../src/app/lib/waitlist'

describe('submitWaitlist', () => {
  it('validates email locally and posts json to the endpoint', async () => {
    const calls: Array<{ url: string; init: RequestInit }> = []
    const fetchFn = (async (url: string, init: RequestInit) => { calls.push({ url, init }); return new Response('{}', { status: 200 }) }) as unknown as typeof fetch
    expect(await submitWaitlist(fetchFn, 'https://formspree.io/f/x', { email: 'nope', audience: 'developer' })).toBe('invalid')
    expect(calls).toHaveLength(0)
    expect(await submitWaitlist(fetchFn, 'https://formspree.io/f/x', { email: 'a@b.co', audience: 'buyer' })).toBe('ok')
    expect(calls[0]!.url).toBe('https://formspree.io/f/x')
    expect(JSON.parse(String(calls[0]!.init.body))).toEqual({ email: 'a@b.co', audience: 'buyer' })
  })
  it('reports failure on network errors, non-2xx, and a missing endpoint', async () => {
    const failing = (async () => { throw new Error('offline') }) as unknown as typeof fetch
    expect(await submitWaitlist(failing, 'https://formspree.io/f/x', { email: 'a@b.co', audience: 'buyer' })).toBe('failed')
    const bad = (async () => new Response('', { status: 500 })) as unknown as typeof fetch
    expect(await submitWaitlist(bad, 'https://formspree.io/f/x', { email: 'a@b.co', audience: 'buyer' })).toBe('failed')
    expect(await submitWaitlist(bad, '', { email: 'a@b.co', audience: 'buyer' })).toBe('failed')
  })
  // The missing-endpoint case above is checked through a stub that returns 500 for
  // every call, so it reports 'failed' whether or not the guard exists — deleting
  // `if (!endpoint)` leaves it green (verified). A stub that would have succeeded
  // is what makes the guard visible, and `VITE_WAITLIST_ENDPOINT` is unset in this
  // repo, so this is the path the shipped page actually takes.
  it('never posts when the endpoint is missing', async () => {
    const calls: string[] = []
    const ok = (async (url: string) => { calls.push(url); return new Response('{}', { status: 200 }) }) as unknown as typeof fetch
    expect(await submitWaitlist(ok, '', { email: 'a@b.co', audience: 'developer' })).toBe('failed')
    expect(calls).toHaveLength(0)
  })
})

/**
 * A signup the developer is told happened, and did not. `res.ok` alone said "on the
 * list" for any 200 -- including the three below, which are what a misconfigured
 * endpoint actually returns: a form provider rejecting the submission in the body,
 * a URL that resolves to some SPA's shell, and a proxy sign-in page. Spec §7's gate
 * is 200 developers on the waitlist, and the failure message names an email address
 * they can use instead, so being told "sent" is strictly worse than being told
 * "couldn't".
 *
 * Each case is a separate `it` on purpose: one test with five stubs reports a single
 * red and hides which shape stopped being caught.
 */
describe('submitWaitlist reads the body, not just the status', () => {
  // `new Response('', { status: 204 })` throws -- a null-body status may not carry
  // one -- so 204 is constructed the way the platform actually produces it.
  const post = (body: string, status = 200) =>
    submitWaitlist((async () => new Response(status === 204 ? null : body, { status })) as unknown as typeof fetch,
      'https://formspree.io/f/x', { email: 'a@b.co', audience: 'developer' })

  it('accepts the success bodies a form endpoint sends', async () => {
    // The affirmative shapes, so the check cannot be "reject everything" -- which
    // would pass every failure test below and collect nothing.
    expect(await post('{}')).toBe('ok')
    expect(await post('{"ok":true}')).toBe('ok')
    expect(await post('{"next":"https://formspree.io/thanks"}')).toBe('ok')
    // 204, and a 200 with nothing in it: there is no body to contradict the status.
    expect(await post('', 204)).toBe('ok')
    expect(await post('   ')).toBe('ok')
  })

  it('refuses a 200 whose body reports an error', async () => {
    expect(await post('{"errors":[{"message":"Form not found"}]}')).toBe('failed')
    expect(await post('{"error":"inactive form"}')).toBe('failed')
    expect(await post('{"ok":false}')).toBe('failed')
    expect(await post('{"success":false}')).toBe('failed')
  })

  it('refuses a 200 that is not json at all', async () => {
    // What a wrong URL returns: the SPA fallback serves index.html with 200, which
    // is exactly the shape `public.spec.ts` pins for an unknown path.
    expect(await post('<!doctype html><title>Tickover</title>')).toBe('failed')
    expect(await post('OK')).toBe('failed')
  })

  it('refuses a body it cannot read', async () => {
    const torn = (async () => ({
      ok: true,
      status: 200,
      text: () => Promise.reject(new Error('connection reset')),
    })) as unknown as typeof fetch
    expect(await submitWaitlist(torn, 'https://formspree.io/f/x', { email: 'a@b.co', audience: 'buyer' })).toBe('failed')
  })

  // An empty errors array is a success shape, not a failure one, and treating any
  // `errors` key as fatal would reject it.
  it('does not read an empty errors array as an error', async () => {
    expect(await post('{"errors":[]}')).toBe('ok')
  })

  // Where the check stops, written down rather than left to be discovered. Only an
  // *object* can carry an error marker, so a JSON scalar reads as success — a 200
  // whose whole body is the JSON string "Form not found" is reported as sent. No form
  // endpoint answers that way, and widening the rule to "any JSON string is an error"
  // would reject `"ok"` just as readily. The plain-text form of the same body is not
  // JSON at all and is already refused above.
  /**
   * The branch review's finding: `b['error'] !== false` was untested. Reducing it to
   * `b['error'] != null` — so `{"error": false}` reads as a failed signup — left the
   * waitlist and landing suites at 27/27.
   *
   * It matters in R86's own stated cost-if-wrong direction: refusing a signup that did
   * happen. `{"ok": true, "error": false}` is an ordinary success envelope, and reading
   * the *presence* of the key as failure is the mirror of the bug this function fixes.
   */
  it('does not read an explicit "error": false as an error', async () => {
    expect(await post('{"error":false}')).toBe('ok')
    expect(await post('{"ok":true,"error":false}')).toBe('ok')
    // And the truthy side still fails, so this is not "ignore the key entirely".
    expect(await post('{"error":"inactive form"}')).toBe('failed')
    expect(await post('{"error":true}')).toBe('failed')
  })

  it('treats a json scalar as success, which is the edge of what it can tell', async () => {
    expect(await post('"Form not found"')).toBe('ok')
    expect(await post('true')).toBe('ok')
    expect(await post('null')).toBe('ok')
  })
})
