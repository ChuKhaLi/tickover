import { describe, it, expect } from 'vitest'
import { startTestDaemon } from '../helpers/daemon.js'

describe('daemon shutdown', () => {
  it('stop() resolves promptly even with an SSE client still attached', async () => {
    const t = await startTestDaemon()
    const controller = new AbortController()
    const res = await fetch(`${t.base}/v1/events`, { headers: t.headers, signal: controller.signal })
    // Read one frame so the subscription is fully established server-side before we stop.
    await res.body!.getReader().read()

    const start = Date.now()
    await Promise.race([
      t.stop(),
      new Promise((_, reject) => setTimeout(() => reject(new Error('stop() did not resolve within 2000ms')), 2000)),
    ])
    expect(Date.now() - start).toBeLessThan(2000)
    controller.abort()
  })
})
