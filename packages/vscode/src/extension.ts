import * as vscode from 'vscode'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { answerNotice, isEarning } from '@tickover/contract'
import { DaemonClient, type QuestionView } from './daemon-client.js'
import { statusBarText, quickPickItems, quickPickTitle, quickPickPlaceholder } from './format.js'

export const ANSWERED_TTL_MS = 10_000
const RETRY_MS = Number(process.env.TICKOVER_RETRY_MS ?? 10_000)

export function activate(context: vscode.ExtensionContext): { client: DaemonClient; item: vscode.StatusBarItem } {
  const home = process.env.TICKOVER_HOME ?? join(homedir(), '.tickover')
  const client = new DaemonClient(home)
  const item = vscode.window.createStatusBarItem('tickover', vscode.StatusBarAlignment.Left, 100)
  item.name = 'Tickover'
  context.subscriptions.push(item)

  let connected = false
  let view: QuestionView | null = null
  let answered: { earnedCents: number } | null = null
  let unsubscribe: () => void = () => {}
  let answeredTimer: NodeJS.Timeout | undefined
  let connecting = false

  const render = () => {
    const s = statusBarText(view, connected, answered)
    item.text = s.text; item.tooltip = s.tooltip; item.command = s.command
    item.show()
  }

  // Shared by both the health-check failure branch below and subscribe()'s onDisconnect: once
  // connected, the only way back to the disconnected state must be through here, so the retry
  // timer (gated on `!connected`) picks the daemon back up on its own -- previously nothing
  // called this when the SSE stream itself died, so a daemon crash or restart froze the status
  // bar on stale data until the window was reloaded.
  const handleDisconnected = () => {
    if (!connected) return
    connected = false
    view = null
    unsubscribe()
    unsubscribe = () => {}
    render()
  }

  const connect = async () => {
    // A slow or hung daemon must not let a second retry tick pile another connect() attempt on
    // top of one still in flight -- that would fan out overlapping requests every retry interval.
    if (connecting) return
    connecting = true
    try {
      const ok = await client.connect()
      if (ok && !connected) {
        connected = true
        view = await client.question()
        unsubscribe = client.subscribe(
          (v) => { view = v; if (v.question) answered = null; render() },
          (o) => {
            // Shared with the status line, the pane and the localhost page (whole-branch review
            // I6). `accepted` alone is the wrong test: the server returns `duplicate` as
            // accepted:true with zero cents, which showed here as a $(check) +$0.00 -- a payment
            // of nothing -- and the warning printed a raw protocol token instead of a sentence.
            answered = isEarning(o) ? { earnedCents: o.earned_cents } : null
            if (answeredTimer) clearTimeout(answeredTimer)
            answeredTimer = setTimeout(() => { answered = null; render() }, ANSWERED_TTL_MS)
            const notice = answerNotice(o)
            if (notice) vscode.window.showWarningMessage(`Tickover: ${notice}`)
            render()
          },
          handleDisconnected,
        )
      } else if (!ok && connected) {
        handleDisconnected()
      }
      render()
    } finally {
      connecting = false
    }
  }

  const timer = setInterval(() => { if (!connected) void connect() }, RETRY_MS)
  context.subscriptions.push({ dispose: () => { clearInterval(timer); unsubscribe(); if (answeredTimer) clearTimeout(answeredTimer) } })

  context.subscriptions.push(vscode.commands.registerCommand('tickover.answer', async () => {
    const q = view?.question
    if (!q) { vscode.window.showInformationMessage('Tickover: no question right now.'); return }
    const pick = await vscode.window.showQuickPick(quickPickItems(q), { title: quickPickTitle(q), placeHolder: quickPickPlaceholder(q) })
    if (!pick) return
    if (pick.index === -1) await client.skip(q.assignment_id)
    else await client.answer(q.assignment_id, pick.index)
  }))
  context.subscriptions.push(vscode.commands.registerCommand('tickover.skip', async () => {
    const q = view?.question
    if (q) await client.skip(q.assignment_id)
  }))
  context.subscriptions.push(vscode.commands.registerCommand('tickover.openPage', async () => {
    const url = client.pageUrl
    if (url) await vscode.env.openExternal(vscode.Uri.parse(url))
    else vscode.window.showInformationMessage('Tickover: daemon is not running.')
  }))

  void connect()
  return { client, item }
}

export function deactivate(): void {}
