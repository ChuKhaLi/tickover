import { describe, it, expect } from 'vitest'
import { ACTIVITY_TIER_THRESHOLDS, LANGUAGE_LABELS, LANGUAGES, OS_LABELS, OsName } from '../src/index.js'

describe('labels', () => {
  // A new extension mapping adds a language; without a label its chip would show the id.
  it('labels every language and nothing else', () => {
    expect(Object.keys(LANGUAGE_LABELS).sort()).toEqual([...LANGUAGES].sort())
    expect(LANGUAGE_LABELS['csharp']).toBe('C#')
    expect(LANGUAGE_LABELS['cpp']).toBe('C++')
    expect(LANGUAGE_LABELS['typescript']).toBe('TypeScript')
  })

  it('labels every operating system the schema accepts', () => {
    expect(Object.keys(OS_LABELS).sort()).toEqual([...OsName.options].sort())
    expect(OS_LABELS.darwin).toBe('macOS')
  })

  it('states the tier bounds the server classifies by', () => {
    expect(ACTIVITY_TIER_THRESHOLDS).toEqual({ REGULAR_FROM: 5, HEAVY_FROM: 21 })
  })
})
