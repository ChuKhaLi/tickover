import { describe, it, expect } from 'vitest'
import { sanitizeText, truncateChars, truncateToWidth } from '../src/index.js'

describe('sanitizeText', () => {
  it('strips CSI color sequences', () => {
    expect(sanitizeText('\u001b[31mred\u001b[0m text', 100)).toBe('red text')
  })
  it('strips 8-bit CSI sequences, including ones with no parameters', () => {
    expect(sanitizeText('x\u009bmy', 100)).toBe('xy')
  })
  it('strips OSC title sequences terminated by BEL or ST', () => {
    expect(sanitizeText('a\u001b]0;evil title\u0007b', 100)).toBe('ab')
    expect(sanitizeText('a\u001b]8;;http://x\u001b\\b', 100)).toBe('ab')
  })
  it('strips C0 and C1 control characters and zero-width characters', () => {
    expect(sanitizeText('a\u0000b\u0085c\u200bd', 100)).toBe('abcd')
  })
  it('collapses newlines, tabs and runs of spaces', () => {
    expect(sanitizeText('  one\n\ttwo   three \r\n', 100)).toBe('one two three')
  })
  it('truncates by characters with an ellipsis', () => {
    expect(sanitizeText('abcdefghij', 5)).toBe('abcd…')
    expect(truncateChars('héllo', 5)).toBe('héllo')
  })
})

describe('truncateToWidth', () => {
  it('keeps short strings', () => {
    expect(truncateToWidth('hello', 10)).toBe('hello')
  })
  it('counts wide characters as two columns', () => {
    expect(truncateToWidth('日本語テキスト', 7)).toBe('日本語…')
  })
})
