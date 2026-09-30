import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest'
import { HeartbeatRequest, NextRequest } from '@tickover/contract'
import { startTestDaemon, type TestDaemon } from '../helpers/daemon.js'
import { servedQuestion } from '../helpers/fake-server.js'
import { HookEvent } from '../../src/http.js'

describe('GET /v1/status', () => {
  let t: TestDaemon
  // These tests exercise the logged-out status line and health, which is what startTestDaemon
  // gave every caller before Task 7 made "logged in with api-token-1" the default.
  beforeAll(async () => { t = await startTestDaemon({ loggedOut: true }) })
  afterAll(async () => { await t.stop() })

  it('tells a logged-out developer how to start', async () => {
    const res = await fetch(`${t.base}/v1/status?session_id=s1`, { headers: t.headers })
    expect((await res.json()).line).toBe('tickover · run /tickover:setup to start earning')
  })

  it('reports an active turn after a prompt hook', async () => {
    await fetch(`${t.base}/v1/hook`, { method: 'POST', headers: t.headers, body: JSON.stringify({ event: 'UserPromptSubmit', session_id: 's1', tool: 'claude-code' }) })
    expect(await (await fetch(`${t.base}/v1/health`, { headers: t.headers })).json()).toMatchObject({ activeTurn: true, sessions: 1 })
    await fetch(`${t.base}/v1/hook`, { method: 'POST', headers: t.headers, body: JSON.stringify({ event: 'Stop', session_id: 's1', tool: 'claude-code' }) })
    expect(await (await fetch(`${t.base}/v1/health`, { headers: t.headers })).json()).toMatchObject({ activeTurn: false })
  })

  it('records the tool version passed by the status line script', async () => {
    await fetch(`${t.base}/v1/hook`, { method: 'POST', headers: t.headers, body: JSON.stringify({ event: 'SessionStart', session_id: 's9', tool: 'claude-code' }) })
    await fetch(`${t.base}/v1/status?session_id=s9&version=2.1.90`, { headers: t.headers })
    expect(t.daemon.sessions.toolVersion()).toBe('2.1.90')
  })

  // Whole-branch review, Minor: the local API used to accept wider than the wire schema it feeds.
  // A value in the gap was recorded here and then made every outbound request 400 forever, with no
  // signal and no way back. Asserted against the contract's own schemas, so the two cannot drift
  // apart again by editing one of them.
  describe('local caps match the wire schema they feed', () => {
    it('refuses a session_id longer than NextRequest accepts, rather than tracking one it can never serve', async () => {
      const tooLong = 'x'.repeat(101)
      expect(NextRequest.safeParse({ session_id: tooLong, session_started_at: '2026-09-10T10:00:00.000Z', turn_started_at: '2026-09-10T10:00:00.000Z' }).success).toBe(false)
      expect(HookEvent.safeParse({ event: 'SessionStart', session_id: tooLong, tool: 'claude-code' }).success).toBe(false)

      const before = t.daemon.sessions.count()
      const res = await fetch(`${t.base}/v1/hook`, { method: 'POST', headers: t.headers, body: JSON.stringify({ event: 'SessionStart', session_id: tooLong, tool: 'claude-code' }) })
      expect(res.status).toBe(400)
      expect(t.daemon.sessions.count()).toBe(before)

      // And the longest id the wire does accept still gets through.
      const longest = 'y'.repeat(100)
      expect(NextRequest.safeParse({ session_id: longest, session_started_at: '2026-09-10T10:00:00.000Z', turn_started_at: '2026-09-10T10:00:00.000Z' }).success).toBe(true)
      const ok = await fetch(`${t.base}/v1/hook`, { method: 'POST', headers: t.headers, body: JSON.stringify({ event: 'SessionStart', session_id: longest, tool: 'claude-code' }) })
      expect(ok.status).toBe(204)
    })

    it('ignores a version longer than tool_version accepts instead of recording it into every heartbeat', async () => {
      const tooLong = '9'.repeat(41)
      expect(HeartbeatRequest.safeParse({ os: 'win32', tool: 'claude-code', tool_version: tooLong }).success).toBe(false)

      await fetch(`${t.base}/v1/hook`, { method: 'POST', headers: t.headers, body: JSON.stringify({ event: 'SessionStart', session_id: 'sv', tool: 'claude-code' }) })
      await fetch(`${t.base}/v1/status?session_id=sv&version=${tooLong}`, { headers: t.headers })
      expect(t.daemon.sessions.sessions().get('sv')?.toolVersion).toBeNull()

      // The longest version the wire accepts is still recorded, so this is a cap and not a ban.
      const longest = '8'.repeat(40)
      await fetch(`${t.base}/v1/status?session_id=sv&version=${longest}`, { headers: t.headers })
      expect(t.daemon.sessions.sessions().get('sv')?.toolVersion).toBe(longest)
    })
  })

})

