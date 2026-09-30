// From package.json rather than a literal: the literal was never bumped, so 0.1.1 shipped reporting
// 0.1.0 from `tickover version`, `tickover status` and /v1/health. esbuild inlines the JSON into
// dist/cli.js, so nothing reads package.json at runtime. Its own module so launch.ts can compare a
// running daemon's version without importing daemon.ts, which imports launch.ts through login.ts.
import pkg from '../package.json' with { type: 'json' }

export const VERSION: string = pkg.version
