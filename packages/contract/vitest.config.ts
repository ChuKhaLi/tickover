import { defineConfig } from 'vitest/config'
/**
 * `testTimeout` is 20s rather than vitest's 5s, and it is not a preference.
 *
 * `content-legibility.test.ts` sweeps the whole attention pool across every width the
 * composer can produce. It is a deterministic sweep -- its *result* never depends on
 * elapsed time, only its completion does -- and it runs 3.0 to 4.4s on an idle
 * machine. Under the 5s default that is 1.1s of headroom, so it fails whenever the
 * machine is doing anything else.
 *
 * It had 20s in `packages/daemon/vitest.config.ts` and lost it when the file moved
 * here (5e37bda). The number travelled with neither the file nor the config, because
 * it belonged to the config and the file was what moved. Measured on one machine
 * under one load, varying only this value: 5s failed 3 of 3, 20s passed 3 of 3.
 *
 * What it costs when it fires is the reason this is a one-line fix rather than a
 * tolerated flake: `pnpm test:client` is `contract && cli && vscode`, so a red
 * contract halts the chain and the daemon's 207 tests and the extension's 8 never
 * run. They are not reported as skipped; they do not appear at all. `--no-bail` and
 * reordering both make that visible without fixing it.
 */
export default defineConfig({ test: { include: ['test/**/*.test.ts'], testTimeout: 20_000 } })
