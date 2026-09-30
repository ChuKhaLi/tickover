// Tickover hook: forwards the hook event to the local daemon. Never prints to stdout, always
// exits 0 — this runs as SessionStart/UserPromptSubmit/Stop/SessionEnd inside someone else's
// Claude Code session, and UserPromptSubmit stdout is injected straight into their conversation.
import { readFileSync, existsSync, writeFileSync, renameSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { spawn } from 'node:child_process'

// Backstop for a stuck fetch and for stdin that never closes. Reading stdin asynchronously below
// (rather than a blocking readFileSync) is what lets this actually fire in that second case --
// a synchronous read would freeze the event loop before this timer ever got a turn to run.
// unref'd only means this timer alone can't hold the process open past a fast, successful run;
// once armed it still fires and calls process.exit(0) on schedule regardless of ref state.
const hardStop = setTimeout(() => process.exit(0), 800)
hardStop.unref?.()

const home = process.env.TICKOVER_HOME ?? join(process.env.HOME ?? process.env.USERPROFILE ?? homedir(), '.tickover')
const readJson = (p) => { try { return existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : null } catch { return null } }

function readStdin() {
  return new Promise((resolve) => {
    let data = ''
    process.stdin.setEncoding('utf8')
    process.stdin.on('data', (c) => { data += c })
    process.stdin.on('end', () => resolve(data))
    process.stdin.on('error', () => resolve(data))
  })
}

async function post(payload) {
  const info = readJson(join(home, 'daemon.json'))
  if (!info || !info.port || !info.token) return false
  try {
    const res = await fetch(`http://127.0.0.1:${info.port}/v1/hook`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-tickover-token': info.token },
      body: JSON.stringify(payload), signal: AbortSignal.timeout(600),
    })
    return res.ok
  } catch { return false }
}

// `tickover statusline install` points Claude Code at a copy of the status line script in the
// Tickover home, since this plugin's directory is versioned and Claude Code deletes it 14 days
// after an update. This keeps that copy in step with the plugin that is loaded now. Only an
// existing copy is refreshed -- creating one is setup's job, after consent -- and the write is a
// rename, so a status line starting at the same moment reads the old file or the new, never half.
function refreshStatusLineCopy() {
  try {
    const copy = join(home, 'statusline.mjs')
    if (!existsSync(copy)) return
    const next = readFileSync(fileURLToPath(new URL('../statusline/statusline.mjs', import.meta.url)), 'utf8')
    if (readFileSync(copy, 'utf8') === next) return
    const tmp = `${copy}.tmp-${process.pid}`
    writeFileSync(tmp, next)
    renameSync(tmp, copy)
  } catch { /* the old copy keeps working; never disturb Claude over this */ }
}

function launch() {
  const config = readJson(join(home, 'config.json'))
  if (!config || typeof config.daemonBin !== 'string') return
  try {
    const child = spawn(process.execPath, ['--no-warnings=ExperimentalWarning', config.daemonBin, 'daemon'], {
      detached: true, stdio: 'ignore', windowsHide: true, env: { ...process.env, TICKOVER_HOME: home },
    })
    child.unref()
  } catch { /* never block Claude */ }
}

try {
  let input = {}
  try { input = JSON.parse((await readStdin()) || '{}') } catch { input = {} }
  const event = typeof input.hook_event_name === 'string' ? input.hook_event_name : ''
  if (event === 'SessionStart') refreshStatusLineCopy()
  // Only event/session_id/cwd/tool ever leave this process — never prompt, transcript_path, or
  // anything else the hook payload might carry.
  const payload = { event, session_id: String(input.session_id ?? ''), cwd: typeof input.cwd === 'string' ? input.cwd : undefined, tool: 'claude-code' }
  const ok = event ? await post(payload) : false
  if (!ok && (event === 'SessionStart' || event === 'UserPromptSubmit')) launch()
} catch { /* never block or fail Claude's turn on our account */ }
process.exit(0)
