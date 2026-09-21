import { appendFileSync, existsSync, statSync, renameSync } from 'node:fs'

export class Log {
  constructor(private path: string, private maxBytes = 1_000_000) {}
  private write(level: string, msg: string, data?: unknown): void {
    try {
      if (existsSync(this.path) && statSync(this.path).size > this.maxBytes) renameSync(this.path, `${this.path}.1`)
      appendFileSync(this.path, `${new Date().toISOString()} ${level} ${msg}${data === undefined ? '' : ' ' + JSON.stringify(data)}\n`)
    } catch { /* logging must never throw */ }
  }
  info(msg: string, data?: unknown): void { this.write('info', msg, data) }
  error(msg: string, data?: unknown): void { this.write('error', msg, data) }
}
