import { DatabaseSync } from 'node:sqlite'
import type { AnswerSource } from '@tickover/contract'

export interface QueuedAnswer {
  id: string
  assignmentId: string
  optionIndex: number
  latencyMs: number
  source: AnswerSource
  idempotencyKey: string
  attempts: number
  nextAt: string
}
export interface Turn { id: number; sessionId: string; startedAt: string; endedAt: string }

export class State {
  private db: DatabaseSync
  constructor(dbPath: string) {
    this.db = new DatabaseSync(dbPath)
    // WAL lets readers and a writer share the file concurrently, and busy_timeout makes a
    // conflicting writer wait instead of throwing SQLITE_BUSY — the CLI (Task 9) will run
    // one-off commands against this file while the daemon holds it open.
    this.db.exec('pragma journal_mode = WAL')
    this.db.exec('pragma busy_timeout = 5000')
    this.db.exec(`
      create table if not exists kv (key text primary key, value text not null);
      create table if not exists answer_queue (
        id text primary key, assignment_id text not null, option_index integer not null, latency_ms integer not null,
        source text not null, idempotency_key text not null, attempts integer not null default 0, next_at text not null);
      create table if not exists turns (
        id integer primary key autoincrement, session_id text not null, started_at text not null, ended_at text not null, sent integer not null default 0,
        unique (session_id, started_at));
    `)
  }
  get(key: string): string | null {
    const row = this.db.prepare('select value from kv where key = ?').get(key) as { value: string } | undefined
    return row?.value ?? null
  }
  set(key: string, value: string): void {
    this.db.prepare('insert into kv (key, value) values (?, ?) on conflict(key) do update set value = excluded.value').run(key, value)
  }
  enqueueAnswer(a: QueuedAnswer): void {
    this.db.prepare('insert or ignore into answer_queue (id, assignment_id, option_index, latency_ms, source, idempotency_key, attempts, next_at) values (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(a.id, a.assignmentId, a.optionIndex, a.latencyMs, a.source, a.idempotencyKey, a.attempts, a.nextAt)
  }
  dueAnswers(now: Date): QueuedAnswer[] {
    const rows = this.db.prepare(
      'select id, assignment_id, option_index, latency_ms, source, idempotency_key, attempts, next_at from answer_queue where next_at <= ? order by next_at',
    ).all(now.toISOString()) as Array<Record<string, unknown>>
    return rows.map((r) => ({
      id: r.id as string, assignmentId: r.assignment_id as string, optionIndex: r.option_index as number, latencyMs: r.latency_ms as number,
      source: r.source as QueuedAnswer['source'], idempotencyKey: r.idempotency_key as string, attempts: r.attempts as number, nextAt: r.next_at as string,
    }))
  }
  markAnswerAttempt(id: string, nextAt: Date): void {
    this.db.prepare('update answer_queue set attempts = attempts + 1, next_at = ? where id = ?').run(nextAt.toISOString(), id)
  }
  removeAnswer(id: string): void {
    this.db.prepare('delete from answer_queue where id = ?').run(id)
  }
  addTurn(t: { sessionId: string; startedAt: Date; endedAt: Date }): void {
    this.db.prepare('insert or ignore into turns (session_id, started_at, ended_at) values (?, ?, ?)').run(t.sessionId, t.startedAt.toISOString(), t.endedAt.toISOString())
  }
  unsentTurns(): Turn[] {
    const rows = this.db.prepare('select id, session_id, started_at, ended_at from turns where sent = 0 order by id limit 500').all() as Array<Record<string, unknown>>
    return rows.map((r) => ({ id: r.id as number, sessionId: r.session_id as string, startedAt: r.started_at as string, endedAt: r.ended_at as string }))
  }
  markTurnsSent(ids: number[]): void {
    if (ids.length === 0) return
    this.db.prepare(`update turns set sent = 1 where id in (${ids.map(() => '?').join(',')})`).run(...ids)
    // ended_at is stored as an ISO string ("...T...Z"); SQLite's datetime('now', ...) produces a
    // space-separated string ("YYYY-MM-DD HH:MM:SS"). 'T' (0x54) sorts above ' ' (0x20), so
    // comparing the two formats directly makes same-day rows never match. Compute the cutoff in
    // the same ISO format so the comparison is apples-to-apples.
    const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()
    this.db.prepare('delete from turns where sent = 1 and ended_at < ?').run(cutoff)
  }
  close(): void { this.db.close() }
}
