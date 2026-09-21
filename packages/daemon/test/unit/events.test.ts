import { describe, it, expect } from 'vitest'
import { EventEmitter } from 'node:events'
import type { ServerResponse } from 'node:http'
import { SseHub, KEEPALIVE_MS } from '../../src/events.js'

class FakeRes extends EventEmitter {
  head: [number, Record<string, string>] | null = null
  writes: string[] = []
  ended = false
  failWrites = false
  writeHead(status: number, headers: Record<string, string>): this { this.head = [status, headers]; return this }
  write(s: string): boolean { if (this.failWrites) throw new Error('EPIPE'); this.writes.push(s); return true }
  end(): this { this.ended = true; return this }
}

const asRes = (r: FakeRes) => r as unknown as ServerResponse
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

describe('SseHub', () => {
  it('sends the event-stream headers and broadcasts framed events', () => {
    const hub = new SseHub(0)
    const res = new FakeRes()
    hub.subscribe(asRes(res))
    expect(res.head?.[0]).toBe(200)
    expect(res.head?.[1]['content-type']).toBe('text/event-stream')
    hub.broadcast('question', { question: null })
    expect(res.writes).toEqual(['event: question\ndata: {"question":null}\n\n'])
  })

  // Whole-branch review, Minor: a question arrives at most once every five minutes, so an idle
  // stream could sit silent for hours -- long enough for a suspended laptop or a NAT idle timeout
  // to leave a half-open socket the daemon still counts as a live client and still broadcasts to.
  // Nothing ever wrote to it, so nothing ever discovered it was gone.
  it('writes a periodic comment frame while a client is attached', async () => {
    const hub = new SseHub(20)
    const res = new FakeRes()
    hub.subscribe(asRes(res))
    await wait(90)
    expect(res.writes.length).toBeGreaterThanOrEqual(2)
    for (const w of res.writes) expect(w).toBe(': keepalive\n\n')
  })

  // The frame must be inert for every consumer: a browser EventSource ignores comments by spec,
  // and both hand-written parsers in this repo require an `event:` and a `data:` line, so this
  // pins the shape those parsers skip rather than merely that something was written.
  it('sends the keepalive as a comment carrying neither an event nor a data line', () => {
    const hub = new SseHub(0)
    const res = new FakeRes()
    hub.subscribe(asRes(res))
    hub.ping()
    const frame = res.writes[0]!
    expect(frame.startsWith(':')).toBe(true)
    expect(/^event: /m.test(frame)).toBe(false)
    expect(/^data: /m.test(frame)).toBe(false)
  })

  it('stops the keepalive once the last client goes away, and restarts it for a new one', async () => {
    const hub = new SseHub(20)
    const res = new FakeRes()
    hub.subscribe(asRes(res))
    await wait(50)
    res.emit('close')
    expect(hub.size()).toBe(0)
    const quietAt = res.writes.length
    await wait(60)
    expect(res.writes.length).toBe(quietAt)

    const second = new FakeRes()
    hub.subscribe(asRes(second))
    await wait(60)
    expect(second.writes.length).toBeGreaterThan(0)
    hub.closeAll()
  })

  it('drops a client whose socket throws on write rather than failing the broadcast', () => {
    const hub = new SseHub(0)
    const good = new FakeRes()
    const bad = new FakeRes()
    bad.failWrites = true
    hub.subscribe(asRes(good))
    hub.subscribe(asRes(bad))
    hub.broadcast('status', { x: 1 })
    expect(hub.size()).toBe(1)
    expect(good.writes).toHaveLength(1)
  })

  it('uses a default well under the usual 30-60 second idle timeout', () => {
    expect(KEEPALIVE_MS).toBeGreaterThan(0)
    expect(KEEPALIVE_MS).toBeLessThan(30_000)
  })
})
