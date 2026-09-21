import { defineConfig, devices } from '@playwright/test'
import { PORT } from './e2e/static-server'
import { WAITLIST_ENDPOINT } from './e2e/mock-api'

const baseURL = `http://127.0.0.1:${PORT}`

export default defineConfig({
  testDir: 'e2e',
  timeout: 30_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  forbidOnly: Boolean(process.env['CI']),
  reporter: [['list']],
  use: { baseURL, headless: true, trace: 'retain-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    // Always a fresh build. `reuseExistingServer` would hand the suite whatever
    // `dist/` happened to hold — the stale-bundle trap this repo has been caught by
    // three times, and the one form of it a browser cannot detect, since a stale
    // page looks exactly like a working one.
    //
    // `preview` is `e2e/static-server.ts`, not `vite preview`: preview served
    // `dist/client`, which is not the deployable directory (R34), and resolved
    // `/developers` to the landing document from either directory. The package
    // script was repointed at this server so the command a person runs to check a
    // production build and the command this suite runs are the same one.
    command: 'pnpm run build && pnpm run preview',
    url: `${baseURL}/`,
    reuseExistingServer: false,
    timeout: 240_000,
    stdout: 'pipe',
    stderr: 'pipe',
    env: {
      // Unset in this repo, and `submitWaitlist` reports an unset endpoint as a
      // failure rather than pretending to send — correct, and it would make the
      // waitlist's success path untestable. Pointing it at the suite's own origin
      // is what lets the built bundle be driven through a real submission; the
      // interception then happens in `mock-api.ts`.
      VITE_WAITLIST_ENDPOINT: WAITLIST_ENDPOINT,
    },
  },
})
