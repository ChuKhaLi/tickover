import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { startTestDaemon, type TestDaemon } from '../helpers/daemon.js'
import { servedQuestion } from '../helpers/fake-server.js'
import { requestWithHost } from '../helpers/host-header.js'

const ID = servedQuestion().assignment_id
const OTHER = '11111111-1111-4111-8111-111111111111'

async function hook(t: TestDaemon, event: string, session_id: string) {
  await fetch(`${t.base}/v1/hook`, { method: 'POST', headers: t.headers, body: JSON.stringify({ event, session_id, tool: 'claude-code', cwd: 'C:/proj' }) })
}
const band = (t: TestDaemon, session: string, drawn?: string) =>
  fetch(`${t.base}/v1/band?session_id=${session}${drawn ? `&drawn=${drawn}` : ''}`, { headers: t.headers })
// cols=120, as the real status line script sends it, so the question composes whole.
const status = (t: TestDaemon, session: string) =>
  fetch(`${t.base}/v1/status?session_id=${session}&cols=120`, { headers: t.headers }).then((r) => r.json()).then((j) => j.line as string)

describe('GET /v1/band', () => {
  let t: TestDaemon
  beforeEach(async () => {
    t = await startTestDaemon()
    await hook(t, 'SessionStart', 'c1')
    t.clock.advanceMinutes(3)
    await hook(t, 'UserPromptSubmit', 'c1')
    t.clock.advanceMs(9_000)
    t.fake.nextQueue.push({ question: servedQuestion({ expires_at: new Date(t.clock.now.getTime() + 13 * 60_000).toISOString() }) })
    await t.daemon.loop.tick()
  })
  afterEach(async () => { await t.stop() })

  it('refuses a request without the token', async () => {
    expect((await fetch(`${t.base}/v1/band?session_id=c1`)).status).toBe(401)
  })

  // The design's test list promises both refusals for this route (spec 2026-09-15 line 246). The
  // Host check itself is global and lives ahead of auth and routing (src/http.ts:161-162), so what
  // this pins is that /v1/band is behind it like every other /v1 route -- a route added in front of
  // that gate, or moved out from behind it, is what would turn this red. Sent *with* a token that
  // the case above proves is otherwise accepted, so the 421 cannot be a 401 wearing another number.
  it('refuses a foreign Host with 421, before the route is reached', async () => {
    expect((await requestWithHost(`${t.base}/v1/band?session_id=c1`, 'evil.example:80', t.headers)).status).toBe(421)
  })

  it('serves the composed question', async () => {
    const res = await band(t, 'c1')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ state: 'question', assignment_id: ID, header: 'tickover · Acme DB · $0.50', text: 'Which tagline?', options: ['Postgres, faster', 'Cached DB'], min_columns: 28 })
  })

  // The guard on the yield tests below: without a claim the status line shows the question, so a
  // fixture that quietly served nothing cannot make "the question is omitted" pass.
  it('leaves the status line alone when no band has drawn the question', async () => {
    await band(t, 'c1')
    expect(await status(t, 'c1')).toContain('Which tagline?')
  })

  it('yields the question on the status line to the band that drew it, for that session only', async () => {
    await hook(t, 'SessionStart', 'c2')
    await band(t, 'c1', ID)
    const line = await status(t, 'c1')
    expect(line).not.toContain('Which tagline?')
    expect(line).toContain('tickover · today')
    expect(await status(t, 'c2')).toContain('Which tagline?')
  })

  it('takes the question back once the band stops claiming it', async () => {
    await band(t, 'c1', ID)
    t.clock.advanceMs(6_001)
    expect(await status(t, 'c1')).toContain('Which tagline?')
  })

  it('ignores a claim on an assignment that is not the current one', async () => {
    await band(t, 'c1', OTHER)
    expect(await status(t, 'c1')).toContain('Which tagline?')
  })

  // The claims map holds one slot per session, so a poll carrying a stale assignment would evict a
  // live hold if the handler did not check it against the current question first. Without that
  // guard the status line takes the question back while the band is still drawing it.
  it('keeps a live claim when a later poll names an assignment that is no longer current', async () => {
    await band(t, 'c1', ID)
    await band(t, 'c1', OTHER)
    expect(await status(t, 'c1')).not.toContain('Which tagline?')
  })

  it('never opens a session, and ignores a claim from one it does not know', async () => {
    const before = t.daemon.sessions.count()
    await band(t, 'ghost', ID)
    expect(t.daemon.sessions.count()).toBe(before)
    expect(t.daemon.sessions.bandHolds('ghost', ID)).toBe(false)
  })

  it('serves the answered line after the band posts an answer', async () => {
    const posted = await fetch(`${t.base}/v1/answer`, { method: 'POST', headers: t.headers, body: JSON.stringify({ assignment_id: ID, option_index: 0, source: 'claude' }) })
    expect(posted.status).toBe(200)
    expect(await (await band(t, 'c1')).json()).toMatchObject({ state: 'answered', text: expect.stringContaining('✓ +$0.50') })
  })
})
