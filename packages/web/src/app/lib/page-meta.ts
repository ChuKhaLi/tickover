import { PRICING, RULES, SITE, quoteStudy } from '@tickover/contract'
import { formatCents } from './money'

// One map, one writer: `Seo` (through `page-title.ts`) writes these into the head
// during the build-time render a crawler reads and again on every client
// navigation, and `scripts/postbuild.ts` checks the rendered files against it.
// Prose in this file is scanned by Tailwind and mints utilities, so it avoids words
// that are class names (R47).

/** Also the tab title for any route this map does not describe. */
export const SITE_NAME = 'Tickover'

const DEFAULT_SITE_URL: string = SITE.ORIGIN

/**
 * `VITE_SITE_URL` here is a **build-time** environment variable read out of
 * `process.env` — `VITE_SITE_URL=https://x pnpm build` works. It is not a Vite `.env`
 * value, so an `import.meta.env` branch here would never be reached.
 *
 * `SITE_URL` has two readers, and they do not see the same thing. `Seo` writes the
 * canonical, `og:url` and `og:image` from it:
 * - during the build-time render, in Node, where `process` exists, so it honours
 *   `VITE_SITE_URL`;
 * - in the browser, where there is no `process`, so it is always `SITE.ORIGIN`.
 * A build with a non-default `VITE_SITE_URL` therefore ships the right canonical in
 * its files and has it rewritten to `SITE.ORIGIN` on the first client navigation.
 * That is harmless in production only because `deploy/build-images.sh` derives
 * `VITE_SITE_URL` from that same origin. `scripts/postbuild.ts` reads it too, to
 * check what the render wrote.
 *
 * The cast goes through `unknown` so this file needs no `@types/node`, which the app
 * project does not load.
 */
function envValue(key: string): string | undefined {
  const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env
  return env?.[key]
}

/** No trailing slash: `og:url` is joined onto this, and `//developers` is a different URL. */
export const SITE_URL: string = (envValue('VITE_SITE_URL') || DEFAULT_SITE_URL).replace(/\/+$/, '')

export interface PageMeta {
  title: string
  description: string
  path: string
}

// Every figure below comes from the contract, never typed in (R49). A meta
// description *is* the Reddit and X preview spec §7 Phase 0 posts, so it is read by
// more people than the page it describes, and a price in one is a money claim like
// any other on these pages.
const base = quoteStudy({ targeted: false, atCost: false })

/**
 * Keyed by route path, and the keys are exactly `vite.config.ts`'s prerender list.
 * Every headline after the dash is quoted from the page it previews; spec §7 makes
 * both exact, so a reword on one side is a product change that has to reach the
 * other.
 *
 * `index.html` carries the `/` entry as its authored head — every render starts
 * from that file before `Seo` writes the route's own, and the SPA fallback is that
 * file unrendered, so it is still coherent before any code runs. The two must not
 * drift; `test/unit/head-tags.spec.ts` holds them together.
 */
export const PAGE_META: Record<string, PageMeta> = {
  '/': {
    path: '/',
    title: `${SITE_NAME} — Earn while Claude thinks`,
    description: `One paid, single-choice question in the idle window of your AI coding tool. ${formatCents(PRICING.BASE_CENTS)} per response to the buyer; the developer keeps ${PRICING.DEVELOPER_SHARE * 100}%.`,
  },
  '/developers': {
    path: '/developers',
    // Spec §7's launch angle, and the single highest-leverage string here: this is
    // what the r/ClaudeAI, r/cursor and X posts render, and the Phase 0 gate is
    // 200 developers on the waitlist. It is quoted from `developers.page.ts`, which
    // carries the line as a subhead — the page argues it, so the preview may claim
    // it. The comparison figure is an advertising CPM, not a Tickover price, so it
    // has nothing in the contract to come from.
    title: `${SITE_NAME} for developers — ${formatCents(base.developerCents)} a question, not $0.002 an ad`,
    description: `Install one open-source plugin. Answer with one key. ${formatCents(base.developerCents)} to you per response, up to ${RULES.MAX_PAID_PER_DAY} paid answers a day.`,
  },
  '/buyers': {
    path: '/buyers',
    title: `${SITE_NAME} for buyers — ask 300 AI-native developers one question`,
    description: `Ask 300 AI-native developers one question. ${formatCents(base.priceCents)} per valid response, and every respondent answered inside Claude Code. First study at cost.`,
  },
  '/data': {
    path: '/data',
    title: `${SITE_NAME} — what AI-native developers say`,
    description:
      'Weekly aggregates from unpaid profile questions answered inside Claude Code. No individual answers are published.',
  },
  // Spec §7's legal minimum. These three are prerendered for the same reason the
  // four above are: with `ssr: false` the head is all a crawler can read of a page,
  // and a privacy page that previews as the landing page reads as a page that is
  // not really there. The descriptions say what each one settles, because that is
  // what someone following a link from the consent screen is looking for.
  '/privacy': {
    path: '/privacy',
    title: `${SITE_NAME} — privacy`,
    description:
      'What the plugin sends, what is derived from it, what a buyer receives, and what closing your account does and does not remove.',
  },
  '/terms/developers': {
    path: '/terms/developers',
    title: `${SITE_NAME} — developer terms`,
    description: `Independent-contractor terms for answering paid questions: ${formatCents(base.developerCents)} per valid answer, up to ${RULES.MAX_PAID_PER_DAY} a day, PayPal from ${formatCents(RULES.PAYOUT_MIN_CENTS)}, no obligation to answer anything.`,
  },
  '/terms/buyers': {
    path: '/terms/buyers',
    title: `${SITE_NAME} — buyer terms`,
    description: `What a study may ask, what it may not, and what may be done with the results. ${formatCents(base.priceCents)} per valid response, every study read by a person first.`,
  },
}

/** The entry for a router URL, ignoring any query or fragment. `undefined` off the map. */
export function pageMetaFor(path: string): PageMeta | undefined {
  const withoutSuffix = path.split(/[?#]/)[0] ?? '/'
  // Analog emits `developers/index.html`, so `/developers` and `/developers/` are
  // the same page and both have to resolve.
  const route = withoutSuffix.length > 1 ? withoutSuffix.replace(/\/+$/, '') : '/'
  return Object.hasOwn(PAGE_META, route) ? PAGE_META[route] : undefined
}

/** The full URL of a route, origin included, with no doubled slash: `/` keeps its own, every other path has none. */
export function pageUrl(path: string, siteUrl: string): string {
  const origin = siteUrl.replace(/\/+$/, '')
  return path === '/' ? `${origin}/` : `${origin}${path}`
}

