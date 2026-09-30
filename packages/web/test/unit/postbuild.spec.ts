// The end-to-end proof that this step ran lives in `head-tags.spec.ts`, which reads
// the real build. This file covers the two things that build cannot show: what
// happens to a route with no prerendered file, and that each file gets *its own*
// metadata rather than the last one written.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, it, expect } from 'vitest'
import { PAGE_META, SITE_NAME, SITE_URL, pageUrl } from '../../src/app/lib/page-meta'
import { INSTALL, SHELL, checkPageHeads, lowerScriptPriority, writeLlmsTxt, writeShell, writeSitemap } from '../../scripts/postbuild'

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const read = (rel: string) => readFileSync(resolve(packageRoot, rel), 'utf8')
const shell = read('index.html')

/**
 * The shell Vite *emits*, which is not the shell this package authors: the build
 * rewrites the stylesheet link to a hashed file under `/assets`, and the font URLs
 * inside that file are hashed too. Both are what the preload step reads, so a staged
 * tree carries both — staging the authored `index.html`, which points at
 * `/src/styles.css` and has no assets directory at all, would be testing the step
 * against a document it never meets.
 */
const SHEET = '/assets/index-TESTHASH.css'
const FACES = {
  sans: 'ibm-plex-sans-latin-wght-normal-AAAAAAAA',
  mono400: 'ibm-plex-mono-latin-400-normal-BBBBBBBB',
  mono600: 'ibm-plex-mono-latin-600-normal-CCCCCCCC',
  /** Emitted and referenced, and preloaded by nothing: a subset is fetched only if a page uses it. */
  vietnamese: 'ibm-plex-mono-vietnamese-400-normal-DDDDDDDD',
}
const styleSheet = Object.values(FACES)
  .map((f) => `@font-face{font-family:a;src:url(/assets/${f}.woff2) format("woff2")}`)
  .join('\n')
/** The entry and its static imports, in the order and shape Vite writes them into the head. */
const ENTRY = '/assets/index-ENTRYHASH.js'
const PRELOADS = ['/assets/_module-chunk-AAAA.js', '/assets/_router-chunk-BBBB.js', '/assets/constants-CCCC.js']
const emittedShell = shell
  .replace(/[ \t]*<script type="module" src="\/src\/main\.ts"><\/script>\r?\n?/, '')
  .replace(
    /<link rel="stylesheet"[^>]*>/,
    () => [
      `<script type="module" crossorigin src="${ENTRY}"></script>`,
      ...PRELOADS.map((p) => `<link rel="modulepreload" crossorigin href="${p}">`),
      `<link rel="stylesheet" crossorigin href="${SHEET}">`,
    ].join('\n    '),
  )
if (emittedShell.includes('/src/main.ts') || !emittedShell.includes(ENTRY)) throw new Error('fixture: index.html no longer has the script tag this rewrites')

/**
 * What a prerendered route looks like under R400: the same document with the mount point rendered
 * and marked with Analog's server context, which is how `strayPages` tells a route from a file
 * that merely has the name. Attributes copied from the built `dist/analog/public/index.html`.
 */
const SERVER_CONTEXT = 'ng-server-context="ssr-analog"'
const renderedPage = emittedShell.replace(
  '<tk-root></tk-root>',
  `<tk-root ng-version="22.1.5" ngh="0" ${SERVER_CONTEXT}><main><h1>page</h1></main></tk-root>`,
)
if (!renderedPage.includes(SERVER_CONTEXT)) throw new Error('fixture: index.html has no empty <tk-root></tk-root> to render into')

const escapeHtml = (v: string) => v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/**
 * What the render writes for one route since `Seo` owns the head: its own title and description,
 * and a canonical naming it. `checkPageHeads` verifies these and writes none of them, so a staged
 * tree that carried the landing head on every route would be a fixture of the defect.
 */
