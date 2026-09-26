import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PAGE_META, SITE_NAME, SITE_URL, pageUrl, type PageMeta } from '../src/app/lib/page-meta'

/**
 * Runs after `vite build`. Analog's prerender copies `index.html`'s head verbatim to
 * every route, which shipped four documents with one head; under R42 (plan 2) the body
 * was an empty shell too, so that one head was the whole link preview for all four
 * URLs — `/developers` previewed the landing headline and every og:url named the site
 * root. Spec §7 Phase 0 posts these URLs to r/ClaudeAI, r/cursor and X, so this runs
 * before the outreach, not after. R400 renders the bodies, and since spec §2 the `Seo`
 * service writes the heads during that render; this step checks them (`checkPageHeads`),
 * writes the font preloads, marks the bundle low fetch priority (`lowerScriptPriority`, R412), and
 * writes the SPA fallback (`writeShell`, R401).
 */

/** Measured, not assumed: the prerender lands here, not in `dist/client` (R34). */
export const PUBLIC_DIR = 'dist/analog/public'

/** Route path → the file Analog emits for it. */
function fileFor(publicDir: string, route: string): string {
  return route === '/' ? join(publicDir, 'index.html') : join(publicDir, route.slice(1), 'index.html')
}

/**
 * The faces every route paints its first words in.
 *
 * Measured on the artifact this repo emits, over a link throttled to 4 Mbps and 60ms
 * (`chromium`, `Network.emulateNetworkConditions`), and the numbers are the reason
 * this step exists: the document is asked for at 0ms, the bundle and the stylesheet
 * at 97ms, and the sans face at **395ms** -- it cannot be asked for sooner, because
 * nothing knows the page needs it until the stylesheet has been fetched and parsed.
 * A preload link moves it into the first round, beside the bundle.
 */
const ALWAYS = ['ibm-plex-sans-latin-wght-normal'] as const

/**
 * And the landing page's own, which are the reason this is per-route rather than one
 * list.
 *
 * The same run measured the mono faces starting at **1239ms and 1250ms** -- a second
 * after the sans, because `ssr: false` leaves the body as `<mw-root></mw-root>` (R42)
 * and nothing paints in mono until the route chunk lands at 916ms and Angular
 * renders the hero. So for the first second and a quarter of every cold load, the
 * one object this product is a picture of is drawn in the fallback face. It is set
 * `whitespace-pre` at a width computed from the real face's advance (`ADVANCE_EM`),
 * so a substitute face does not merely look different: the replica is the wrong size
 * until the right one arrives, on the page whose whole claim is to be true to width.
 *
 * Those timings predate R400. The hero now arrives in the document, so the mono is
 * wanted as soon as the stylesheet is parsed rather than once the bundle boots, and
 * the preload still moves it into the first round beside the stylesheet.
 *
 * Only `/`. A preload is a promise that the page needs the file straight away, and
 * `/privacy` does not: its mono is in cells further down, and preloading 29KB there
 * would take bandwidth from the bundle that has to boot before anything appears.
 */
const ALSO: Readonly<Record<string, readonly string[]>> = {
  '/': ['ibm-plex-mono-latin-400-normal', 'ibm-plex-mono-latin-600-normal'],
}

