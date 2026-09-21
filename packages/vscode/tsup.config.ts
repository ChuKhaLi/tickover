import { defineConfig } from 'tsup'

// R12: tsup 8 defaults removeNodeProtocol to true, which strips the `node:` prefix from
// built-in imports when bundling. This bit Task 4 hard -- node:sqlite has no bare alias, so
// the built CLI died at runtime while every source test (which runs against source, not the
// bundle) stayed green. Set explicitly even though today's imports (node:fs, node:http,
// node:os, node:path) all happen to have working bare aliases: the failure is invisible to
// tests, so a future node:-only import here would ship broken with nothing to catch it.
const removeNodeProtocol = false

export default defineConfig([
  { entry: { extension: 'src/extension.ts' }, format: ['cjs'], target: 'node18', platform: 'node', external: ['vscode'], noExternal: ['@tickover/contract', 'zod', 'string-width'], removeNodeProtocol, sourcemap: true, clean: true },
  { entry: { 'e2e/extension.test': 'test/e2e/extension.test.ts' }, format: ['cjs'], target: 'node18', platform: 'node', external: ['vscode', 'mocha'], removeNodeProtocol, outDir: 'dist', sourcemap: true },
])
