// P8, resolved: the suite's oldest intermittent failure was never a race.
//
// `fetch http://127.0.0.1:<port>/v1/health failed: bad port` fired about one run in
// fifteen, and `test/helpers/daemon.ts` explained it as a torn-down daemon leaving a
// dead port behind. It was not. WHATWG fetch keeps a list of blocked ports and
// refuses them before it connects, and `startDaemon({ port: 0 })` lets the operating
// system hand out an ephemeral port that occasionally lands on that list -- after
// which every request in that run fails, deterministically, against a daemon that is
// running perfectly well. The two ports the real failures named were 6669 (irc) and
// 2049 (nfs), both on the list.
//
// This is the assertion under the retry in the harness. If Node ever stops blocking
// these, the retry becomes dead code and this is what says so.
import { describe, it, expect } from 'vitest'
import { createServer } from 'node:http'
import { fetchRefusesPort } from '../helpers/daemon.js'

describe('the ports fetch will not use', () => {
  it('refuses the ones the flaking daemons had been given', async () => {
    // Nothing is listening on any of these; the refusal is fetch's own and happens
    // before a connection is attempted, which is why a live daemon did not help.
    for (const port of [2049, 6669, 1719, 6000]) {
      expect(await fetchRefusesPort(port), `${port} is no longer blocked`).toBe(true)
    }
  })

  it('does not refuse an ordinary one, whether or not anything answers', async () => {
    // Both halves, because "returns true for everything" would pass the test above.
    // 47321 is the daemon's own first choice and is deliberately off the list.
    expect(await fetchRefusesPort(47321), 'a closed ordinary port reads as refused').toBe(false)

    const server = createServer((_, res) => res.end('ok'))
    await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok))
    const port = (server.address() as { port: number }).port
    try {
      expect(await fetchRefusesPort(port), 'a port being served reads as refused').toBe(false)
    } finally {
      await new Promise<void>((ok) => server.close(() => ok()))
    }
  })
})
