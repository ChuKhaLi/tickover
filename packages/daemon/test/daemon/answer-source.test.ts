import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { startTestDaemon, type TestDaemon } from '../helpers/daemon.js'
import { servedQuestion } from '../helpers/fake-server.js'

async function hook(t: TestDaemon, event: string, session_id: string) {
  await fetch(`${t.base}/v1/hook`, { method: 'POST', headers: t.headers, body: JSON.stringify({ event, session_id, tool: 'claude-code', cwd: 'C:/proj' }) })
}

// R205, over the channel the band uses: POST /v1/answer on the local API, then the body the daemon
// sends to /api/dev/answers. A source the local zod schema refuses 400s here and never reaches the
// queue, which is exactly the failure a five-literal-union daemon would have after the contract
// learned 'claude'.
describe('POST /v1/answer from the band inside Claude Code', () => {
  let t: TestDaemon
  beforeEach(async () => {
    t = await startTestDaemon()
    await hook(t, 'SessionStart', 's1')
    t.clock.advanceMinutes(3)
    await hook(t, 'UserPromptSubmit', 's1')
    t.clock.advanceMs(9_000)
    t.fake.nextQueue.push({ question: servedQuestion({ expires_at: new Date(t.clock.now.getTime() + 13 * 60_000).toISOString() }) })
    await t.daemon.loop.tick()
  })
  afterEach(async () => { await t.stop() })

  it('accepts source claude and sends it to the server as given', async () => {
    const res = await fetch(`${t.base}/v1/answer`, { method: 'POST', headers: t.headers, body: JSON.stringify({ assignment_id: servedQuestion().assignment_id, option_index: 1, source: 'claude' }) })
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ accepted: true })
    expect(t.fake.answers.at(-1)?.body).toMatchObject({ assignment_id: servedQuestion().assignment_id, option_index: 1, source: 'claude' })
  })

  it('still refuses a source nobody disclosed', async () => {
    const res = await fetch(`${t.base}/v1/answer`, { method: 'POST', headers: t.headers, body: JSON.stringify({ assignment_id: servedQuestion().assignment_id, option_index: 1, source: 'band' }) })
    expect(res.status).toBe(400)
    expect(t.fake.answers).toHaveLength(0)
  })
})
