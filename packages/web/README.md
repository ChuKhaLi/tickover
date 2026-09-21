# @tickover/web

The Analog (Angular 22) app: the public site, the buyer dashboard (`/app`), the developer pages
(`/dev`) and admin (`/admin`). It talks only to the NestJS server, over relative `/api/...` paths, so
it must be served from the same origin — see **Deployment layout** in `packages/server/README.md`.

## Commands

    cp .env.example .env                       # optional; every variable is unset by default
    pnpm --filter @tickover/web dev           # http://localhost:5173, proxies /api and /webhooks to :8787
    pnpm --filter @tickover/web test          # vitest: component, unit and dev-proxy tests
    pnpm --filter @tickover/web e2e           # Playwright smoke suite against the built artifact
    pnpm --filter @tickover/web build         # dist/analog/public — the deployable directory
    pnpm --filter @tickover/web preview       # serves that directory on :4173, as the proxy will
    pnpm --filter @tickover/web typecheck     # app, spec, scripts and e2e projects

From the repo root, `pnpm build:web` and `pnpm test:web` are the same two commands with the contract
built first.

## What the build emits

`vite build` runs the Analog plugin with `ssr: false, static: true`, then `tsx scripts/postbuild.ts`
writes a per-route `<title>`, description and `og:url` into each prerendered page.

**The deployable directory is `dist/analog/public`, not `dist/client`** (R34). Only it holds the
prerendered `buyers/`, `data/` and `developers/` folders; `dist/client` is Vite's client bundle with
one `index.html` carrying the landing page's head. A proxy pointed at `dist/client` serves every URL
the landing preview.

Because `ssr: false`, a prerendered page is an empty SPA shell with a real document head (R42). The
head is the whole of the link preview the spec §7 Phase 0 posts render; the body needs JavaScript.

## The Playwright suite

`pnpm --filter @tickover/web e2e` builds the app, serves `dist/analog/public` through
`e2e/static-server.ts`, and drives Chromium through the public path and the buyer path with every
`/api/**` call answered from `e2e/mock-api.ts`. No server, no Postgres, no Docker, and no request
leaves the machine.

It is the only test here that loads what Vite emits. Everything else mounts a component or drives a
mocked HTTP layer, and this branch has repeatedly found defects that appear nowhere else: a call to
action that navigated to the wrong page, an input Chromium refused all typing into, a page that
rendered nothing while its suite stayed green.

Two things worth knowing before changing it:

- **`e2e/static-server.ts` is not `vite preview`, deliberately — and neither is `pnpm preview`.**
  `vite preview` serves `dist/client` and its SPA fallback runs before any directory lookup, so it
  answers `/developers` — the spelling `og:url` names — with the landing document. The static server
  implements exactly the `try_files` order that `packages/server/README.md`'s Caddyfile declares, so
  the deployment note is executable. The `preview` script was repointed at it for the same reason:
  `preview` is what someone runs to see what production will look like, and serving a tree we never
  deploy hands a confident wrong answer to exactly the person doing the checking. A unit test pins
  the script so it cannot drift back.
- **The suite rebuilds every time** (`reuseExistingServer: false`). A stale bundle is this repo's
  oldest trap and the one a browser cannot detect: a stale page looks like a working one.

Browsers are not installed by `pnpm install`:

    pnpm --filter @tickover/web exec playwright install chromium

The e2e build sets `VITE_WAITLIST_ENDPOINT` to the suite's own origin so the waitlist success path
can be exercised, which means the `dist/` left behind afterwards has a test value baked in. Rebuild
before deploying from a tree the suite has run in.

## Layout

    index.html               the shared shell: head tags, <base href="/">, favicon, SPA mount point
    public/                  copied verbatim into the build output (favicon.ico)
    src/app/pages/           Analog file routes; every page class is a default export
    src/app/ui/              shared components (Shell, Money, Bar, StudyBadge, WaitlistForm, Confirm)
    src/app/lib/             ApiService, AuthState and the guards, money and study-form helpers
    src/styles.css           Tailwind entry, and the seven `@source not` lines below
    scripts/postbuild.ts     per-route head rewrite, run after `vite build`
    e2e/                     Playwright suite, its API mock and its static server

## Two traps this package has been caught by

1. **Tailwind mints utilities from English prose** (R47/R64). Its scanner reads every file in this
   package it is not told to skip — comments and documentation included — and `.invisible`, `.fixed`,
   `.table`, `.relative` and `.filter` have all shipped that way. `src/styles.css` carries one
   `@source not` line per non-shipped source, and **anything added outside `src` needs its own**.
   Measured here: `e2e/` put `.invisible` and `.table` back (+50 bytes), and **this README on its own
   added 1,612**, because it is full of `pnpm --filter` and `.filter` drags thirteen `@property`
   declarations along. The check is the emitted CSS byte count — 18,014 after `rm -rf dist`, which is
   what `test/unit/styles.spec.ts` asserts — not the config.

   One orphan in that baseline is deliberate: `.hidden` comes from shipped copy (spec §4.7's "a
   hidden sponsor"), not from prose. Do not remove it.

2. **`typecheck` does not catch template errors** (R43). Plain `tsc` ignores `strictTemplates`, so a
   bogus `[routerLink]` binding passes `typecheck` and vitest and fails only in `vite build`. A build
   is required verification for any change here.
