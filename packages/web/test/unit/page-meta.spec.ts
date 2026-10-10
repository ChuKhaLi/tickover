// The document head is the link preview that spec §7 Phase 0 posts to r/ClaudeAI,
// r/cursor and X. This spec covers the map the head is written from and the URL it
// names; `src/app/lib/seo.spec.ts` covers the service that writes it (spec §2),
// `postbuild.spec.ts` the step that checks the rendered files, and
// `head-tags.spec.ts` what the build actually emitted.
//
// The `applyPageMeta` block that used to open this file went with the function: the
// postbuild step no longer rewrites heads, `Seo` writes them during the render. Its
// replace-not-append and idempotency claims now live in `seo.spec.ts` ("replaces
// rather than appends") and `postbuild.spec.ts` (preloads run twice); its escaping
// claim has no string-building writer left to hold, since `Meta` sets attributes
// through the DOM. The URL test survives below, against `pageUrl` directly.
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, it, expect } from 'vitest'
import { PRICING, RULES, quoteStudy } from '@tickover/contract'
import { PAGE_META, SITE_URL, pageMetaFor, pageUrl } from '../../src/app/lib/page-meta'
import { formatCents } from '../../src/app/lib/money'

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const read = (rel: string) => readFileSync(resolve(packageRoot, rel), 'utf8')

describe('pageUrl', () => {
  it('builds one full https URL per route, with no doubled or missing slash', () => {
    for (const route of Object.keys(PAGE_META)) {
      for (const base of ['https://tickover.dev', 'https://tickover.dev/']) {
        const value = pageUrl(route, base)
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
    // R907/R908/R911: no panel size, the unit the server charges, and no claim that every
    // answer was given inside Claude Code (the pane, the local page and VS Code answer too).
    expect(PAGE_META['/buyers'].title).toBe('Tickover for buyers — ask AI-native developers while their agent works')
    expect(PAGE_META['/buyers'].description).toBe(
      `Single-choice questions, answered by AI-native developers while their coding agent works. ${formatCents(base.priceCents)} per valid answer to each question. First study at cost.`,
    )
    expect(PAGE_META['/terms/buyers'].description).toBe(
      `What a study may ask, what it may not, and what may be done with the results. ${formatCents(base.priceCents)} per valid answer to each question, every study read by a person first.`,
    )
    expect(PAGE_META['/data'].description).toBe(
      'Weekly aggregates from unpaid profile questions, answered by developers while Claude Code works. No individual answers are published.',
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
