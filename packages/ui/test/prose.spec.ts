// R300 carried into the package: both apps @source packages/ui/src, and the spike measured one
// comment there minting 8 utilities (+2,266 bytes) into the web sheet. So comments in src/ may not
// use a word that is also a Tailwind utility. Stories are excluded by every consumer's @source not.
import { readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { uiRoot } from './palette'

const WORDS = ['invisible', 'visible', 'filter', 'table', 'fixed', 'static', 'relative', 'absolute', 'sticky', 'truncate',
  'uppercase', 'lowercase', 'italic', 'transition', 'outline', 'border', 'ring', 'shadow', 'grid', 'flex', 'hidden',
  'block', 'inline', 'contents', 'underline', 'capitalize', 'blur', 'grow', 'shrink', 'container', 'isolate', 'collapse']

export function comments(src: string): string {
  return [...src.matchAll(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g)].map((m) => m[0]).join('\n')
}
export function offending(text: string): string[] {
  return WORDS.filter((w) => new RegExp(`(^|[^A-Za-z0-9-])${w}($|[^A-Za-z0-9-])`).test(text))
}

describe('comments under packages/ui/src', () => {
  const files = readdirSync(resolve(uiRoot, 'src')).filter((f) => f.endsWith('.ts') && !f.endsWith('.stories.ts'))
  it('name no Tailwind utility', () => {
    const hits = files.flatMap((f) => offending(comments(readFileSync(resolve(uiRoot, 'src', f), 'utf8'))).map((w) => `${f}: ${w}`))
    expect(hits).toEqual([])
  })
  it("would have caught the spike's own comment", () => {
    expect(offending(comments('/** Prose probe: invisible filter table fixed sticky truncate uppercase italic transition outline. */'))).toHaveLength(10)
  })
  it('is reading real files', () => { expect(files).toContain('button.ts') })
})
