import { describe, it, expect } from 'vitest'
import * as contract from '../src/index.js'

/**
 * R905. This package is mirrored publicly and installed on developers' machines, so an attention
 * check with its correct option in it is a check a script can look up. The pool lives in
 * `packages/server`. This holds the line by shape, not by name: no export carries an object with a
 * correct option, at any depth, whatever it is called -- including inside a plain object such as a
 * `SystemStudyInput` (whole-branch review M1) and inside what a zero-argument function returns.
 */
describe('the public contract', () => {
  it('exports nothing that carries a correct option', () => {
    const carriers = Object.entries(contract).filter(([, value]) => carriesAnswer(value, 0, new Set())).map(([name]) => name)
    expect(carriers).toEqual([])
  })

  // The guard has to be able to fail: each of these shapes leaked past an earlier version.
  it('recognises an answer in every shape a leak has taken', () => {
    const q = { text: 'x', options: ['a', 'b'], correctOption: 1 }
    for (const leak of [[q], { questions: [q] }, { a: { ...q, correctOption: undefined, correct_option: 0 } }, () => [q], () => ({ questions: [q] })]) {
      expect(carriesAnswer(leak, 0, new Set())).toBe(true)
    }
    expect(carriesAnswer({ questions: [{ text: 'x', options: ['a'] }] }, 0, new Set())).toBe(false)
  })
})

function carriesAnswer(value: unknown, depth: number, seen: Set<unknown>): boolean {
  if (depth > 6 || value === null || seen.has(value)) return false
  if (typeof value === 'function') {
    if (value.length !== 0 || /^class\b/.test(Function.prototype.toString.call(value))) return false
    let out: unknown
    try { out = (value as () => unknown)() } catch { return false }
    return carriesAnswer(out, depth + 1, seen)
  }
  if (typeof value !== 'object') return false
  seen.add(value)
  if (!Array.isArray(value) && (('correctOption' in value && (value as { correctOption?: unknown }).correctOption !== undefined) || 'correct_option' in value)) return true
  return Object.values(value as object).some((v) => carriesAnswer(v, depth + 1, seen))
}
