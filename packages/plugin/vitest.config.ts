import { defineConfig } from 'vitest/config'
// One file at a time (R922). statusline.spec and notify.spec both time child Node processes against
// the scripts' real 1000/1400/800ms budgets, and run side by side each one's process starts were
// load on the other's clock -- the suite was flaking on itself, before any other load arrived.
export default defineConfig({ test: { include: ['test/**/*.spec.ts'], testTimeout: 15_000, fileParallelism: false } })
