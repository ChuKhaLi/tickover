// Phase 0 collects the developer waitlist through a third-party form endpoint
// (Formspree-style: a JSON POST, no server of ours involved). The variable is
// unset in this repo, so the empty string is the normal state here and must be
// reported as a failure rather than silently "sent" — see `submitWaitlist`.
export const WAITLIST_ENDPOINT: string = (import.meta as unknown as { env: Record<string, string | undefined> }).env?.['VITE_WAITLIST_ENDPOINT'] ?? ''

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/**
 * Whether a 200 body is a form endpoint saying no. Every provider spells success
 * differently -- Formspree answers `{"ok":true}` or `{"next":"..."}`, others answer
 * `{}` -- so requiring a particular success shape would refuse a working endpoint.
 * What they agree on is how they report a *failure*, and that is what is matched
 * here: an `error`, a non-empty `errors`, or an explicit false.
 *
 * An empty `errors` array is a success shape. Treating the key's presence as fatal
 * would reject it, which is the mirror of the bug this function is fixing.
 */
function reportsError(body: unknown): boolean {
  if (typeof body !== 'object' || body === null) return false
  const b = body as Record<string, unknown>
  if (b['ok'] === false || b['success'] === false) return true
  if (Array.isArray(b['errors'])) return b['errors'].length > 0
  return b['error'] != null && b['error'] !== false
}

/**
 * A 200 is not a signup. `res.ok` alone reported "You're on the list" for a form
 * endpoint rejecting the submission in its body, for a mistyped URL answered by
 * some SPA's `index.html` fallback, and for a proxy sign-in page -- the three
 * things a misconfigured deploy actually returns, on the number spec §7's Phase 0
 * gate is decided by.
 *
 * It fails closed: anything that is neither empty nor readable JSON without an
 * error in it reports 'failed'. The cost of being wrong that way is a developer
 * shown "Couldn't send. Email hello@tickover.dev instead." -- a route that still
 * reaches us -- against being told they are on a list that never received them.
 *
 * `VITE_WAITLIST_ENDPOINT` is unset in this repo, so the very first branch is the
 * one the shipped page takes today. Setting it is a build-time change; see
 * `.env.example`.
 */
export async function submitWaitlist(fetchFn: typeof fetch, endpoint: string, input: { email: string; audience: 'developer' | 'buyer' }): Promise<'ok' | 'invalid' | 'failed'> {
  if (!EMAIL.test(input.email)) return 'invalid'
  if (!endpoint) return 'failed'
  try {
    const res = await fetchFn(endpoint, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json' }, body: JSON.stringify({ email: input.email, audience: input.audience }) })
    if (!res.ok) return 'failed'
    // `text()` and not `json()`, because an empty 200 has to reach the branch below:
    // `json()` throws on an empty body, so it would report a bodyless success as a
    // failure. Everything `JSON.parse` then rejects lands in the catch, which is the
    // right answer for it -- a form endpoint that answers HTML is misconfigured.
    const body = (await res.text()).trim()
    if (body === '') return 'ok'
    return reportsError(JSON.parse(body) as unknown) ? 'failed' : 'ok'
  } catch { return 'failed' }
}
