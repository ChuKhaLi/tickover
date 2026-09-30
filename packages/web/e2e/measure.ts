/**
 * The measure rule, in one place, because there are two sweeps.
 *
 * Design system 4 ends with one sentence: prose measure is capped at 68ch. R365 put
 * that into `tokens.spec.ts` as a source check and it went green while three
 * violations shipped, one of them on every page in the product (R369). Measure is a
 * *rendered* property -- a function of font size and container width, and source
 * knows neither -- so the claim lives here, in the only suite that lays anything out.
 *
 * Two callers and not one: `public.spec.ts` sweeps the pages a signed-out visitor
 * meets, and `screens.spec.ts` sweeps the ones behind a session. They differ in what
 * the browser is holding, not in what is being asserted, so the rule, the bound and
 * the vacuity check are all here and neither caller restates them.
 */
import type { Page } from '@playwright/test'

/**
 * 82, not 68.
 *
 * The cap is 68 of the *face's* own character and this counts against `0.5em`, which
 * is what a browser falls back to when it cannot read a glyph's advance -- the same
 * 17% gap that made `ch` the wrong unit for the replica. A tighter bound would report
 * every correctly capped paragraph in the product; this one catches the 155 and the
 * 208 that were actually there.
 */
const MEASURE_MAX_CH = 82

/**
 * Short runs are excluded. A heading fragment or a two-word cell is wide because its
 * container is, and capping those is not what section 4 asks for.
 */
const LONG_ENOUGH = 70

const PROSE = 'p,li,dd,dt'

/**
 * A row of items is not a run of prose, and the sweep learned this from a real false
 * positive: `/app/studies/<id>` reports "17 valid answers from 18 respondents" beside
 * "CSV export opens when the study settles" in a `p[tk-meta]`, which is
 * `flex flex-wrap`. Two short spans, laid out side by side, never forming a line of
 * text — but `textContent` joins them into 155 characters and the element is as wide
 * as its container by design.
 *
 * Measure is about where a line of text wraps, so the discriminator is whether the
 * element lays its children out as a line at all. A flex or grid container does not,
 * and a paragraph with a link in it still does.
 *
 * What it gives up, named rather than left to be discovered: the landing page's three
 * install steps are `li.flex`, and they are genuine prose. They are under the
 * 70-character floor today, so the sweep would have skipped them anyway -- but if one
 * grew past the measure it would go unreported rather than red. The exclusion is
 * measured to cost exactly one element across all 22 routes today (the pane's meta
 * row); this is the one place where that could change without anyone noticing.
 */
const LAID_OUT_IN_A_ROW = /^(inline-)?(flex|grid)$/

/** One line per violation, already formatted for the failure message. */
export async function proseOverMeasure(page: Page, path: string): Promise<string[]> {
  await page.evaluate(() => document.fonts.ready)
  const wide = await page.evaluate(
    ([selector, longEnough, bound, notProse]) =>
      [...document.querySelectorAll(selector as string)]
        .map((el) => {
          const text = (el.textContent ?? '').trim()
          const style = getComputedStyle(el)
          const size = parseFloat(style.fontSize)
          return {
            text,
            row: new RegExp(notProse as string).test(style.display),
            ch: Math.round(el.getBoundingClientRect().width / (size * 0.5)),
            size,
          }
        })
        .filter((r) => !r.row && r.text.length > (longEnough as number) && r.ch > (bound as number)),
    [PROSE, LONG_ENOUGH, MEASURE_MAX_CH, LAID_OUT_IN_A_ROW.source] as const,
  )
  return wide.map((w) => `${path}: ${w.ch}ch at ${w.size}px — ${w.text.slice(0, 56)}…`)
}

/**
 * How many runs of prose the sweep actually looked at on this page.
 *
 * The check above passes by finding nothing, so a page that rendered an error banner
 * -- or nothing at all -- sweeps clean. Every caller asserts this is non-zero for the
 * pages it visits, which is the difference between a sweep and a green light.
 *
 * It counts **what the sweep measures**, row containers excluded, and that agreement
 * is the point. Counting them left the two functions disagreeing about what prose is:
 * measured at full data, `/app/studies/<id>` counted 3 against 2 measured and
 * `/admin/system-studies` 4 against 3. Every screen still measures at least one
 * today, so nothing was vacuous -- but a screen whose only long prose became a flex
 * row would have satisfied "nothing is silent" with nothing swept, which is the
 * failure this counter exists to make impossible.
 */
export function longProseCount(page: Page): Promise<number> {
  return page.evaluate(
    ([selector, longEnough, notProse]) =>
      [...document.querySelectorAll(selector as string)].filter(
        (e) =>
          !new RegExp(notProse as string).test(getComputedStyle(e).display) &&
          (e.textContent ?? '').trim().length > (longEnough as number),
      ).length,
    [PROSE, LONG_ENOUGH, LAID_OUT_IN_A_ROW.source] as const,
  )
}
