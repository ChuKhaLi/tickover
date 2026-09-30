// The tokens moved to packages/ui/tokens.css (R600). Specs that read hexes out of the
// stylesheet read this instead, so a token is found wherever the build actually gets it.
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
export function tokenSource(): string {
  return readFileSync(resolve(packageRoot, 'src/styles.css'), 'utf8') + '\n' + readFileSync(resolve(packageRoot, '../ui/tokens.css'), 'utf8')
}