/** `<link rel="stylesheet" href="/assets/index-HASH.css">`, which Vite writes into every emitted file. */
function stylesheetFor(publicDir: string, html: string, file: string): string {
  const href = html.match(/<link\b[^>]*rel="stylesheet"[^>]*href="([^"]+)"/)?.[1]
  if (!href) throw new Error(`postbuild: ${file} has no stylesheet link, so its faces cannot be found`)
  const sheet = join(publicDir, href.replace(/^\//, ''))
  if (!existsSync(sheet)) throw new Error(`postbuild: ${file} points at ${href}, which is not in the build`)
  return readFileSync(sheet, 'utf8')
}

/**
 * The hashed URL of one face, read out of the stylesheet that references it.
 *
 * Out of the sheet rather than off the directory listing, because the sheet is what
 * the browser will ask for: a file that is emitted but unreferenced is a file no
 * preload should promise. Vite hashes the name, so there is nothing to write down.
 */
function faceUrl(css: string, stem: string, file: string): string {
  const url = new RegExp(`url\\((/assets/${stem}-[A-Za-z0-9_-]+\\.woff2)\\)`).exec(css)?.[1]
  if (!url) throw new Error(`postbuild: ${file} loads no ${stem}.woff2; has the font import changed?`)
  return url
}

/**
 * Replaces the preload block rather than appending to it, so a second run over one
 * tree leaves what the first run left: a rebuild over an already-processed tree must
 * not compound.
 *
 * `crossorigin` is not decoration: a font is fetched in CORS mode whatever the
 * origin, and a preload without it is a second, separate request rather than the one
 * the stylesheet is about to make.
 */
function withFontPreloads(html: string, urls: readonly string[]): string {
  const stripped = html.replace(/[ \t]*<link rel="preload" as="font"[^>]*>\n?/g, '')
  const closing = /([ \t]*)<\/head>/
  const indent = stripped.match(closing)?.[1]
  if (indent === undefined) throw new Error('postbuild: no </head> to put the preloads before')
  const block = urls
    .map((u) => `${indent}  <link rel="preload" as="font" type="font/woff2" href="${u}" crossorigin>`)
    .join('\n')
  return stripped.replace(closing, () => `${block}\n${indent}</head>`)
}

/**
 * Every `index.html` under the tree, so a route that was prerendered without a
 * `PAGE_META` entry is found rather than shipped untouched.
 *
 * The throw below catches the other direction -- a map entry with no file -- and only
 * that direction, which leaves this one open: `vite.config.ts` lists the routes to
 * prerender and `page-meta.ts` lists the routes that are public, and nothing held the
 * two lists together. A route added to the first alone is rendered by `Seo` as a
 * screen off the map -- noindex, no canonical -- and gets no preload: a public page
 * that asks not to be found, arriving from the side the check does not watch.
 */
function strayPages(publicDir: string, written: readonly string[]): string[] {
  const seen = new Set(written.map((f) => resolve(f)))
  return readdirSync(publicDir, { recursive: true, encoding: 'utf8' })
    .filter((f) => f.endsWith('index.html'))
    .map((f) => join(publicDir, f))
    .filter((f) => !seen.has(resolve(f)))
    // A prerendered route, not merely a file with that name. `public/` is copied into
    // the output verbatim, so a hand-written `public/something/index.html` would have
    // been reported as a route missing from PAGE_META and killed the build with a
    // message about a list it does not belong in. Analog's server context attribute is
    // what makes a document one of its routes (R400): the render writes it onto every
    // mount point, and a static page a person wrote has no reason to carry it. The old
    // marker, a bare `<mw-root>`, no longer appears in a rendered route at all.
    .filter((f) => readFileSync(f, 'utf8').includes('ng-server-context="ssr-analog"'))
    .map((f) => relative(publicDir, f).split('\\').join('/'))
}

/** The entities the server render writes into text and attribute values, decoded so they compare. */
function decode(value: string): string {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
}

/** Every value of `attr` on tags matching `tag`, so a duplicate is seen rather than the first one read. */
function attrsOf(html: string, tag: RegExp, attr: string): string[] {
  const value = new RegExp(`\\b${attr}="([^"]*)"`)
  return [...html.matchAll(tag)].map((m) => decode(value.exec(m[0])?.[1] ?? ''))
}

/**
 * The three head values a crawler reads first, against `PAGE_META`. `Seo` writes them during the
 * render (spec §2); this does not write them again, because a second writer is how the two came to
 * disagree in the first place. Throws naming the route and the tag.
 */
function checkHead(html: string, route: string, meta: PageMeta, siteUrl: string, file: string): void {
  const expect = (label: string, found: string[], want: string) => {
    if (found.length !== 1 || found[0] !== want) {
      throw new Error(`postbuild: ${route} (${file}) has ${label} ${JSON.stringify(found)}, expected exactly ${JSON.stringify(want)}`)
    }
  }
  expect('title', [...html.matchAll(/<title>([\s\S]*?)<\/title>/g)].map((m) => decode(m[1] ?? '')), meta.title)
  expect('description', attrsOf(html, /<meta\b[^>]*\bname="description"[^>]*>/g, 'content'), meta.description)
  expect('canonical', attrsOf(html, /<link\b[^>]*\brel="canonical"[^>]*>/g, 'href'), pageUrl(meta.path, siteUrl))
}

/**
 * Checks each prerendered route's head, then writes its font preloads, the one thing this step
 * still writes.
 *
 * Throws on a page it cannot find, and on a head that disagrees with `PAGE_META`, rather than
 * carrying on. Skipping quietly is the shape of the defect being fixed: nothing fails, and one
 * route goes out with another route's preview on it.
 */
export function checkPageHeads(publicDir: string = PUBLIC_DIR, siteUrl: string = SITE_URL): string[] {
  const written: string[] = []
  for (const [route, meta] of Object.entries(PAGE_META)) {
    const file = fileFor(publicDir, route)
    if (!existsSync(file)) {
      throw new Error(`postbuild: ${file} is not there. Is ${route} in vite.config.ts's prerender list?`)
    }
    const html = readFileSync(file, 'utf8')
    checkHead(html, route, meta, siteUrl, file)
    const css = stylesheetFor(publicDir, html, file)
    const faces = [...ALWAYS, ...(ALSO[route] ?? [])].map((stem) => faceUrl(css, stem, file))
    writeFileSync(file, withFontPreloads(html, faces), 'utf8')
    written.push(file)
  }
  const stray = strayPages(publicDir, written)
  if (stray.length) {
    throw new Error(`postbuild: ${stray.join(', ')} was prerendered but is not in PAGE_META, so it was rendered noindex with no canonical and nothing checked it`)
  }
  return written
}

/**
 * Vite's entry tag and its modulepreloads, as the render serialises them (`crossorigin=""`) or as
 * Vite wrote them (bare `crossorigin`). `crossorigin` has to follow the opening words directly, so
 * a tag this has already marked no longer matches, and a second run is a no-op.
 */
const ENTRY_TAG = /<script type="module"( crossorigin(?:="")? src="[^"]+")><\/script>/g
const PRELOAD_TAG = /<link rel="modulepreload"( crossorigin(?:="")? href="[^"]+")>/g

/**
 * Marks each prerendered page's bundle low priority (R412). The fetch still starts from the parser,
 * as early as before, and hydration is not delayed; what changes is that on a contended link the
 * stylesheet and the fonts are served ahead of 105 KB of script nothing above the fold needs.
 *
 * Measured locally, median of 3 on the seven routes, it moved FCP by 300-1000ms on each and LCP on
 * `/` from 2812 to ~2280ms, and hurt nothing. The gain is mostly Lighthouse's: its simulation treats
 * a Low request as not render-blocking. R412 records why that is kept while the bigger lab win was
 * not.
 *
 * Throws on a page with no entry tag or no modulepreload, rather than shipping a page it quietly did
 * nothing to: either means Vite changed what it writes.
 */
export function lowerScriptPriority(publicDir: string = PUBLIC_DIR, routes: readonly string[] = Object.keys(PAGE_META)): string[] {
  return routes.map((route) => {
    const file = fileFor(publicDir, route)
    const html = readFileSync(file, 'utf8')
    const done = (tag: string) => html.includes(`<${tag} fetchpriority="low"`)
    const entries = html.match(ENTRY_TAG)?.length ?? 0
    const preloads = html.match(PRELOAD_TAG)?.length ?? 0
    if (entries === 0 && !done('script type="module"')) throw new Error(`postbuild: ${route} (${file}) has no entry script to lower`)
    if (entries > 1) throw new Error(`postbuild: ${route} (${file}) has ${entries} entry scripts, expected one`)
    if (preloads === 0 && !done('link rel="modulepreload"')) throw new Error(`postbuild: ${route} (${file}) has no modulepreload to lower`)
    const out = html
      .replace(ENTRY_TAG, (_m, rest: string) => `<script type="module" fetchpriority="low"${rest}></script>`)
      .replace(PRELOAD_TAG, (_m, rest: string) => `<link rel="modulepreload" fetchpriority="low"${rest}>`)
    writeFileSync(file, out, 'utf8')
    return file
  })
}

/** The SPA fallback for every URL that is not prerendered (R401). */
export const SHELL = 'shell.html'

/**
 * With `ssr: true` the prerendered `index.html` is the landing page, rendered (captured: 8.6 KB with
 * the landing h1). It used to be the fallback too, so without this every `/app` deep link would be
 * served landing markup. `dist/client/index.html` is the unrendered document Vite emitted before
 * prerendering, and is exactly what the fallback should be.
 */
export function writeShell(publicDir: string = PUBLIC_DIR, clientDir = 'dist/client'): string {
  const src = join(clientDir, 'index.html')
  if (!existsSync(src)) throw new Error(`postbuild: ${src} is not there, so there is no shell to fall back to`)
  const html = readFileSync(src, 'utf8')
  if (html.includes('ng-server-context')) throw new Error(`postbuild: ${src} is already rendered; it cannot be the shell`)
  const out = join(publicDir, SHELL)
  // Strip any robots tag, then add ours. Skipping when one exists would let an `index` tag in
  // index.html turn every app URL indexable.
  const marked = html
    .replace(/[ \t]*<meta\b[^>]*\bname="robots"[^>]*>\r?\n?/g, '')
    .replace(/([ \t]*)<\/head>/, (_m, i: string) => `${i}  <meta name="robots" content="noindex">\n${i}</head>`)
  writeFileSync(out, marked, 'utf8')
  return out
}

/**
 * The sitemap (Step 5, R408), written here rather than left to Analog's own
 * `prerender.sitemap`. Review found two defects in `@analogjs/vite-plugin-nitro`'s
 * `build-sitemap.js`: it writes the namespace as `https://www.sitemaps.org/…`, when the
 * protocol's own spec (sitemaps.org) is `http://`, and it sets every `<lastmod>` to the
 * build date, on every route, on every build -- claiming every page changed on every
 * deploy, which defeats a crawler's incremental-fetch heuristics rather than helping them.
 * This writes the real namespace, no `lastmod`, and one `<loc>` per `PAGE_META` route
 * using `pageUrl` -- the same function `Seo` calls for the canonical -- so a `<loc>`
 * cannot name a URL the page itself disagrees with.
 */
export function writeSitemap(publicDir: string = PUBLIC_DIR, siteUrl: string = SITE_URL): string {
  const urls = Object.values(PAGE_META)
    .map((meta) => `  <url><loc>${pageUrl(meta.path, siteUrl)}</loc></url>`)
    .join('\n')
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`
  const out = join(publicDir, 'sitemap.xml')
  writeFileSync(out, xml, 'utf8')
  return out
}

/**
 * `llms.txt` (Step 3, R408). The spec lists it under `public/`, but every `PAGE_META`
 * description carries a price that comes from the contract (R49), never typed in -- a
 * file committed to `public/` would go stale the moment a contract constant changed,
 * exactly the failure R49 exists to close everywhere else. So this generates it on every
 * build instead, from the same map `checkPageHeads` verifies against, following the
 * llmstxt.org shape: a title, a one-paragraph `>` summary, then the pages.
 */
/**
 * How a developer starts, for `llms.txt` (R416). Typed here rather than read from the plugin
 * manifests because the web image copies only `contract` and `web` into its build; `postbuild.spec.ts`
 * holds each value to `.claude-plugin/marketplace.json`, the plugin's `plugin.json` and its skills.
 */
export const INSTALL = {
  marketplace: 'ChuKhaLi/tickover',
  plugin: 'tickover@tickover',
  setup: '/tickover:setup',
} as const

export function writeLlmsTxt(publicDir: string = PUBLIC_DIR, siteUrl: string = SITE_URL): string {
  const home = PAGE_META['/']!
  const pages = Object.values(PAGE_META)
    .map((meta) => `- [${meta.title}](${pageUrl(meta.path, siteUrl)})`)
    .join('\n')
  // R416: a developer's own Claude Code, asked for a way to earn while it works, reads this file
  // as text. It needs the commands, and the consent step named, so nothing is installed unseen.
  const install = [
    '## Install',
    '',
    'For developers using Claude Code. In a terminal:',
    '',
    '```',
    `claude plugin marketplace add ${INSTALL.marketplace}`,
    `claude plugin install ${INSTALL.plugin}`,
    '```',
    '',
    `Then run \`${INSTALL.setup}\` inside Claude Code. It checks Node (22.13 or newer), installs the`,
    '`tickover-cli` daemon from npm, shows exactly what is sent and asks for consent, and signs in',
    `with GitHub. Source: https://github.com/${INSTALL.marketplace}`,
  ].join('\n')
  const txt = `# ${SITE_NAME}\n\n> ${home.description}\n\n${install}\n\n## Pages\n\n${pages}\n`
  const out = join(publicDir, 'llms.txt')
  writeFileSync(out, txt, 'utf8')
  return out
}

const entry = process.argv[1]
if (entry && resolve(entry) === resolve(fileURLToPath(import.meta.url))) {
  const files = checkPageHeads()
  console.log(`postbuild: checked the head the render wrote, and wrote the font preloads, in ${files.length} prerendered pages (${SITE_URL}).`)
  for (const file of files) console.log(`  ${file}`)
  console.log(`postbuild: marked the bundle low fetch priority in ${lowerScriptPriority().length} prerendered pages (R412).`)
  console.log(`postbuild: wrote the SPA fallback, marked noindex, to ${writeShell()}.`)
  console.log(`postbuild: wrote the sitemap to ${writeSitemap()}.`)
  console.log(`postbuild: wrote llms.txt to ${writeLlmsTxt()}.`)
}
