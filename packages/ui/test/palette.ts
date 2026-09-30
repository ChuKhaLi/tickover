// Reads the token file the apps import, never a copy of it: the bug this guards travels through
// the stylesheet (same reasoning as packages/web/test/unit/tokens.spec.ts).
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const uiRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
export const tokensCss = (): string => readFileSync(resolve(uiRoot, 'tokens.css'), 'utf8')

export function tokens(): Map<string, string> {
  const found = new Map<string, string>()
  for (const m of tokensCss().matchAll(/--color-([a-z0-9-]+):\s*(#[0-9A-Fa-f]{6});/g)) found.set(m[1]!, m[2]!.toUpperCase())
  return found
}

const LITERALS: Record<string, string> = { white: '#FFFFFF' }
export function hexOf(name: string): string {
  const hex = LITERALS[name] ?? tokens().get(name)
  // A renamed token must fail loudly; a default would let a contrast table measure nothing.
  if (!hex) throw new Error(`no --color-${name} in packages/ui/tokens.css`)
  return hex
}

const channel = (c: number) => { const s = c / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4 }
function luminance(hex: string): number {
  const h = hex.replace('#', '')
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as [number, number, number]
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)
}
export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number]
  return (hi + 0.05) / (lo + 0.05)
}
