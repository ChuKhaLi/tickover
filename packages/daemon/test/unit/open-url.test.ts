import { describe, it, expect } from 'vitest'
import { openInBrowser } from '../../src/open-url.js'

function recorder(platform: NodeJS.Platform) {
  const calls: Array<{ cmd: string; args: string[] }> = []
  const spawn = (cmd: string, args: string[]) => {
    calls.push({ cmd, args })
    return { on: () => undefined, unref: () => undefined }
  }
  return { calls, deps: { spawn, platform } }
}

describe('openInBrowser', () => {
  // The two URL shapes the CLI really opens: `tickover page` and `tickover web`.
  it('opens the loopback page URL and the server web-session URL', () => {
    const { calls, deps } = recorder('win32')
    expect(openInBrowser('http://127.0.0.1:47321/?t=abc_DEF-123', deps)).toBe(true)
    expect(openInBrowser('https://tickover.dev/api/dev/web/verify?token=abc_DEF-123', deps)).toBe(true)
    expect(calls.map((c) => c.args.at(-1))).toEqual([
      'http://127.0.0.1:47321/?t=abc_DEF-123',
      'https://tickover.dev/api/dev/web/verify?token=abc_DEF-123',
    ])
  })

  // R901: on Windows the URL goes to `cmd /c start`, where `&` separates commands. Captured in the
  // 2026-10-08 audit: `https://tickover.dev/x?c=1&whoami` passed zod's .url() and ran whoami.
  it('refuses a URL carrying cmd.exe metacharacters, so it never reaches the opener', () => {
    const { calls, deps } = recorder('win32')
    for (const url of [
      'https://tickover.dev/x?c=1&whoami',
      'https://tickover.dev/x?c=1|calc',
      'https://tickover.dev/x?c=%PATH%',
      'https://tickover.dev/x?c=^&calc',
      'https://tickover.dev/x?c="a"',
    ]) expect(openInBrowser(url, deps)).toBe(false)
    expect(calls).toEqual([])
  })

  it('refuses plain http to anything but the loopback address', () => {
    const { calls, deps } = recorder('linux')
    expect(openInBrowser('http://evil.example/?t=abc', deps)).toBe(false)
    expect(openInBrowser('file:///C:/Windows/System32/calc.exe', deps)).toBe(false)
    expect(calls).toEqual([])
  })

  // Whole-branch review M2: a refusal printed nothing, which reads the same as "no opener
  // installed". The local stack's http://localhost URL hit exactly that.
  it('says on stderr why it did not open a refused URL', () => {
    const warned: string[] = []
    const { deps } = recorder('win32')
    expect(openInBrowser('http://localhost:8787/api/dev/web/verify?token=abc', { ...deps, warn: (m) => warned.push(m) })).toBe(false)
    expect(warned).toHaveLength(1)
    expect(warned[0]).toMatch(/not opened/i)
  })
})

