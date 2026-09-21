import { answerNotice, isEarning } from '@tickover/contract'
import { ensureDaemon } from './launch.js'
import { renderPane, handleKey, type PaneState } from './pane-view.js'
import { answeredAfterFrame } from './answered.js'
import type { QuestionView } from './http.js'

export async function runPane(home: string, io: { stdin: NodeJS.ReadStream; stdout: NodeJS.WriteStream; fetchFn?: typeof fetch; cliPath?: string }): Promise<void> {
  const f = io.fetchFn ?? fetch
  const info = await ensureDaemon(home, { fetchFn: f, cliPath: io.cliPath })
  const base = `http://127.0.0.1:${info.port}`
  const headers = { 'x-tickover-token': info.token, 'content-type': 'application/json' }
  const state: PaneState = {
    view: (await (await f(`${base}/v1/question`, { headers })).json()) as QuestionView,
    answered: null, message: null, width: io.stdout.columns ?? 80, height: io.stdout.rows ?? 24,
  }
  const draw = () => { io.stdout.write('\x1B[2J\x1B[H' + renderPane(state) + '\n') }
  draw()

  const controller = new AbortController()

  // The one place the terminal is ever put back -- every exit path (normal quit, Ctrl-C, a
  // thrown error from a keypress, the SSE connection ending, or the process exiting some other
  // way entirely) calls this instead of touching raw mode itself, and it's safe to call more than
  // once (round1 finding C2: a raw-mode terminal left broken behind a crashed pane is the kind of
  // bug developers do not forgive).
  let restored = false
  function restore(): void {
    if (restored) return
    restored = true
    controller.abort()
    io.stdin.setRawMode?.(false)
    io.stdin.pause()
    process.off('exit', restore)
  }
  process.on('exit', restore)

  let resolvePane: (() => void) | undefined
  const panePromise = new Promise<void>((resolve) => { resolvePane = resolve })

  // If the SSE connection ever ends -- the daemon crashed, the socket dropped, anything other
  // than our own deliberate `controller.abort()` on quit -- the pane is no longer receiving
  // updates and has nothing useful left to do; restore the terminal and exit with a message
  // rather than sitting there silently stale. `.then(onEnded, onEnded)` covers both a clean
  // stream end (no error) and the stream throwing (a fetch/network error).
  const onSseEnded = (err?: unknown): void => {
    if (controller.signal.aborted) return // quit already restored and is already exiting
    restore()
    const detail = err instanceof Error ? ` (${err.message})` : ''
    io.stdout.write(`tickover: lost connection to the daemon${detail}. Run 'tickover pane' again.\n`)
    resolvePane?.()
  }
  ;(async () => {
    const res = await f(`${base}/v1/events`, { headers, signal: controller.signal })
    const reader = res.body!.getReader()
    const decoder = new TextDecoder()
    let buf = ''
    for (;;) {
      const { value, done } = await reader.read()
      if (done) break
      buf += decoder.decode(value, { stream: true })
      let idx
      while ((idx = buf.indexOf('\n\n')) >= 0) {
        const frame = buf.slice(0, idx); buf = buf.slice(idx + 2)
        const ev = /^event: (.+)$/m.exec(frame)?.[1]
        const data = /^data: (.+)$/m.exec(frame)?.[1]
        if (!ev || !data) continue
        const payload = JSON.parse(data)
        // answeredAfterFrame is the shared rule the localhost page also runs (I5): a `question`
        // frame always retires the confirmation -- including the null one the daemon sends when
        // the 10-second answered TTL expires, which is the only signal either surface ever gets
        // -- while a question-less `status` frame is hook noise and must leave it alone.
        if (ev === 'question' || ev === 'status') { state.view = payload; state.answered = answeredAfterFrame(state.answered, ev, payload); draw() }
        // isEarning/answerNotice rather than the bare `accepted` flag (I6): `duplicate` comes back
        // accepted:true with zero cents, which rendered as `✓ +$0.00` -- a payment of nothing --
        // and every other refusal printed a raw protocol token at the developer.
        if (ev === 'answered') { state.answered = isEarning(payload) ? { earnedCents: payload.earned_cents } : null; state.message = answerNotice(payload); draw() }
      }
    }
  })().then(() => onSseEnded(), (err: unknown) => onSseEnded(err))

  io.stdin.setRawMode?.(true)
  io.stdin.resume()
  io.stdin.setEncoding('utf8')
  io.stdout.on('resize', () => { state.width = io.stdout.columns ?? 80; state.height = io.stdout.rows ?? 24; draw() })
  io.stdin.on('data', (key: string) => {
    void (async () => {
      try {
        const a = handleKey(key, state)
        if (a.type === 'quit') { restore(); resolvePane?.(); return }
        if (a.type === 'answer' && state.view.question) {
          const q = state.view.question
          await f(`${base}/v1/answer`, { method: 'POST', headers, body: JSON.stringify({ assignment_id: q.assignment_id, option_index: a.optionIndex, source: 'pane' }) })
        }
        if (a.type === 'skip' && state.view.question) {
          const q = state.view.question
          await f(`${base}/v1/skip`, { method: 'POST', headers, body: JSON.stringify({ assignment_id: q.assignment_id }) })
        }
      } catch (err) {
        // A request to the daemon failed outright (it's gone, or the connection dropped) -- the
        // exact scenario this pane must survive. There's nothing useful left to do against a
        // daemon that isn't there, so restore the terminal and exit rather than keep accepting
        // keys that will only fail the same way.
        restore()
        const detail = err instanceof Error ? ` (${err.message})` : ''
        io.stdout.write(`tickover: lost connection to the daemon${detail}. Run 'tickover pane' again.\n`)
        resolvePane?.()
      }
    })()
  })

  await panePromise
}