function renderedFor(route: string, siteUrl: string = SITE_URL): string {
  const meta = PAGE_META[route]!
  const href = route === '/' ? `${siteUrl}/` : `${siteUrl}${route}`
  const out = renderedPage
    .replace(/<title>[\s\S]*?<\/title>/, () => `<title>${escapeHtml(meta.title)}</title>`)
    .replace(/(<meta\s+name="description"\s+content=")[^"]*(")/, (_m, a: string, b: string) => `${a}${escapeHtml(meta.description)}${b}`)
    .replace(/([ \t]*)<\/head>/, (_m, i: string) => `${i}  <link rel="canonical" href="${href}">\n${i}</head>`)
  if (!out.includes(`content="${escapeHtml(meta.description)}"`)) throw new Error('fixture: no description to replace')
  return out
}

const preloads = (doc: Document) =>
  Array.from(doc.querySelectorAll('link[rel="preload"][as="font"]'), (l) => l.getAttribute('href') ?? '')

const parse = (html: string) => new DOMParser().parseFromString(html, 'text/html')
const content = (doc: Document, selector: string) =>
  (doc.querySelector(selector) as HTMLMetaElement | null)?.content ?? null

let publicDir: string

const fileOf = (route: string) =>
  route === '/' ? join(publicDir, 'index.html') : join(publicDir, route.slice(1), 'index.html')

/**
 * Lays out what Analog's prerender leaves behind: one rendered document at every route, with the
 * head `Seo` wrote for it. A route outside PAGE_META gets the generic rendered page.
 */
function stagePrerender(routes: string[], sheet: string = styleSheet) {
  const cssFile = join(publicDir, SHEET.slice(1))
  mkdirSync(dirname(cssFile), { recursive: true })
  writeFileSync(cssFile, sheet, 'utf8')
  for (const route of routes) {
    const file = fileOf(route)
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, PAGE_META[route] ? renderedFor(route) : renderedPage, 'utf8')
  }
}

/** Rewrites one staged route's file, to break the one thing a test is about. */
function tamper(route: string, edit: (html: string) => string) {
  const file = fileOf(route)
  const before = readFileSync(file, 'utf8')
  const after = edit(before)
  if (after === before) throw new Error(`fixture: the edit to ${route} changed nothing`)
  writeFileSync(file, after, 'utf8')
}

beforeEach(() => {
  publicDir = mkdtempSync(join(tmpdir(), 'tk-postbuild-'))
})
afterEach(() => {
  rmSync(publicDir, { recursive: true, force: true })
})

describe('the build script', () => {
  // The `describe.skipIf(dist exists)` this comment used to describe is gone (R80):
  // `pretest` builds, and `head-tags.spec.ts` now *fails* rather than skipping when
  // the emitted files are missing. Measured with the build taken back out of
  // `pretest` and `dist` renamed away, the suite is `13 failed | 352 passed (365)`
  // and exits 1, where the same arrangement used to skip and exit 0.
  //
  // This assertion is still worth its line, for a reason that survives R80: it reads
  // the manifest, so it holds when there is no build to read at all — a `build`
  // script reverted to a plain `vite build` is caught here even if every emitted
  // file happens to be absent.
  it('runs the postbuild step, after vite build', () => {
    const pkg = JSON.parse(read('package.json')) as { scripts: Record<string, string> }
    expect(pkg.scripts['build']).toMatch(/vite build.*tsx scripts\/postbuild\.ts/)
  })
})

/**
 * `Seo` writes the head during the render now (spec §2); this step checks it rather than rewriting
 * it. The defence is unchanged: a silent no-op is how four pages came to ship one head, so a head
 * that disagrees with PAGE_META fails the build instead of shipping.
 */
describe('checkPageHeads', () => {
  it('passes a tree whose every route carries its own head, and reports what it checked', () => {
    stagePrerender(Object.keys(PAGE_META))
    const checked = checkPageHeads(publicDir, SITE_URL)
    expect(checked).toHaveLength(Object.keys(PAGE_META).length)
  })

  it('rewrites no head tag, so what it passed is what the render wrote', () => {
    stagePrerender(Object.keys(PAGE_META))
    const before = parse(readFileSync(fileOf('/buyers'), 'utf8'))
    checkPageHeads(publicDir, SITE_URL)
    const after = parse(readFileSync(fileOf('/buyers'), 'utf8'))
    expect(after.title).toBe(before.title)
    expect(content(after, 'meta[name="description"]')).toBe(content(before, 'meta[name="description"]'))
    expect(after.querySelector('link[rel="canonical"]')?.getAttribute('href')).toBe(`${SITE_URL}/buyers`)
  })

  it('throws on a route whose title is not its own', () => {
    stagePrerender(Object.keys(PAGE_META))
    tamper('/buyers', (h) => h.replace(/<title>[\s\S]*?<\/title>/, () => `<title>${escapeHtml(PAGE_META['/']!.title)}</title>`))
    expect(() => checkPageHeads(publicDir, SITE_URL)).toThrow(/buyers.*title/)
  })

  it('throws on a route whose description is not its own', () => {
    stagePrerender(Object.keys(PAGE_META))
    tamper('/privacy', (h) => h.replace(/(name="description"\s+content=")[^"]*/, (_m, a: string) => `${a}${escapeHtml(PAGE_META['/']!.description)}`))
    expect(() => checkPageHeads(publicDir, SITE_URL)).toThrow(/privacy.*description/)
  })

  it('throws on a route with no canonical', () => {
    stagePrerender(Object.keys(PAGE_META))
    tamper('/data', (h) => h.replace(/[ \t]*<link rel="canonical"[^>]*>\n?/, ''))
    expect(() => checkPageHeads(publicDir, SITE_URL)).toThrow(/data.*canonical/)
  })

  it('throws on a canonical that names another origin', () => {
    // The build under check and the origin it should name are separate inputs: a render that
    // read a different VITE_SITE_URL than this step did is a disagreement, not a pass.
    stagePrerender(Object.keys(PAGE_META))
    expect(() => checkPageHeads(publicDir, 'https://staging.test')).toThrow(/canonical/)
  })

  it('refuses a route it has no page for', () => {
    // Everything but /data, so the throw names the one route that is missing rather
    // than failing on the first file it opens.
    stagePrerender(Object.keys(PAGE_META).filter((r) => r !== '/data'))
    expect(() => checkPageHeads(publicDir, SITE_URL)).toThrow(/data/)
  })

  it('leaves the same output when the build is run twice over one tree', () => {
    // The preloads are the one thing it still writes; a second pass must not add a second block.
    stagePrerender(Object.keys(PAGE_META))
    checkPageHeads(publicDir, SITE_URL)
    const after = readFileSync(fileOf('/'), 'utf8')
    checkPageHeads(publicDir, SITE_URL)
    expect(readFileSync(fileOf('/'), 'utf8')).toBe(after)
    expect(preloads(parse(after))).toHaveLength(3)
  })
})

/**
 * The preloads, whose whole value is *when* the request starts, so the thing to
 * check is that the link is in the document the browser parses first.
 *
 * Measured on the real artifact over a 4 Mbps, 60ms link: the sans face was asked
 * for at 395ms and the two mono faces at 1239ms and 1250ms, because nothing knows a
 * face is wanted until the stylesheet is parsed and — with `ssr: false` — nothing is
 * painted in mono until the route chunk has booted Angular. `head-tags.spec.ts`
 * asserts the same links on the built files; these cover what a build cannot show.
 */
describe('the font preloads', () => {
  it('promises the sans on every route and the hero mono on the landing page alone', () => {
    stagePrerender(Object.keys(PAGE_META))
    checkPageHeads(publicDir, SITE_URL)

    const landing = preloads(parse(readFileSync(join(publicDir, 'index.html'), 'utf8')))
    expect(landing).toEqual([`/assets/${FACES.sans}.woff2`, `/assets/${FACES.mono400}.woff2`, `/assets/${FACES.mono600}.woff2`])

    for (const route of Object.keys(PAGE_META).filter((r) => r !== '/')) {
      const file = join(publicDir, `${route.slice(1)}/index.html`)
      expect(preloads(parse(readFileSync(file, 'utf8'))), route).toEqual([`/assets/${FACES.sans}.woff2`])
    }
  })

  it('asks for them in CORS mode, which is the only mode a font is fetched in', () => {
    // Without it the browser makes a second request rather than reusing the one it
    // was promised, so the preload costs a download instead of saving a round trip.
    stagePrerender(Object.keys(PAGE_META))
    checkPageHeads(publicDir, SITE_URL)
    const doc = parse(readFileSync(join(publicDir, 'index.html'), 'utf8'))
    for (const link of doc.querySelectorAll('link[rel="preload"][as="font"]')) {
      expect(link.getAttribute('crossorigin'), link.getAttribute('href') ?? '').not.toBeNull()
      expect(link.getAttribute('type')).toBe('font/woff2')
    }
  })

  it('refuses a build whose stylesheet has stopped loading a face it names', () => {
    // The shape this has to catch: the font import is changed, the subset is renamed,
    // and the build goes on succeeding while every page promises a file that is not
    // there. A preload for a missing file is a wasted request and a console error.
    stagePrerender(Object.keys(PAGE_META), styleSheet.replace('ibm-plex-mono-latin-600', 'something-else'))
    expect(() => checkPageHeads(publicDir, SITE_URL)).toThrow(/ibm-plex-mono-latin-600-normal/)
  })

  it('refuses a stylesheet link that points at nothing', () => {
    stagePrerender(Object.keys(PAGE_META))
    rmSync(join(publicDir, SHEET.slice(1)))
    expect(() => checkPageHeads(publicDir, SITE_URL)).toThrow(/not in the build/)
  })

  it('leaves a static index.html from public/ alone, because it is not a route', () => {
    // `public/` is copied into the output verbatim, so a hand-written page there would
    // otherwise have killed the build with a message about a list it does not belong
    // in. Analog's server context attribute is the discriminator (R400): every
    // prerendered route carries it on its mount point, and a page a person wrote has
    // no reason to.
    stagePrerender(Object.keys(PAGE_META))
    const stat = join(publicDir, 'well-known/index.html')
    mkdirSync(dirname(stat), { recursive: true })
    writeFileSync(stat, '<!doctype html><html><head><title>Static</title></head><body><p>Hi</p></body></html>', 'utf8')

    expect(() => checkPageHeads(publicDir, SITE_URL)).not.toThrow()
    expect(readFileSync(stat, 'utf8'), 'and it is not rewritten either').toContain('<title>Static</title>')
  })

  // The discriminator used to be the literal `<tk-root>`, which a rendered mount point no longer
  // contains (it carries attributes), so a stray route slipped through. And an unrendered shell
  // that happens to be named index.html is not one of Analog's routes either.
  it('tells a route by its server context, not by an empty mount point', () => {
    stagePrerender(Object.keys(PAGE_META))
    const bare = join(publicDir, 'spa/index.html')
    mkdirSync(dirname(bare), { recursive: true })
    writeFileSync(bare, emittedShell, 'utf8')
    expect(() => checkPageHeads(publicDir, SITE_URL)).not.toThrow()
  })

  it('refuses a prerendered route the map has never heard of', () => {
    // The direction the existing throw does not watch. `vite.config.ts` says what to
    // prerender and `page-meta.ts` says what to write, and a route added to the first
    // alone ships with the landing page's preview and no preloads — silently, because
    // every route in the map was found.
    stagePrerender([...Object.keys(PAGE_META), '/pricing'])
    expect(() => checkPageHeads(publicDir, SITE_URL)).toThrow(/pricing/)
  })
})

/**
 * R412. The bundle is still fetched from the parser, as early as before; it is only marked low
 * priority, so on a contended link the document's own stylesheet and fonts go first. Lighthouse's
 * simulation stops counting a Low request as render-blocking, which is where the measured FCP gain
 * comes from; hydration is not delayed by a paint.
 */
describe('lowerScriptPriority', () => {
  const low = (doc: Document) => ({
    entry: doc.querySelector('script[type="module"][src]')?.getAttribute('fetchpriority'),
    preloads: Array.from(doc.querySelectorAll('link[rel="modulepreload"]'), (l) => l.getAttribute('fetchpriority')),
  })

  it('marks the entry script and every modulepreload low on every route, and moves nothing', () => {
    stagePrerender(Object.keys(PAGE_META))
    const before = readFileSync(fileOf('/data'), 'utf8')
    expect(lowerScriptPriority(publicDir)).toHaveLength(Object.keys(PAGE_META).length)
    for (const route of Object.keys(PAGE_META)) {
      const doc = parse(readFileSync(fileOf(route), 'utf8'))
      expect(low(doc), route).toEqual({ entry: 'low', preloads: PRELOADS.map(() => 'low') })
      expect(doc.querySelector('script[type="module"][src]')?.getAttribute('src'), route).toBe(ENTRY)
      expect(Array.from(doc.querySelectorAll('link[rel="modulepreload"]'), (l) => l.getAttribute('href')), route).toEqual(PRELOADS)
    }
    // Only the attribute is added: take it back out and the file is what the render wrote.
    expect(readFileSync(fileOf('/data'), 'utf8').replace(/ fetchpriority="low"/g, '')).toBe(before)
  })

  it('reads the serialised form the render writes, crossorigin="" included', () => {
    stagePrerender(['/'])
    tamper('/', (h) => h.replace(/ crossorigin /g, ' crossorigin="" '))
    lowerScriptPriority(publicDir, ['/'])
    expect(low(parse(readFileSync(fileOf('/'), 'utf8')))).toEqual({ entry: 'low', preloads: PRELOADS.map(() => 'low') })
  })

  it('leaves the same output when run twice over one tree', () => {
    stagePrerender(Object.keys(PAGE_META))
    lowerScriptPriority(publicDir)
    const after = readFileSync(fileOf('/privacy'), 'utf8')
    lowerScriptPriority(publicDir)
    expect(readFileSync(fileOf('/privacy'), 'utf8')).toBe(after)
  })

  it('refuses a page whose entry script it cannot find, rather than silently doing nothing', () => {
    stagePrerender(Object.keys(PAGE_META))
    tamper('/buyers', (h) => h.replace(/<script type="module"[^>]*><\/script>/, ''))
    expect(() => lowerScriptPriority(publicDir)).toThrow(/buyers/)
  })

  it('refuses a page with no modulepreload, which means Vite changed what it writes', () => {
    stagePrerender(Object.keys(PAGE_META))
    tamper('/buyers', (h) => h.replace(/<link rel="modulepreload"[^>]*>/g, ''))
    expect(() => lowerScriptPriority(publicDir)).toThrow(/buyers.*modulepreload/)
  })

  it('does not touch the SPA fallback, which has nothing else to fetch first', () => {
    stagePrerender(Object.keys(PAGE_META))
    writeFileSync(join(publicDir, SHELL), emittedShell, 'utf8')
    lowerScriptPriority(publicDir)
    expect(readFileSync(join(publicDir, SHELL), 'utf8')).toBe(emittedShell)
  })
})

/**
 * The SPA fallback (R401). Under R400 the prerendered `index.html` is the landing page, so the
 * fallback has to be a different file, copied from the unrendered document Vite emitted.
 */
describe('writeShell', () => {
  let clientDir: string
  beforeEach(() => {
    clientDir = mkdtempSync(join(tmpdir(), 'tk-client-'))
  })
  afterEach(() => {
    rmSync(clientDir, { recursive: true, force: true })
  })
  const client = (html: string) => writeFileSync(join(clientDir, 'index.html'), html, 'utf8')

  it('copies the unrendered client document to shell.html and marks it noindex', () => {
    client('<html><head><title>t</title></head><body><tk-root></tk-root></body></html>')
    const out = writeShell(publicDir, clientDir)
    expect(out).toBe(join(publicDir, SHELL))
    const html = readFileSync(out, 'utf8')
    expect(html).toContain('<tk-root></tk-root>')
    expect(html).toMatch(/<meta name="robots" content="noindex">\s*<\/head>/)
  })

  it('refuses a client document that is already rendered, which would put landing markup on every app URL', () => {
    client(renderedPage)
    expect(() => writeShell(publicDir, clientDir)).toThrow(/rendered/)
  })

  it('refuses a missing client document rather than writing no shell', () => {
    expect(() => writeShell(publicDir, clientDir)).toThrow(/no shell/)
  })

  // writeShell always reads the pristine client document, so running it twice proves nothing. The
  // case that can actually go wrong is a client document that already carries a robots tag.
  it('replaces a robots tag the client document already has, rather than keeping it', () => {
    client('<html><head><meta name="robots" content="index, follow"></head><body><tk-root></tk-root></body></html>')
    const html = readFileSync(writeShell(publicDir, clientDir), 'utf8')
    expect(html.match(/name="robots"/g)).toHaveLength(1)
    expect(html).toContain('<meta name="robots" content="noindex">')
    expect(html).not.toContain('index, follow')
  })

  it('works on the document this package emits, not only on a fixture', () => {
    client(emittedShell)
    const doc = parse(readFileSync(writeShell(publicDir, clientDir), 'utf8'))
    expect(content(doc, 'meta[name="robots"]')).toBe('noindex')
    expect(doc.querySelector('tk-root')?.children.length).toBe(0)
  })
})

/**
 * The sitemap (Step 5, R408). Left to Analog's own `prerender.sitemap`, review found two
 * defects in `@analogjs/vite-plugin-nitro`'s `build-sitemap.js`: the namespace is written as
 * `https://www.sitemaps.org/…`, when the protocol's own spec is `http://`, and every
 * `<lastmod>` is the build date, on every route, on every build -- claiming every page
 * changed on every deploy. This writes it instead, from the same map and the same
 * `pageUrl` `Seo` uses for the canonical, so a `<loc>` cannot disagree with the page it
 * names.
 */
describe('writeSitemap', () => {
  it('writes one <loc> per PAGE_META route, in the same order, byte-identical to that page\'s canonical', () => {
    const xml = readFileSync(writeSitemap(publicDir, SITE_URL), 'utf8')
    const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]!)
    const want = Object.values(PAGE_META).map((meta) => pageUrl(meta.path, SITE_URL))
    expect(locs).toEqual(want)
  })

  it('uses the sitemap protocol\'s own http:// namespace, not the https:// Analog\'s generator writes', () => {
    const xml = readFileSync(writeSitemap(publicDir, SITE_URL), 'utf8')
    expect(xml).toContain('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">')
    expect(xml).not.toContain('https://www.sitemaps.org')
  })

  it('carries no lastmod, which Analog\'s generator sets to the build date on every route', () => {
    const xml = readFileSync(writeSitemap(publicDir, SITE_URL), 'utf8')
    expect(xml).not.toContain('lastmod')
  })

  it('respects the siteUrl it is given, the same as checkPageHeads', () => {
    const xml = readFileSync(writeSitemap(publicDir, 'https://staging.test'), 'utf8')
    expect(xml).toContain('<loc>https://staging.test/</loc>')
    expect(xml).not.toContain(SITE_URL)
  })

  it('writes the same bytes on a second run over one tree', () => {
    const first = readFileSync(writeSitemap(publicDir, SITE_URL), 'utf8')
    const second = readFileSync(writeSitemap(publicDir, SITE_URL), 'utf8')
    expect(second).toBe(first)
  })
})