// Spike 2026-09-06: Claude Code exports COLUMNS to the status line command and updates it on
// resize. The script forwards it here; the daemon owns composition, so the width has to cross this
// boundary. It is client-supplied on the display path -- "it is only the terminal width" says
// nothing about the range it can actually hold, so this pins the range, not just the happy path.
describe('GET /v1/status?cols=', () => {
  let t: TestDaemon
  beforeEach(async () => {
    t = await startTestDaemon()
    await fetch(`${t.base}/v1/hook`, { method: 'POST', headers: t.headers, body: JSON.stringify({ event: 'SessionStart', session_id: 'c1', tool: 'claude-code', cwd: 'C:/proj' }) })
    t.clock.advanceMinutes(3)
    await fetch(`${t.base}/v1/hook`, { method: 'POST', headers: t.headers, body: JSON.stringify({ event: 'UserPromptSubmit', session_id: 'c1', tool: 'claude-code', cwd: 'C:/proj' }) })
    t.clock.advanceMs(9_000)
    t.fake.nextQueue.push({ question: servedQuestion({ expires_at: new Date(t.clock.now.getTime() + 13 * 60_000).toISOString() }) })
    await t.daemon.loop.tick()
  })
  afterEach(async () => { await t.stop() })

  const lineAt = async (cols?: string) => {
    const qs = cols === undefined ? '' : `&cols=${encodeURIComponent(cols)}`
    const res = await fetch(`${t.base}/v1/status?session_id=c1${qs}`, { headers: t.headers })
    return (await res.json()).line as string
  }

  it('serves the question at all, composed whole on a normal terminal', async () => {
    // The guard on every other test in this block. Without it, a fixture that quietly serves no
    // question would make the suppression test below pass for entirely the wrong reason.
    expect(await lineAt('120')).toBe('tickover · Acme DB · $0.50 · Which tagline? 1 Postgres, faster  2 Cached DB · answer: tickover pane')
  })

  it('keeps both options when no width is reported and the fallback budget bites', async () => {
    // The 80-column fallback minus the safety margin is 74, and this question composes to 76. The
    // two columns come off the question text; the options are what the developer needs.
    const line = await lineAt()
    expect(line).toContain('1 Postgres, faster')
    expect(line).toContain('2 Cached DB')
    expect(line).toContain('…')
  })

  it('composes the question when the reported terminal is wide enough', async () => {
    expect(await lineAt('200')).toContain('2 Cached DB')
  })

  it('suppresses the question on a genuinely narrow terminal', async () => {
    // 46 columns was measured on a real resize. Composing the 80-column fallback there would wrap,
    // and there is no room for sponsor + payout + question, so section 4.7 drops the question.
    const line = await lineAt('46')
    expect(line).not.toContain('Acme DB')
    expect(line).not.toContain('Which tagline')
  })

  it('falls back to the default width for a cols it cannot trust', async () => {
    // Each of these has bitten a naive parser: '' and '0' are falsy-but-present, '-5' is negative,
    // '1e9' defeats parseInt (which yields 1 -> a 14-column budget -> a blank-looking status line),
    // and '99999' would blow past any real terminal.
    for (const bad of ['abc', '', '-5', '0', 'NaN', '1e9', '99999', '  ', '80abc']) {
      expect(await lineAt(bad), `cols=${JSON.stringify(bad)}`).toContain('2 Cached DB')
    }
  })
})
