import { defineConfig } from 'tsup'
export default defineConfig({
  entry: { cli: 'src/cli.ts' },
  format: ['esm'],
  target: 'node22',
  platform: 'node',
  bundle: true,
  noExternal: ['@tickover/contract', 'zod', 'string-width'],
  // tsup's default strips the `node:` prefix from built-in imports for legacy compat, but
  // node:sqlite has no non-prefixed alias — stripping it breaks the built CLI at runtime.
  removeNodeProtocol: false,
  banner: { js: '#!/usr/bin/env node' },
  clean: true,
  sourcemap: true,
})
