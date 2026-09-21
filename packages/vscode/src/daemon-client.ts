import { existsSync, readFileSync } from 'node:fs'
import http from 'node:http'
import { join } from 'node:path'

export interface QuestionView { question: ServedQuestionLike | null; shown_at: string | null; balance_pending_cents: number; balance_available_cents: number; today_paid_answers: number; logged_in: boolean }
export interface ServedQuestionLike { assignment_id: string; kind: 'choice' | 'profile'; text: string; options: string[]; context: string | null; sponsor: string; price_cents: number; served_at: string; expires_at: string }
export interface AnswerOutcome { accepted: boolean; reason: string; earned_cents: number }
interface DaemonInfo { port: number; token: string }

export class DaemonClient {
  private info: DaemonInfo | null = null
  constructor(private home: string, private fetchFn: typeof fetch = fetch) {}

  get pageUrl(): string | null { return this.info ? `http://127.0.0.1:${this.info.port}/?t=${encodeURIComponent(this.info.token)}` : null }

  private read(): DaemonInfo | null {
    const p = join(this.home, 'daemon.json')
    if (!existsSync(p)) return null
    try { const j = JSON.parse(readFileSync(p, 'utf8')); return { port: j.port, token: j.token } } catch { return null }
  }

  private async call<T>(path: string, init?: { method?: string; body?: unknown }): Promise<T | null> {
    if (!this.info) return null
    try {
      const res = await this.fetchFn(`http://127.0.0.1:${this.info.port}${path}`, {
        method: init?.method ?? 'GET',
        headers: { 'x-tickover-token': this.info.token, 'content-type': 'application/json' },
        body: init?.body === undefined ? undefined : JSON.stringify(init.body),
        signal: AbortSignal.timeout(3000),
      })
      if (res.status === 204) return {} as T
      if (!res.ok) return null
      return (await res.json()) as T
    } catch { return null }
  }

  async connect(): Promise<boolean> {
    this.info = this.read()
    if (!this.info) return false
    const ok = await this.call<{ ok: boolean }>('/v1/health')
    if (!ok) this.info = null
    return ok !== null
  }

  question(): Promise<QuestionView | null> { return this.call<QuestionView>('/v1/question') }

  async answer(assignmentId: string, optionIndex: number): Promise<AnswerOutcome> {
    return (await this.call<AnswerOutcome>('/v1/answer', { method: 'POST', body: { assignment_id: assignmentId, option_index: optionIndex, source: 'vscode' } })) ?? { accepted: false, reason: 'disconnected', earned_cents: 0 }
  }

  async skip(assignmentId: string): Promise<void> { await this.call('/v1/skip', { method: 'POST', body: { assignment_id: assignmentId } }) }

  subscribe(onView: (v: QuestionView) => void, onAnswered: (o: AnswerOutcome) => void, onDisconnect?: () => void): () => void {
    if (!this.info) return () => {}
    // The caller needs to know when this stream dies -- a crashed or restarted daemon ends (or
    // errors) the connection with no further frames, and without this, the caller has no signal
    // to fall back to a disconnected state and let its own retry loop take back over. Guarded so
    // a deliberate unsubscribe() (which also destroys the socket, triggering the same events)
    // never gets reported as a lost connection.
    let torndown = false
    const notifyDisconnect = () => {
      if (torndown) return
      torndown = true
      onDisconnect?.()
    }
    const req = http.request({ host: '127.0.0.1', port: this.info.port, path: '/v1/events', headers: { 'x-tickover-token': this.info.token } }, (res) => {
      let buf = ''
      res.setEncoding('utf8')
      res.on('data', (chunk: string) => {
        buf += chunk
        let idx
        while ((idx = buf.indexOf('\n\n')) >= 0) {
          const frame = buf.slice(0, idx); buf = buf.slice(idx + 2)
          const ev = /^event: (.+)$/m.exec(frame)?.[1]
          const data = /^data: (.+)$/m.exec(frame)?.[1]
          if (!ev || !data) continue
          try {
            if (ev === 'question' || ev === 'status') onView(JSON.parse(data))
            if (ev === 'answered') onAnswered(JSON.parse(data))
          } catch { /* ignore malformed frames */ }
        }
      })
      res.on('end', notifyDisconnect)
      res.on('close', notifyDisconnect)
      res.on('error', notifyDisconnect)
    })
    req.on('error', notifyDisconnect)
    req.end()
    return () => { torndown = true; req.destroy() }
  }
}
