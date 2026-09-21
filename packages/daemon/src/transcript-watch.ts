import { watch, type FSWatcher } from 'node:fs'
import { basename } from 'node:path'
import type { HookEvent } from './http.js'

// Narrow structural type rather than importing the concrete `Log` class: the only thing this
// fallback needs is somewhere to report a broken watcher, and a plain interface lets a test pass
// a lightweight spy instead of standing up a real Log (which writes to a file).
export interface TranscriptWatcherLog {
  error(msg: string, data?: unknown): void
}

/**
 * Fallback turn-boundary detector for surfaces where Claude Code's hooks don't fire (Spike B
 * found they DO fire inside the VS Code extension panel, so this stays off by default and is
 * only wired in when config explicitly asks for it -- see daemon.ts). Watches `root` recursively
 * for writes to `<project>/<uuid>.jsonl` transcript files and infers a turn's start and end from
 * write activity and silence alone. Never opens or reads any file -- only the filename (a UUID)
 * from the fs.watch event ever reaches this code, which is exactly what onHook's session_id
 * needs and nothing more.
 */
export class TranscriptWatcher {
  private watcher: FSWatcher | null = null
  private timers = new Map<string, NodeJS.Timeout>()
  private active = new Set<string>()
  constructor(private opts: { root: string; onHook: (e: HookEvent) => void; silenceMs?: number; clock?: () => Date; log?: TranscriptWatcherLog }) {}

  start(): void {
    try {
      this.watcher = watch(this.opts.root, { recursive: true }, (_type, filename) => {
        if (!filename) return
        const name = basename(String(filename))
        const m = /^([0-9a-f-]{36})\.jsonl$/i.exec(name)
        if (!m) return
        this.touch(m[1]!)
      })
    } catch (err) {
      // `fs.watch` throws SYNCHRONOUSLY (not via the 'error' event) when `root` doesn't exist yet
      // -- entirely possible for this fallback's default root (~/.claude/projects) on a machine
      // that's never run Claude Code. A daemon opt-in for this fallback must not crash the whole
      // daemon over it (round1 review, finding4); report it and leave the fallback simply inert.
      this.opts.log?.error('transcript watcher failed to start', { message: (err as Error).message })
      return
    }
    // A watch that started fine can still fail later (the root removed mid-run, an OS-level
    // watch-limit) -- that must not crash the daemon either, but round1 review (finding4) is
    // right that silently going dark leaves a developer relying on this fallback with no clue why
    // it stopped. Report it instead of swallowing it.
    this.watcher.on('error', (err) => {
      this.opts.log?.error('transcript watcher error', { message: (err as Error).message })
    })
  }

  private touch(sessionId: string): void {
    if (!this.active.has(sessionId)) {
      this.active.add(sessionId)
      this.opts.onHook({ event: 'UserPromptSubmit', session_id: sessionId, tool: 'claude-code' })
    }
    const existing = this.timers.get(sessionId)
    if (existing) clearTimeout(existing)
    const t = setTimeout(() => {
      this.active.delete(sessionId)
      this.timers.delete(sessionId)
      this.opts.onHook({ event: 'Stop', session_id: sessionId, tool: 'claude-code' })
    }, this.opts.silenceMs ?? 5000)
    // Never keep the process alive on this fallback's account alone.
    t.unref()
    this.timers.set(sessionId, t)
  }

  stop(): void {
    this.watcher?.close()
    this.watcher = null
    for (const t of this.timers.values()) clearTimeout(t)
    this.timers.clear()
    this.active.clear()
  }
}