/**
 * `llms.txt` (Step 3, R408). The spec lists it under `public/`, but every PAGE_META
 * description carries a contract-derived price (R49) -- a file committed to `public/`
 * would drift from a constant changed in `@tickover/contract` exactly the way a
 * hand-typed price would. This generates it from the same map on every build instead,
 * following the llmstxt.org shape: a title, a one-paragraph summary, then the pages.
 */
describe('writeLlmsTxt', () => {
  it('titles the file with the site name and opens the summary with PAGE_META[\'/\'].description', () => {
    const txt = readFileSync(writeLlmsTxt(publicDir, SITE_URL), 'utf8')
    expect(txt.startsWith(`# ${SITE_NAME}\n`)).toBe(true)
    expect(txt).toContain(`> ${PAGE_META['/']!.description}`)
  })

  it('lists every public route under ## Pages, each with its own PAGE_META title and URL', () => {
    const txt = readFileSync(writeLlmsTxt(publicDir, SITE_URL), 'utf8')
    expect(txt).toContain('## Pages')
    for (const meta of Object.values(PAGE_META)) {
      expect(txt, meta.path).toContain(meta.title)
      expect(txt, meta.path).toContain(pageUrl(meta.path, SITE_URL))
    }
  })

  // R416. The likeliest reader is a developer's own Claude Code, asked to find a way to earn while
  // it works: it fetches this file as text, so the file has to say how to start, not only which
  // pages exist. The public pages name the plugin but never spell the commands out.
  it('says how to install, with the exact commands, under ## Install', () => {
    const txt = readFileSync(writeLlmsTxt(publicDir, SITE_URL), 'utf8')
    const install = txt.slice(txt.indexOf('## Install'))
    expect(txt).toContain('## Install')
    expect(install).toContain(`claude plugin marketplace add ${INSTALL.marketplace}`)
    expect(install).toContain(`claude plugin install ${INSTALL.plugin}`)
    expect(install).toContain(INSTALL.setup)
  })

  // The commands are typed into postbuild because the web image's build context holds no plugin
  // manifests, so they are held here to the manifests that make them true: a renamed marketplace,
  // plugin, repository or skill turns this red instead of shipping a command that fails.
  it('names a marketplace, plugin and skill that the repo actually declares', () => {
    const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..')
    const market = JSON.parse(readFileSync(join(repo, '.claude-plugin/marketplace.json'), 'utf8'))
    const plugin = JSON.parse(readFileSync(join(repo, 'packages/plugin/.claude-plugin/plugin.json'), 'utf8'))
    expect(INSTALL.plugin).toBe(`${plugin.name}@${market.name}`)
    expect(market.plugins.map((p: { name: string }) => p.name)).toContain(plugin.name)
    expect(`https://github.com/${INSTALL.marketplace}`).toBe(plugin.repository)
    const [ns, skill] = INSTALL.setup.slice(1).split(':')
    expect(ns).toBe(plugin.name)
    expect(existsSync(join(repo, `packages/plugin/skills/${skill}/SKILL.md`)), skill).toBe(true)
  })

  it('writes the same bytes on a second run over one tree', () => {
    const first = readFileSync(writeLlmsTxt(publicDir, SITE_URL), 'utf8')
    const second = readFileSync(writeLlmsTxt(publicDir, SITE_URL), 'utf8')
    expect(second).toBe(first)
  })
})
