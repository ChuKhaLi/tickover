// The public pages ship as empty SPA shells (R42), so the document head *is* the
// link preview that spec §7 Phase 0 posts to r/ClaudeAI, r/cursor and X. This spec
// covers the pure transform the postbuild step runs over each prerendered file;
// `head-tags.spec.ts` covers what the build actually emitted.
//
// Everything here reads values back out of a parsed document rather than out of the
// source string. An assertion on the authored attribute has produced three defects
// on these pages: it reads what was typed, never what a crawler resolves.
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, it, expect } from 'vitest'
import { PRICING, RULES, quoteStudy } from '@tickover/contract'
import { PAGE_META, SITE_URL, applyPageMeta, pageMetaFor } from '../../src/app/lib/page-meta'
import { formatCents } from '../../src/app/lib/money'

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const shell = readFileSync(resolve(packageRoot, 'index.html'), 'utf8')
const read = (rel: string) => readFileSync(resolve(packageRoot, rel), 'utf8')

const parse = (html: string) => new DOMParser().parseFromString(html, 'text/html')
const content = (doc: Document, selector: string) =>
  (doc.querySelector(selector) as HTMLMetaElement | null)?.content ?? null

const SAMPLE = { title: 'A title', description: 'A description', path: '/developers' }

describe('applyPageMeta', () => {
  it('replaces the head tags instead of appending a second copy of each', () => {
    const doc = parse(applyPageMeta(shell, SAMPLE, 'https://example.test'))
    // Appending would leave two of each, and a crawler reads the first — so the
    // preview would keep showing the landing copy with the suite green.
    expect(doc.querySelectorAll('title')).toHaveLength(1)
    expect(doc.querySelectorAll('meta[name="description"]')).toHaveLength(1)
    expect(doc.querySelectorAll('meta[property="og:title"]')).toHaveLength(1)
    expect(doc.querySelectorAll('meta[property="og:description"]')).toHaveLength(1)
    expect(doc.querySelectorAll('meta[property="og:url"]')).toHaveLength(1)

    expect(doc.title).toBe(SAMPLE.title)
    expect(content(doc, 'meta[name="description"]')).toBe(SAMPLE.description)
    expect(content(doc, 'meta[property="og:title"]')).toBe(SAMPLE.title)
    expect(content(doc, 'meta[property="og:description"]')).toBe(SAMPLE.description)
    expect(content(doc, 'meta[property="og:url"]')).toBe('https://example.test/developers')
  })

  it('produces the same document when run twice', () => {
    // The build runs it once, but a rebuild over a already-rewritten tree must not
    // compound. Byte equality, not tag counts: appending inside a comment would pass
    // a count check.
    const once = applyPageMeta(shell, SAMPLE, SITE_URL)
    expect(applyPageMeta(once, SAMPLE, SITE_URL)).toBe(once)
  })

  it('leaves every tag it does not own exactly as it found it', () => {
    const before = parse(shell)
    const after = parse(applyPageMeta(shell, SAMPLE, SITE_URL))
    const same = (selector: string, attr: string) =>
      expect(after.querySelector(selector)?.getAttribute(attr), selector).toBe(
        before.querySelector(selector)?.getAttribute(attr),
      )
    same('meta[charset]', 'charset')
    same('meta[name="viewport"]', 'content')
    same('base', 'href')
    same('meta[property="og:type"]', 'content')
    same('meta[name="twitter:card"]', 'content')
    same('link[rel="stylesheet"]', 'href')
    same('script[type="module"]', 'src')
    expect(after.querySelector('mw-root'), 'the SPA mount point').not.toBeNull()
  })

  it('escapes, so a crawler reads back the string that was written', () => {
    const tricky = { title: 'A "quoted" & <angled> title', description: '5 > 4 & "so on"', path: '/' }
    const doc = parse(applyPageMeta(shell, tricky, SITE_URL))
    expect(doc.title).toBe(tricky.title)
    expect(content(doc, 'meta[property="og:title"]')).toBe(tricky.title)
    expect(content(doc, 'meta[name="description"]')).toBe(tricky.description)
    expect(content(doc, 'meta[property="og:description"]')).toBe(tricky.description)
  })

  it('fails loudly rather than silently skipping a tag that is not there', () => {
    // A no-op on a missing tag is how four pages came to share one head in the
    // first place: nothing failed, the wrong preview just shipped.
    for (const [name, pattern] of [
      ['title', /<title>[^<]*<\/title>/],
      ['og:url', /<meta property="og:url"[^>]*>/],
      ['description', /<meta\s+name="description"[\s\S]*?\/>/],
    ] as Array<[string, RegExp]>) {
      const stripped = shell.replace(pattern, '')
      expect(stripped, `the ${name} probe did not remove anything`).not.toBe(shell)
      expect(() => applyPageMeta(stripped, SAMPLE, SITE_URL), name).toThrow(new RegExp(name))
    }
  })

  it('builds one full https URL per route, with no doubled or missing slash', () => {
    for (const [route, meta] of Object.entries(PAGE_META)) {
      for (const base of ['https://tickover.dev', 'https://tickover.dev/']) {
        const value = content(parse(applyPageMeta(shell, meta, base)), 'meta[property="og:url"]')!
        expect(value, `${route} from ${base}`).toBe(
          route === '/' ? 'https://tickover.dev/' : `https://tickover.dev${route}`,
        )
        // `/^https:/` alone accepted https://example.invalid//developers.
        const url = new URL(value)
        expect(url.origin).toBe('https://tickover.dev')
        expect(url.pathname).toBe(route)
      }
    }
  })
})

