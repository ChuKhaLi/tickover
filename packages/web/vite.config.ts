/// <reference types="vitest" />
import { defineConfig } from 'vite'
import analog from '@analogjs/platform'
import tailwindcss from '@tailwindcss/vite'

/**
 * Where `pnpm dev` proxies /api and /webhooks. The default is the port
 * `scripts/e2e-up.ps1` starts the API server on, so the two line up with nothing to
 * configure -- `test/unit/dev-proxy-target.spec.ts` reads that script and holds the
 * two together.
 *
 * It is overridable only so `test/dev-proxy.spec.ts` can point the dev server it
 * spawns at an ephemeral port. That spec used to bind 8787 itself, which meant the
 * web suite and the local stack could not run at the same time -- it failed loudly,
 * which is better than quietly, but it still failed.
 */
const DEFAULT_API_TARGET = 'http://localhost:8787'
const API_TARGET = process.env['TICKOVER_API_TARGET'] ?? DEFAULT_API_TARGET

export default defineConfig(({ mode }) => ({
  build: { target: ['es2022'] },
  resolve: { mainFields: ['module'] },
  plugins: [
    analog({
      // `/api` belongs to the NestJS server, not to Analog. Do not delete this or
      // set it back to the default `api`: Analog's Nitro plugin mounts a catch-all
      // dev handler on its prefix inside a non-returning `configureServer` hook,
      // which runs *before* Vite installs `server.proxy` below. With the default,
      // every `/api/**` call in `pnpm dev` gets Nitro's own 404 instead of reaching
      // port 8787 — and it looks like a broken NestJS server, because `/webhooks`
      // proxies fine and `vite preview` proxies `/api` fine too. `test/dev-proxy.spec.ts`
      // is what actually holds this down. (`useAPIMiddleware: false` does not fix
      // it; the dev mount ignores that option and it adds a second interceptor.)
      apiPrefix: '_analog_api',
      ssr: true,
      static: true,
      // R400 supersedes R42 (plan 2): these seven are rendered at build time.
      // Every key of PAGE_META has to be here (postbuild checks both directions).
      prerender: { routes: ['/', '/developers', '/buyers', '/data', '/privacy', '/terms/developers', '/terms/buyers'] },
    }),
    tailwindcss(),
  ],
  server: {
    proxy: {
      '/api': { target: API_TARGET, changeOrigin: false },
      '/webhooks': { target: API_TARGET, changeOrigin: false },
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['src/test-setup.ts'],
    include: ['src/**/*.spec.ts', 'test/**/*.spec.ts'],
    // Task 10 adds `e2e/*.spec.ts` for Playwright, which vitest cannot run and
    // the include glob above would otherwise sweep in (ruling W5).
    exclude: ['**/node_modules/**', '**/dist/**', 'e2e/**'],
    reporters: ['default'],
  },
  define: { 'import.meta.vitest': mode !== 'production' },
}))
