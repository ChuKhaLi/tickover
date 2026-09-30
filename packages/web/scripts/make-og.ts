/**
 * Renders `public/og.png` (1200x630) and `public/logo-512.png` (512x512) with Playwright
 * Chromium, the same tool `scripts/make-favicon.ts` uses to rasterise the mark.
 *
 *     pnpm --filter @tickover/web og
 *
 * The status-line replica is composed by `formatStatusLine`, the same function `tk-pane`
 * calls and the daemon calls -- not a hand-written string that looks like one. `tk-pane`'s
 * own comment says why a second composer would drift, and it would drift in the direction
 * that matters most here: a link preview showing a line the client would never print is a
 * product claim that is false, on the one image every Reddit and X post renders as a card.
 * `HERO_STUDY` and the contract functions are plain data and pure functions -- importing
 * `tk-pane` itself would pull an Angular component into this Node script, which is what
 * `hero-study.ts`'s own comment says fails at run time.
 *
 * Fonts are inlined as base64 `data:` URIs read straight out of `node_modules`, the same
 * files `styles.css` imports, so the rendered PNG uses the faces the page ships rather than
 * a system fallback that happens to render close enough.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from '@playwright/test'
import { STATUS_LINE_SAFETY_MARGIN, formatStatusLine, quoteStudy, resolveColumns } from '@tickover/contract'
import { HERO_STUDY } from '../src/app/lib/hero-study'

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

const fontBase64 = (pkg: string, file: string) =>
  readFileSync(resolve(packageRoot, `node_modules/${pkg}/files/${file}.woff2`)).toString('base64')

const SANS = fontBase64('@fontsource-variable/ibm-plex-sans', 'ibm-plex-sans-latin-wght-normal')
const MONO_400 = fontBase64('@fontsource/ibm-plex-mono', 'ibm-plex-mono-latin-400-normal')
const MONO_600 = fontBase64('@fontsource/ibm-plex-mono', 'ibm-plex-mono-latin-600-normal')

const logoSvg = readFileSync(resolve(packageRoot, 'public/logo.svg'), 'utf8')

// The same replica `tk-pane` draws, so the card never claims a line the client would not
// print. `price_cents` comes from `quoteStudy` (R49: a money claim comes from the contract,
// never a hand-typed literal) rather than a bare number: this is one specific, plausible
// sample question, an untargeted at-market study, so its per-response payout is exactly what
// `PAGE_META`'s own descriptions quote everywhere else on the site -- a hand-typed `50` would
// silently stop matching the moment `PRICING.DEVELOPER_SHARE` or `BASE_CENTS` changed, on the
// one image every Reddit and X post renders as a card.
//
// PANE_COLS is not 80 (a real terminal default) here: it is chosen, below, to be exactly
// what the box on this 1200px-wide card can hold at PANE_FONT_PX, the same way `tk-pane`
// derives its own width from the budget rather than the other way round -- fixing a
// defect a controller found by looking at the rendered PNG: at 80 columns and 23px, the
// composed line ("…3 Warp") ran past the box's own right edge, because the box's CSS
// width was independent of the text it held. There are now zero independent numbers to
// drift apart: the box's width is computed *from* PANE_COLS below, not chosen to match it
// by eye.
const HERO_PRICE_CENTS = quoteStudy({ targeted: false, atCost: false }).developerCents
const PANE_FONT_PX = 19
const PANE_PAD_PX = 22
const PANE_BORDER_PX = 1
/** `1200 - 2*88` (the card width less `body`'s own left/right padding, below). */
const CONTENT_WIDTH_PX = 1024
/** One character, in `em`, of the mono face -- `tk-pane`'s own `ADVANCE_EM` (`pane.ts`),
 * measured there against the built page and re-stated here rather than imported: `pane.ts`
 * does not export it, and importing an `@Component`-decorated file into this plain Node
 * script is the failure `hero-study.ts`'s own comment already ruled out for a different
 * import. */
const ADVANCE_EM = 0.6

/** Reserved so the box has visible margin inside the card rather than hugging its edge --
 * about the width of the `h1`'s own left inset above it, not chosen to hit a round column
 * count. */
const CARD_MARGIN_PX = 80

/**
 * The widest column count whose box -- interior text plus the pane's own padding and
 * border -- still fits inside the card with `CARD_MARGIN_PX` to spare. Solved for columns
 * rather than picked by eye, so a change to the font size or the padding above recomputes
 * this rather than silently drifting out of sync with it again -- which is the defect
 * being fixed here.
 */
const PANE_COLS = Math.floor(
  (CONTENT_WIDTH_PX - CARD_MARGIN_PX - 2 * PANE_PAD_PX - 2 * PANE_BORDER_PX) / (ADVANCE_EM * PANE_FONT_PX),
)

const budget = resolveColumns({ detected: PANE_COLS })
/** The terminal itself, in characters -- `tk-pane`'s own `resolved` (`budget + margin`),
 * which is what the box is sized to, not `budget`: the composed line is `resolved -
 * margin` characters at most, so sizing the box to `resolved` reproduces the same spare
 * margin a real terminal leaves (see `statusline.ts`'s comment on `STATUS_LINE_SAFETY_MARGIN`). */
