// R42: with `ssr: false` every prerendered route ships `<mw-root></mw-root>` and
// no markup, so the document head is the only part of these pages a link preview
// can read — and spec §7 Phase 0 posts them to r/ClaudeAI, r/cursor and X. Nothing
// else in the suite touches `index.html`; deleting every og tag was invisible.
//
// This file watches the *emitted* files, because that is the channel the bug
// travelled on: `index.html` was correct and all four outputs were md5-identical
// copies of it. Values are read back off a parsed document, never off the source
// string, so what is asserted is what a crawler resolves.
import { existsSync, readFileSync, statSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, it, expect } from 'vitest'
import { PAGE_META, SITE_URL } from '../../src/app/lib/page-meta'

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const source = readFileSync(resolve(packageRoot, 'index.html'), 'utf8')

const parse = (html: string) => new DOMParser().parseFromString(html, 'text/html')
const content = (doc: Document, selector: string) =>
  (doc.querySelector(selector) as HTMLMetaElement | null)?.content ?? null

/** Route path → the file Analog's prerender emits for it. */
const fileFor = (route: string) =>
  resolve(packageRoot, 'dist/analog/public', route === '/' ? 'index.html' : `${route.slice(1)}/index.html`)

const routes = Object.keys(PAGE_META)
const emitted = routes.map(fileFor)

describe('index.html', () => {
  // It is still the shared shell every prerendered file starts from, so the tags the
  // postbuild step rewrites all have to exist here for it to find them.
  const doc = parse(source)

  it('carries the whole tag set the postbuild step rewrites, plus the ones it does not', () => {
    expect(doc.title).toBeTruthy()
    for (const key of ['og:title', 'og:description', 'og:type', 'og:url']) {
      expect(content(doc, `meta[property="${key}"]`), `missing og tag ${key}`).toBeTruthy()
    }
    expect(content(doc, 'meta[name="description"]')).toBeTruthy()
    expect(content(doc, 'meta[name="twitter:card"]')).toBeTruthy()
  })

  it('defaults to the landing route, so an un-rewritten file is still coherent', () => {
    // Presence alone let the description read "Get paid $5.00 per question" while the
    // suite stayed green, so this is an equality against the map, not a regex.
    const landing = PAGE_META['/']
    expect(doc.title).toBe(landing.title)
    expect(content(doc, 'meta[property="og:title"]')).toBe(landing.title)
    expect(content(doc, 'meta[name="description"]')).toBe(landing.description)
    expect(content(doc, 'meta[property="og:description"]')).toBe(landing.description)
    expect(content(doc, 'meta[property="og:url"]')).toBe(`${SITE_URL}/`)
  })
})

// `pretest` builds (R80), so these read the artifact this tree produces rather than
// whatever `dist/` happened to hold — CLAUDE.md's second trap. These seven assertions
// sat behind `describe.skipIf(...)` on the same existence check the staleness guard
// below makes: measured with `dist` renamed away, the suite reported `352 passed | 13
// skipped (365)` and exited 0, the same total as a run that measured the artifact. A
// missing build now fails here, naming the command, instead of disappearing.
const inputs = ['index.html', 'vite.config.ts', 'src/app/lib/page-meta.ts', 'scripts/postbuild.ts']
  .map((rel) => resolve(packageRoot, rel))
  .filter(existsSync)
const newestInput = Math.max(...inputs.map((f) => statSync(f).mtimeMs))

const BUILD = 'run `pnpm --filter @tickover/web build` (`pretest` does this; a bare `vitest run` does not)'

function readBuilt(file: string): string {
  expect(existsSync(file), `${file} was not built — ${BUILD}`).toBe(true)
  return readFileSync(file, 'utf8')
}

