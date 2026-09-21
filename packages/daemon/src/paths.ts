import { mkdirSync, chmodSync, existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

export function resolveHome(env: Record<string, string | undefined> = process.env): string {
  if (env.TICKOVER_HOME) return env.TICKOVER_HOME
  const base = env.HOME ?? env.USERPROFILE ?? homedir()
  return join(base, '.tickover')
}

export function ensureHome(home: string): void {
  // Pass mode at creation time so the directory is never briefly world/group-readable between
  // mkdir and chmod (mode is applied atomically by the OS, modulo umask, which only narrows it).
  if (!existsSync(home)) mkdirSync(home, { recursive: true, mode: 0o700 })
  if (process.platform !== 'win32') chmodSync(home, 0o700)
}

export function paths(home: string) {
  return {
    config: join(home, 'config.json'),
    daemon: join(home, 'daemon.json'),
    db: join(home, 'state.sqlite'),
    log: join(home, 'daemon.log'),
  }
}
