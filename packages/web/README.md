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

`vite build` runs the Analog plugin with `ssr: true, static: true` (R400, superseding R42's
`ssr: false`): every public route is rendered at build time with its real markup — not an empty
shell — and hydrates in the browser afterwards, the same as any Angular SSR app's first load. `tsx
scripts/postbuild.ts` runs after it, in this order (`checkPageHeads`, then `lowerScriptPriority`,
`writeShell`, `writeSitemap`, `writeLlmsTxt` — see the entry point at the bottom of the file):

1. **`checkPageHeads`** verifies, but does not write, each prerendered page's `<title>`, description
   and canonical against `PAGE_META`, then writes that route's font preloads. The one writer of the
   head is the `Seo` service (`src/app/lib/seo.ts`): it runs from the title strategy, so it runs
   during the build-time render — what a crawler reads — and again on every client-side navigation.
   A second writer here is how the two came to disagree in the first place, so this step only checks
   and throws on a mismatch, naming the route and the tag.
2. **`lowerScriptPriority`** marks the entry script and its modulepreloads `fetchpriority="low"`
   (R412): the fetch still starts from the parser and hydration is not delayed, but on a contended
   link the stylesheet and fonts are served first.
3. **`writeShell`** copies the unrendered `dist/client/index.html` to `dist/analog/public/shell.html`
   and marks it noindex — the SPA fallback for every URL that is not prerendered (R401). Under
   `ssr: true` the prerendered `index.html` is now the rendered landing page, so it can no longer be
   the fallback: serving it for `/app/**` would leak the landing page's own markup and canonical to
   every deep link.
4. **`writeSitemap`** and **`writeLlmsTxt`** write `sitemap.xml` and `llms.txt` from `PAGE_META` on
   every build (R408), rather than trusting Analog's own `prerender.sitemap` (wrong namespace, and a
   `lastmod` that claims every page changed on every deploy) or committing `llms.txt` under `public/`,
   where a contract-derived price (R49) would go stale the moment the constant it comes from changed.

**The deployable directory is `dist/analog/public`, not `dist/client`** (R34). Only it holds the
prerendered `buyers/`, `data/` and `developers/` folders, plus `shell.html`, `sitemap.xml`,
`llms.txt` and `robots.txt`; `dist/client` is Vite's unrendered client bundle, kept around only as
the source `writeShell` copies from. A proxy pointed at `dist/client` serves every URL that same
unrendered document.

**A public component must never touch the network during the build-time render** (R400, R407). The
render runs in Node, so a component that fetches in its constructor gets its failure baked into the
static HTML — captured once: `/data` shipped "Couldn't load the latest numbers" this way.
`afterNextRender`'s own server guard does not fire in this build: Analog's `serverModePlugin` only
sets the flag it checks inside files ending `platform-server.mjs`/`core.mjs`, never inside a page
component's own compiled output. So browser-only work needs a `typeof window === 'undefined'` guard
of its own as well — `src/app/pages/data.page.ts`'s constructor is the pattern to copy.

**`@defer (hydrate on viewport)` (or any hydrate trigger) is forbidden on a prerendered public page**
(R410): in this build a hydrate trigger's main content never reaches the prerendered HTML at all —
it ships as an empty `<!---->` comment, not merely late-hydrated — because the compiled `@defer`
output depends on the same `ngServerMode` flag the paragraph above found unset for application code.
This is a vendor-code gap (Analog/Angular), not something a page component can work around.

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
    scripts/postbuild.ts     verifies each route's head, lowers script priority, writes shell/sitemap/llms.txt
    e2e/                     Playwright suite, its API mock and its static server

## `index.html` carries no comments, deliberately

It is the shared shell, so every byte in it is downloaded on every page load — and it is small
enough that prose dominates it. Measured 2026-09-25: three comments, 1,369 of its 2,555 bytes,
**53% of the shell**, including internal test paths that were then readable in the page source of
the live site. So the reasoning lives here instead, and `test/unit/icon.spec.ts` holds the file to
having none. (It is also the one file that cannot be excluded from Tailwind's scanner — it is the
shell — so prose there is minted into the stylesheet as well. That is trap 1 below, and it is the
second reason not to write any.)

What the two `rel="icon"` links are for:

- **`/favicon.ico`, with `sizes="16x16 32x32 48x48"`.** Without a real file, every page load asks
  for `/favicon.ico`, gets the SPA shell with an HTML content type, and the browser logs a failed
  icon. The file is `public/favicon.ico`, copied verbatim into the build output; it holds three
  rasters of the mark drawn by `scripts/make-favicon.ts`. **The `sizes` list has to name every
  entry the file actually has**: a browser picks an entry from the attribute without opening the
  file, so an attribute that lies costs a request and yields nothing. `icon.spec.ts` reads the ICO
  and keeps the two in agreement.
- **`/logo.svg`, `type="image/svg+xml"`, declared after it.** One file that scales, and the same
  file the page header renders. The order is the point: a browser that understands the type
  prefers it, and one that does not never sees it and keeps the `.ico`.

## Two traps this package has been caught by

1. **Tailwind mints utilities from English prose** (R47/R64/R77). Its scanner reads every file in
   this package it is not told to skip — comments and documentation included — and `.invisible`,
   `.fixed`, `.table`, `.relative`, `.filter` and `.static` have all shipped that way. This is the
   canonical account of it; `CLAUDE.md`, the `web-package` skill and the comment in `src/styles.css`
   all point here rather than repeating it, because four copies of this had already drifted apart by
   2026-09-25 (R382).

   **The check is the emitted byte count, not the config.** `test/unit/styles.spec.ts` pins it, and
   that constant is the only place the current number is written down — quoting it anywhere else is
   how the other copies went stale. Every earlier movement of it, attributed to the byte, is in
   `docs/superpowers/reports/web-stylesheet-baseline-log.md`.

   Five rules, each of which has cost a round:

   - **Anything added outside `src` needs its own `@source not` line.** Measured: `e2e/` put
     `.invisible` and `.table` back for +50 bytes, and **this README on its own added 1,612**,
     because it is full of `pnpm --filter` and `.filter` drags thirteen `@property` declarations
     along. `vite.config.ts` and `package.json` between them minted `.static{position:static}`.
   - **Exclusions are for trees that ship nothing.** Prose in `src/app` gets *reworded*, not
     excluded — "crawler-visible" and "a visible price" in shipped source minted `.visible` and
     were rewritten.
   - **`index.html` is not excluded and cannot be**: it is shipped markup, so Tailwind has to scan
     it. It is also the one file whose comments reach every visitor, which is why it now has none
     (R380, above).
   - **Each glob must be relative** — the bare non-relative form is silently ignored — and glob
     patterns cannot go in that CSS comment, because `**/` followed by `*` contains the comment
     terminator and fails the build.
   - **The scan root is this package, not the repository.** The root `CLAUDE.md`, also full of
     `pnpm --filter`, is not a source here.

   One orphan in the baseline is deliberate: `.hidden` comes from shipped copy (spec §4.7's "a
   hidden sponsor"), not from prose. Do not chase it.

   When the pin goes red, the two causes need opposite responses. **A real styling change** makes it
   red by construction — re-measure with `rm -rf dist && pnpm --filter @tickover/web build`, write
   the delta into the baseline log, and put the new number in the same commit. **Nothing about the
   styling changed** means a file entered the scan; diff the two stylesheets rule by rule and add
   the exclusion.

2. **`typecheck` does not catch template errors** (R43). Plain `tsc` ignores `strictTemplates`, so a
   bogus `[routerLink]` binding passes `typecheck` and vitest and fails only in `vite build`. A build
   is required verification for any change here.