const resolved = budget + STATUS_LINE_SAFETY_MARGIN
const rowWidthEm = Number((resolved * ADVANCE_EM).toFixed(3))
const line = formatStatusLine({
  loggedIn: true,
  question: {
    assignment_id: '00000000-0000-4000-8000-000000000000',
    kind: 'choice',
    text: HERO_STUDY.question,
    options: [...HERO_STUDY.options],
    context: null,
    sponsor: HERO_STUDY.sponsor,
    price_cents: HERO_PRICE_CENTS,
    served_at: '2026-01-01T00:00:00.000Z',
    expires_at: '2026-01-01T00:05:00.000Z',
  },
  answered: null,
  todayPaid: 3,
  pendingCents: 250,
  availableCents: 1000,
  maxColumns: budget,
})

const SEP = ' · ' // U+00B7 MIDDLE DOT, the mark spec 5.4 gives this line and no other.
const MONEY_RE = /^\+?\$\d+\.\d\d$/

function escapeHtml(v: string): string {
  return v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/**
 * Coloured the way `tk-pane` colours it: split on the separator, the sponsor by position
 * (the second field, when there is a question), a payout by its own shape. `pane.spec.ts`
 * is what proves the pane's own version rejoins to the composer's output; this is a
 * one-off render, not a component, so it is not asserted the same way -- `og.png`'s own
 * dimensions and size are what `public-files.spec.ts` checks.
 */
function paint(composed: string): string {
  const fields = composed.split(SEP)
  return fields
    .map((text, i) => {
      const cls = i === 1 ? 'sponsor' : MONEY_RE.test(text) ? 'money' : 'plain'
      const span = `<span class="${cls}">${escapeHtml(text)}</span>`
      return i === 0 ? span : `<span class="sep">${SEP}</span>${span}`
    })
    .join('')
}

const html = `<!doctype html>
<html><head><meta charset="utf-8"><style>
  @font-face { font-family: 'IBM Plex Sans'; src: url(data:font/woff2;base64,${SANS}) format('woff2'); font-weight: 100 700; }
  @font-face { font-family: 'IBM Plex Mono'; src: url(data:font/woff2;base64,${MONO_400}) format('woff2'); font-weight: 400; }
  @font-face { font-family: 'IBM Plex Mono'; src: url(data:font/woff2;base64,${MONO_600}) format('woff2'); font-weight: 600; }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body { width: 1200px; height: 630px; }
  body {
    background: #070A0A;
    color: #F9FAFA;
    font-family: 'IBM Plex Sans', sans-serif;
    display: flex;
    flex-direction: column;
    justify-content: center;
    padding: 0 88px;
  }
  .mark { display: flex; align-items: center; gap: 14px; margin-bottom: 44px; }
  .mark svg { width: 44px; height: 44px; flex: none; }
  .mark span { font-size: 26px; font-weight: 600; letter-spacing: -0.01em; color: #CFD6D5; }
  h1 { font-size: 58px; font-weight: 600; line-height: 1.12; letter-spacing: -0.02em; max-width: 920px; margin-bottom: 52px; }
  /* align-self overrides body's flex-stretch (the column flex container's own default),
     so the pane sizes to its content -- the same "w-fit" tk-pane itself uses -- rather
     than stretching to the card's full width, which is what silently let the row's own
     width disagree with the box in the first place. */
  .pane { display: inline-block; align-self: flex-start; background: #070A0A; border: ${PANE_BORDER_PX}px solid #22837E; border-radius: 8px; padding: 18px ${PANE_PAD_PX}px; }
  .row { font-family: 'IBM Plex Mono', monospace; font-size: ${PANE_FONT_PX}px; white-space: pre; color: #F2F5F4; }
  .sep { color: #9BA3A1; }
  .sponsor { color: #B9F2EE; }
  .money { color: #FFFFFF; font-weight: 600; }
</style></head>
<body>
  <div class="mark">${logoSvg.replace('width="64" height="64"', 'width="44" height="44"')}<span>Tickover</span></div>
  <h1>This line is the product.</h1>
  <div class="pane"><div class="row" style="width:${rowWidthEm}em">${paint(line)}</div></div>
</body></html>`

const logoOnly = `<!doctype html>
<html><head><style>
  * { margin: 0; padding: 0; }
  html, body { width: 512px; height: 512px; }
  svg { display: block; width: 512px; height: 512px; }
</style></head><body>${logoSvg}</body></html>`

const browser = await chromium.launch()
try {
  const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 })
  await page.setContent(html)
  await page.evaluate(() => document.fonts.ready)
  const ogPath = resolve(packageRoot, 'public/og.png')
  await page.screenshot({ path: ogPath })
  console.log(`public/og.png: 1200x630`)

  // The mark alone, square -- rasterised at its own size rather than resampled from the
  // tile above, the same reasoning `make-favicon.ts` gives for rendering each of its
  // three sizes directly from the vector rather than scaling one raster.
  await page.setViewportSize({ width: 512, height: 512 })
  await page.setContent(logoOnly)
  const logoPath = resolve(packageRoot, 'public/logo-512.png')
  await page.screenshot({ path: logoPath })
  console.log(`public/logo-512.png: 512x512`)
} finally {
  await browser.close()
}
