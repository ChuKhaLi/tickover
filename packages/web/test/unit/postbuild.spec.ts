// The end-to-end proof that this step ran lives in `head-tags.spec.ts`, which reads
// the real build. This file covers the two things that build cannot show: what
// happens to a route with no prerendered file, and that each file gets *its own*
// metadata rather than the last one written.
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, it, expect } from 'vitest'
import { PAGE_META, SITE_URL } from '../../src/app/lib/page-meta'
import { writePageHeads } from '../../scripts/postbuild'

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
const emittedShell = shell.replace(/<link rel="stylesheet"[^>]*>/, `<link rel="stylesheet" crossorigin href="${SHEET}">`)

const preloads = (doc: Document) =>
  Array.from(doc.querySelectorAll('link[rel="preload"][as="font"]'), (l) => l.getAttribute('href') ?? '')

const parse = (html: string) => new DOMParser().parseFromString(html, 'text/html')
const content = (doc: Document, selector: string) =>
  (doc.querySelector(selector) as HTMLMetaElement | null)?.content ?? null

let publicDir: string

/** Lays out what Analog's prerender leaves behind: the same shell at every route. */
function stagePrerender(routes: string[], sheet: string = styleSheet) {
  const cssFile = join(publicDir, SHEET.slice(1))
  mkdirSync(dirname(cssFile), { recursive: true })
  writeFileSync(cssFile, sheet, 'utf8')
  for (const route of routes) {
    const file = route === '/' ? join(publicDir, 'index.html') : join(publicDir, route.slice(1), 'index.html')
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, emittedShell, 'utf8')
  }
}

beforeEach(() => {
  publicDir = mkdtempSync(join(tmpdir(), 'mw-postbuild-'))
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

describe('writePageHeads', () => {
  it('gives every prerendered route its own head, and reports what it wrote', () => {
    stagePrerender(Object.keys(PAGE_META))
    const written = writePageHeads(publicDir, 'https://staging.test')
    expect(written).toHaveLength(Object.keys(PAGE_META).length)

    for (const [route, meta] of Object.entries(PAGE_META)) {
      const file = route === '/' ? join(publicDir, 'index.html') : join(publicDir, route.slice(1), 'index.html')
      const doc = parse(readFileSync(file, 'utf8'))
      expect(doc.title, route).toBe(meta.title)
      expect(content(doc, 'meta[property="og:url"]'), route).toBe(
        route === '/' ? 'https://staging.test/' : `https://staging.test${route}`,
      )
    }
  })

  it('refuses a route it has no page for', () => {
    // Everything but /data, so the throw names the one route that is missing rather
    // than failing on the first file it opens.
    stagePrerender(Object.keys(PAGE_META).filter((r) => r !== '/data'))
    expect(() => writePageHeads(publicDir, SITE_URL)).toThrow(/data/)
  })

  it('leaves the same output when the build is run twice over one tree', () => {
    stagePrerender(Object.keys(PAGE_META))
    writePageHeads(publicDir, SITE_URL)
    const after = readFileSync(join(publicDir, 'buyers/index.html'), 'utf8')
    writePageHeads(publicDir, SITE_URL)
    expect(readFileSync(join(publicDir, 'buyers/index.html'), 'utf8')).toBe(after)
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
    writePageHeads(publicDir, SITE_URL)

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
    writePageHeads(publicDir, SITE_URL)
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
    expect(() => writePageHeads(publicDir, SITE_URL)).toThrow(/ibm-plex-mono-latin-600-normal/)
  })

  it('refuses a stylesheet link that points at nothing', () => {
    stagePrerender(Object.keys(PAGE_META))
    rmSync(join(publicDir, SHEET.slice(1)))
    expect(() => writePageHeads(publicDir, SITE_URL)).toThrow(/not in the build/)
  })

  it('leaves a static index.html from public/ alone, because it is not a route', () => {
    // `public/` is copied into the output verbatim, so a hand-written page there would
    // otherwise have killed the build with a message about a list it does not belong
    // in. The mount point is the discriminator: `ssr: false` leaves every prerendered
    // route as `<mw-root></mw-root>` and nothing else, and a page a person wrote has
    // no reason to carry it.
    stagePrerender(Object.keys(PAGE_META))
    const stat = join(publicDir, 'well-known/index.html')
    mkdirSync(dirname(stat), { recursive: true })
    writeFileSync(stat, '<!doctype html><html><head><title>Static</title></head><body><p>Hi</p></body></html>', 'utf8')

    expect(() => writePageHeads(publicDir, SITE_URL)).not.toThrow()
    expect(readFileSync(stat, 'utf8'), 'and it is not rewritten either').toContain('<title>Static</title>')
  })

  it('refuses a prerendered route the map has never heard of', () => {
    // The direction the existing throw does not watch. `vite.config.ts` says what to
    // prerender and `page-meta.ts` says what to write, and a route added to the first
    // alone ships with the landing page's preview and no preloads — silently, because
    // every route in the map was found.
    stagePrerender([...Object.keys(PAGE_META), '/pricing'])
    expect(() => writePageHeads(publicDir, SITE_URL)).toThrow(/pricing/)
  })
})
