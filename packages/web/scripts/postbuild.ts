import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PAGE_META, SITE_URL, applyPageMeta } from '../src/app/lib/page-meta'

/**
 * Runs after `vite build`. Analog's prerender copies `index.html` verbatim to every
 * route, which shipped four md5-identical documents; with `ssr: false` the body is an
 * empty shell (R42), so that one head was the whole link preview for all four URLs —
 * `/developers` previewed the landing headline and every og:url named the site root.
 * Spec §7 Phase 0 posts these URLs to r/ClaudeAI, r/cursor and X, so this runs before
 * the outreach, not after.
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
 * tree leaves what the first run left -- the same rule the meta tags follow, and for
 * the same reason.
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
 * The throw above catches the other direction -- a map entry with no file -- and only
 * that direction, which leaves this one open: `vite.config.ts` lists the routes to
 * prerender and `page-meta.ts` lists the routes to write, and nothing held the two
 * lists together. A route added to one and not the other goes out with the landing
 * page's preview on it and no preload, which is the defect this script was written
 * for, arriving from the side it does not watch.
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
    // message about a list it does not belong in. The mount point is what makes a
    // document one of Analog's: `ssr: false` leaves every route as this and nothing
    // else (R42), and a static page that a person wrote has no reason to carry it.
    .filter((f) => readFileSync(f, 'utf8').includes('<mw-root>'))
    .map((f) => relative(publicDir, f).split('\\').join('/'))
}

/**
 * Throws on a page it cannot find rather than carrying on. Skipping quietly is the
 * shape of the defect being fixed: nothing fails, and one route goes out with
 * another route's preview on it.
 */
export function writePageHeads(publicDir: string = PUBLIC_DIR, siteUrl: string = SITE_URL): string[] {
  const written: string[] = []
  for (const [route, meta] of Object.entries(PAGE_META)) {
    const file = fileFor(publicDir, route)
    if (!existsSync(file)) {
      throw new Error(`postbuild: ${file} is not there. Is ${route} in vite.config.ts's prerender list?`)
    }
    const html = readFileSync(file, 'utf8')
    const css = stylesheetFor(publicDir, html, file)
    const faces = [...ALWAYS, ...(ALSO[route] ?? [])].map((stem) => faceUrl(css, stem, file))
    writeFileSync(file, withFontPreloads(applyPageMeta(html, meta, siteUrl), faces), 'utf8')
    written.push(file)
  }
  const stray = strayPages(publicDir, written)
  if (stray.length) {
    throw new Error(`postbuild: ${stray.join(', ')} was prerendered but is not in PAGE_META, so it kept another route's head`)
  }
  return written
}

const entry = process.argv[1]
if (entry && resolve(entry) === resolve(fileURLToPath(import.meta.url))) {
  const files = writePageHeads()
  console.log(`postbuild: wrote a per-route head and its font preloads into ${files.length} prerendered pages (${SITE_URL}).`)
  for (const file of files) console.log(`  ${file}`)
}