describe('the built artifact', () => {
  it('is newer than the sources it was built from', () => {
    for (const file of emitted) {
      expect(existsSync(file), `${file} was not built — ${BUILD}`).toBe(true)
      expect(
        statSync(file).mtimeMs,
        `${file} is older than a source it is built from — run \`pnpm --filter @tickover/web build\``,
      ).toBeGreaterThanOrEqual(newestInput)
    }
  })

  it.each(routes)('gives %s its own title, description and og:url', (route) => {
    const meta = PAGE_META[route]
    const doc = parse(readBuilt(fileFor(route)))
    expect(doc.title).toBe(meta.title)
    expect(content(doc, 'meta[property="og:title"]')).toBe(meta.title)
    expect(content(doc, 'meta[name="description"]')).toBe(meta.description)
    expect(content(doc, 'meta[property="og:description"]')).toBe(meta.description)
    expect(content(doc, 'meta[property="og:url"]')).toBe(
      route === '/' ? `${SITE_URL}/` : `${SITE_URL}${route}`,
    )
  })

  // The defect: four files that each *had* a head, and it was the same head. A test
  // asking whether each file has a title passes on that build. These ask whether the
  // four differ from one another.
  it('ships four different previews, not four copies of the landing one', () => {
    const docs = emitted.map((f) => parse(readBuilt(f)))
    for (const [label, values] of [
      ['title', docs.map((d) => d.title)],
      ['description', docs.map((d) => content(d, 'meta[name="description"]'))],
      ['og:title', docs.map((d) => content(d, 'meta[property="og:title"]'))],
      ['og:description', docs.map((d) => content(d, 'meta[property="og:description"]'))],
      ['og:url', docs.map((d) => content(d, 'meta[property="og:url"]'))],
    ] as Array<[string, Array<string | null>]>) {
      expect(new Set(values).size, `${label} is shared between routes: ${JSON.stringify(values)}`).toBe(
        emitted.length,
      )
    }
  })

  /**
   * The preloads, on the files that ship them, with the hashes the build chose.
   *
   * `postbuild.spec.ts` drives the step over a staged tree and can therefore name the
   * file it expects; this cannot, because Vite hashes every asset. So it asserts the
   * two halves a staged tree cannot: that the promised file is really in the build,
   * and that the stylesheet really asks for it. A preload for a file nothing loads is
   * a wasted download and a console warning on every visit.
   */
  it('preloads the faces it paints with, at the names the build gave them', () => {
    const preloads = (doc: Document) =>
      Array.from(doc.querySelectorAll('link[rel="preload"][as="font"]'), (l) => l.getAttribute('href') ?? '')
    const publicDir = resolve(packageRoot, 'dist/analog/public')
    const landing = parse(readBuilt(fileFor('/')))
    const sheetHref = landing.querySelector('link[rel="stylesheet"]')?.getAttribute('href') ?? ''
    const sheet = readBuilt(resolve(publicDir, sheetHref.slice(1)))

    // Matched rather than stripped: a Vite hash is base64url and may itself contain a
    // dash (`DDuiU_S-` is one of them in this build), so there is no suffix to cut off.
    const named = (name: string) => new RegExp(`^/assets/${name}-[A-Za-z0-9_-]+\\.woff2$`)
    const SANS = 'ibm-plex-sans-latin-wght-normal'
    const hero = preloads(landing)
    expect(hero, 'the landing hero is drawn in mono, at two weights').toHaveLength(3)
    ;[SANS, 'ibm-plex-mono-latin-400-normal', 'ibm-plex-mono-latin-600-normal'].forEach((name, i) => {
      expect(hero[i], name).toMatch(named(name))
    })
    for (const href of hero) {
      expect(existsSync(resolve(publicDir, href.slice(1))), `${href} is promised and not built`).toBe(true)
      expect(sheet.includes(`url(${href})`), `${href} is promised and the stylesheet never asks for it`).toBe(true)
    }

    // Everywhere else, the sans alone: a preload is a promise the page needs the file
    // at once, and only the landing page paints a terminal above the fold.
    for (const route of routes.filter((r) => r !== '/')) {
      const only = preloads(parse(readBuilt(fileFor(route))))
      expect(only, route).toHaveLength(1)
      expect(only[0], route).toMatch(named(SANS))
    }
  })

  it('changes nothing else about the four files', () => {
    // Everything outside the five tags above is the same shell, including the asset
    // URLs — a postbuild step that rewrote the script tag would break the page while
    // the preview assertions above stayed green.
    const docs = emitted.map((f) => parse(readBuilt(f)))
    const shared = (label: string, pick: (d: Document) => string | null | undefined) =>
      expect(new Set(docs.map(pick)).size, label).toBe(1)
    shared('charset', (d) => d.querySelector('meta[charset]')?.getAttribute('charset'))
    shared('viewport', (d) => content(d, 'meta[name="viewport"]'))
    shared('base href', (d) => d.querySelector('base')?.getAttribute('href'))
    shared('og:type', (d) => content(d, 'meta[property="og:type"]'))
    shared('twitter:card', (d) => content(d, 'meta[name="twitter:card"]'))
    shared('stylesheet', (d) => d.querySelector('link[rel="stylesheet"]')?.getAttribute('href'))
    shared('module script', (d) => d.querySelector('script[type="module"]')?.getAttribute('src'))
    for (const doc of docs) expect(doc.querySelector('mw-root'), 'the SPA mount point').not.toBeNull()
  })
})
