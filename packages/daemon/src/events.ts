import type { ServerResponse } from 'node:http'

/**
 * How often a comment frame goes out on an otherwise idle stream. A question arrives at most once
 * every RULES.MIN_GAP_MINUTES, so without this a subscriber's socket can sit silent for hours --
 * long enough for a laptop to suspend or a NAT to drop the mapping, leaving a half-open socket the
 * daemon still counts as a live client and still tries to broadcast to. Writing to it is what
 * eventually surfaces the reset, which the 'error' handler below turns into an unsubscribe.
 * 25 seconds is comfortably under the usual 30-60 second idle timeouts.
 */
export const KEEPALIVE_MS = 25_000

export class SseHub {
  private clients = new Set<ServerResponse>()
  private keepalive: ReturnType<typeof setInterval> | null = null

  // Injectable purely so a test can watch the keepalive actually fire without waiting 25 seconds.
  constructor(private keepaliveMs: number = KEEPALIVE_MS) {}

  subscribe(res: ServerResponse): void {
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' })
    this.clients.add(res)
    res.on('close', () => { this.clients.delete(res); this.stopKeepaliveIfIdle() })
    // A socket that dies between 'close' and our next broadcast() write would otherwise surface
    // as an unhandled stream error.
    res.on('error', () => { this.clients.delete(res); this.stopKeepaliveIfIdle() })
    this.startKeepalive()
  }

  broadcast(event: string, data: unknown): void {
    this.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
  }

  /**
   * An SSE comment frame: a line starting with ':' carries no event and no data. Browsers'
   * EventSource ignores it by specification, and both hand-written parsers in this repo (pane.ts
   * and the VS Code daemon-client) require an `event:` and a `data:` line before they act on a
   * frame, so it is inert everywhere -- its only job is to put bytes on the wire.
   */
  ping(): void {
    this.write(': keepalive\n\n')
  }

  private write(frame: string): void {
    for (const c of this.clients) {
      try { c.write(frame) } catch { this.clients.delete(c) }
    }
    this.stopKeepaliveIfIdle()
  }

  private startKeepalive(): void {
    if (this.keepalive || this.keepaliveMs <= 0) return
    this.keepalive = setInterval(() => this.ping(), this.keepaliveMs)
    // Never a reason for a keepalive to hold the process open on its own.
    this.keepalive.unref?.()
  }

  private stopKeepaliveIfIdle(): void {
    if (this.clients.size > 0 || !this.keepalive) return
    clearInterval(this.keepalive)
    this.keepalive = null
  }

  // Ends every open SSE response so a listening http.Server can actually finish closing —
  // an SSE response never ends on its own, and server.close() waits for in-flight responses.
  closeAll(): void {
    for (const c of this.clients) {
      try { c.end() } catch { /* socket already gone */ }
    }
    this.clients.clear()
    this.stopKeepaliveIfIdle()
  }

  size(): number { return this.clients.size }
}