describe('PAGE_META', () => {
  it('covers exactly the routes the build prerenders', () => {
    // A page added to one and not the other is the same defect in a new place: a
    // prerendered route with the landing head, or a postbuild step that throws.
    const config = read('vite.config.ts')
    const list = config.match(/prerender:\s*\{\s*routes:\s*\[([^\]]*)\]/)
    expect(list, 'vite.config.ts no longer declares prerender routes the way this test reads them').not.toBeNull()
    const routes = list![1]!
      .split(',')
      .map((s) => s.trim().replace(/^['"]|['"]$/g, ''))
      .filter(Boolean)
    // The guard against a regex that matched nothing. Four public pages plus the
    // three spec §7 legal ones.
    expect(routes.length).toBe(7)
    expect(Object.keys(PAGE_META).sort()).toEqual([...routes].sort())
  })

  it('keys every entry by its own path', () => {
    for (const [route, meta] of Object.entries(PAGE_META)) expect(meta.path).toBe(route)
  })

  it('gives each route a title and a description no other route has', () => {
    // The defect being fixed is four pages sharing one head. Presence passes on it;
    // difference does not.
    const all = Object.values(PAGE_META)
    expect(new Set(all.map((m) => m.title)).size, 'two routes share a title').toBe(all.length)
    expect(new Set(all.map((m) => m.description)).size, 'two routes share a description').toBe(all.length)
  })

  it('takes every price from the contract, not from a typed-in figure', () => {
    // R49: a meta description is read by more people than the page it describes, so
    // a price in one is a money claim like any other. Mutating PRICING with no web
    // file touched has to turn this red.
    const base = quoteStudy({ targeted: false, atCost: false })
    expect(PAGE_META['/'].description).toBe(
      `One paid, single-choice question in the idle window of your AI coding tool. ${formatCents(PRICING.BASE_CENTS)} per response to the buyer; the developer keeps ${PRICING.DEVELOPER_SHARE * 100}%.`,
    )
    expect(PAGE_META['/developers'].title).toBe(
      `Tickover for developers — ${formatCents(base.developerCents)} a question, not $0.002 an ad`,
    )
    expect(PAGE_META['/developers'].description).toBe(
      `Install one open-source plugin. Answer with one key. ${formatCents(base.developerCents)} to you per response, up to ${RULES.MAX_PAID_PER_DAY} paid answers a day.`,
    )
    expect(PAGE_META['/buyers'].description).toBe(
      `Ask 300 AI-native developers one question. ${formatCents(base.priceCents)} per valid response, and every respondent answered inside Claude Code. First study at cost.`,
    )
    expect(PAGE_META['/data'].description).toBe(
      'Weekly aggregates from unpaid profile questions answered inside Claude Code. No individual answers are published.',
    )
  })

  // 'quotes each preview headline from the page it previews' used to live here and
  // now lives in `src/app/pages/landing.spec.ts`. It read the page's *source* for the
  // headline, which worked for as long as every headline was a literal: when
  // `/developers` started deriving its price from `quoteStudy` the string stopped
  // existing in the file while the page went on saying it, and the guard went red on
  // a page that had not drifted. A preview quotes what a reader sees, so it is
  // checked against the rendered page — the same correction R369 made to the measure
  // guard, arriving from the other direction.
})

describe('pageMetaFor', () => {
  it('resolves a route with or without its trailing slash', () => {
    // Analog emits `developers/index.html`, so both URLs serve the same page and the
    // browser tab has to be right either way.
    expect(pageMetaFor('/developers')).toBe(PAGE_META['/developers'])
    expect(pageMetaFor('/developers/')).toBe(PAGE_META['/developers'])
    expect(pageMetaFor('/')).toBe(PAGE_META['/'])
  })

  it('returns nothing for a route it does not describe', () => {
    // /app/** and the not-found page must not inherit the landing headline.
    for (const route of ['/app/login', '/nope', '/developers/extra']) {
      expect(pageMetaFor(route), route).toBeUndefined()
    }
  })
})

describe('SITE_URL', () => {
  it('is the production origin, with no trailing slash to double up', () => {
    expect(SITE_URL).toBe('https://tickover.dev')
  })
})
