// R47 has now fired five times on this branch, each time the same way: prose in a
// file Tailwind scans mints a utility, the utility ships, and nobody notices until
// someone measures the emitted CSS by hand. The trees were excluded one at a time —
// `src` specs, `test` specs, `scripts`, then `e2e`, then this package's README,
// which alone added 1,612 bytes because it is full of `pnpm --filter`.
//
// Measuring by hand is what keeps failing. This is the same measurement, run.
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, it, expect } from 'vitest'
import { PUBLIC_DIR } from '../../scripts/postbuild'

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const assets = resolve(packageRoot, PUBLIC_DIR, 'assets')

/** The build emits exactly one stylesheet; its name carries a content hash. */
function emittedCss(): string | undefined {
  if (!existsSync(assets)) return undefined
  const found = readdirSync(assets).filter((f) => f.endsWith('.css'))
  return found.length === 1 ? resolve(assets, found[0]!) : undefined
}

const css = emittedCss()

/**
 * R80. This file used to sit behind `describe.skipIf(!css)`, and nothing in `pnpm
 * test` built the app: measured with `dist` renamed away, the suite reported
 * `352 passed | 13 skipped (365)` and exited 0 — **the same 365 total** as a run that
 * did measure the artifact, so no number in a report could tell the two apart. The
 * guard R77 installed because hand-measurement had failed five times was itself
 * optional, and its absence was indistinguishable from its success.
 *
 * `pretest` now builds. This says so out loud for any run that reaches here without
 * one, rather than passing quietly.
 */
function stylesheet(): string {
  expect(css, `no stylesheet under ${assets} — run \`pnpm --filter @tickover/web build\` (\`pretest\` does this; a bare \`vitest run\` does not)`).toBeDefined()
  return css!
}

/**
 * The measured size of a clean build. Deliberately exact.
 *
 * **When this goes red, attribute the delta before you touch the number.** Build the
 * previous commit's stylesheet, diff it against this one rule by rule, and write what
 * moved and why in the history below — every entry there does, to the byte, and that
 * history is the most useful thing in this file. Only then put the new figure here,
 * in the same commit as the change that moved it.
 *
 * The order matters, and it is the opposite of what this comment used to say. It used
 * to offer re-measuring first and attribution as an afterthought, opening with "if the
 * CSS *should* have changed — a template gained a utility". That is true of every
 * styling commit, so nobody ever reached the second half. A whole-branch review then
 * showed what it cost: a class on `<body>` in `index.html` and a stray word in
 * `src/main.ts` shipped two stock-ramp rules and a stock type step, and the only guard
 * that noticed was this one — whose own instruction then told the next person to
 * re-baseline and move on. A size cannot tell a legitimate delta from an illegitimate
 * one; it is not carrying that information.
 *
 * It is no longer the last line of defence: `tokens.spec.ts` now asserts against the
 * emitted sheet's contents, fails on *what* is in it rather than on how big it is, and
 * names the offending variable. The two split the work — this one says the size moved
 * and to account for it, that one says the size moved for a reason that is not allowed.
 */
// 25_528 -> 25_575 when the mark went into the header: `.gap-2`, `.h-[22px]` and
// `.w-[22px]`, the three utilities that markup asks for and nothing else.
//
// It was 25_597 for one build in between, and the extra 22 bytes are worth recording.
// A comment added to `index.html` described the SVG icon as replacing "a fixed pair" of
// raster sizes, and Tailwind minted `.fixed` out of that ordinary English sentence —
// R47/R64/R77 happening again, in the shell file, which cannot be excluded because it is
// the shell. The test below caught it. The prose was reworded, not excluded.
//
// Recorded because of how it was nearly missed: the first check for minted prose used
// `.fixed` as a *control* to prove the search worked, when its presence was the defect
// the search was meant to find.
const BASELINE_BYTES = 25_575

/**
 * It was 18,014 before the design token layer, and the token layer made the sheet
 * *smaller*. Measured rather than assumed, because a styling change that shrinks the
 * output looks like a mistake:
 *
 * - `body` stopped using `zinc-50 / zinc-100 / zinc-950`, and no template asks for
 *   those three steps, so they left the emitted `:root` — and each Tailwind colour
 *   costs two declarations, a hex inside an `@supports` guard and a wide-gamut
 *   `lab()` twin.
 * - The four `ink` steps that replaced them cost one declaration each, because they
 *   are stored as plain hex (`src/styles.css` records why). Half the byte cost, and
 *   the measured contrast then holds on a P3 display instead of varying with it.
 * - Overriding `--font-sans` and `--font-mono` replaced two long default stacks.
 *
 * The other 18 ramp steps and all 9 state colours cost **nothing**: Tailwind emits a
 * `@theme` value only where a utility references it. That is what makes it safe to
 * declare the whole palette up front — confirmed by grepping the emitted sheet for
 * each step, not by reading the documentation.
 *
 * Then 17,897 -> **20,740** when the self-hosted faces landed. The whole +2,843 is
 * `@font-face`: ten rules, six subsets of the variable sans plus mono at 400 and 600
 * in latin and vietnamese. Attributed rather than assumed — the emitted sheet holds
 * exactly ten `@font-face` blocks, and its distinct class selectors stayed at 118,
 * so `node_modules` minted nothing on the way in.
 *
 * 26 of those bytes are one defect's fix. The variable package declares the family
 * `IBM Plex Sans Variable`; `--font-sans` asked for `IBM Plex Sans`, matched nothing
 * shipped, and fell back to the system face — a page that looks close enough that no
 * unit test, no typecheck and no byte count would have caught it. `e2e/public.spec.ts`
 * now asserts in a browser that the faces resolved, because only a browser can tell.
 *
 * The ten woff2 files total 205,544 bytes in `dist/`, but each rule carries a
 * `unicode-range`: an English page fetches 76,040 of them (sans latin, mono latin
 * 400 and 600) and never requests the rest.
 *
 * Then 20,740 -> **25,912** for the first four primitives — `mw-button`, `mw-input`,
 * `mw-field`, `mw-banner` — and the coarse-pointer rule that raises every control to
 * the 44px floor. Attributed the same way: distinct class selectors went 118 -> 148,
 * the `@font-face` count stayed at 10 (so nothing about the faces moved), and the
 * `pointer: coarse` block is present once.
 *
 * **+5,172 for four primitives is the expensive end of this curve, not the slope.**
 * Most of it is the first use of a vocabulary the other eight share: the radius
 * scale, the focus edge, the disabled treatment, `transition-colors` and the
 * `@property` declarations Tailwind drags in with it, and each `dark:` twin. The
 * next primitive that reaches for `rounded-control` and an outline adds nothing.
 * Re-measure per primitive anyway — that expectation is exactly the kind this pin
 * exists to check rather than assume.
 *
 * Then 25,912 -> **26,068**, +156, for two tokens the error banner needed in the dark
 * theme and did not have. Found by *looking* at the workshop, which is what it is for:
 * the most urgent tone was rendering on the same neutral fill as the least urgent one,
 * because it borrowed `ink-800` while `done` and `warn` each had a tinted fill of
 * their own. Its edge reused `rejected-fg`, which measures **2.74** on the dark page —
 * under the 3.0 a meaningful boundary needs, the identical defect the amber edge had,
 * and missed here only because no pair in `tokens.spec.ts` named it. Four pairs added
 * with the fix. R324.
 *
 * Then 26,068 -> **26,118** for `mw-money` gaining a voice and `mw-study-badge`
 * gaining a dark theme (R325). Two things happened on the way worth keeping:
 *
 * `.table` appeared, R47's seventh firing, from the ordinary word for a grid of rows
 * and columns written in a doc comment in `ui/money.ts` -- shipped source, so it was
 * reworded rather than excluded. **The first rewrite minted it again**, because the
 * sentence warning about the word contained the word. Verified separately: the same
 * string as an HTML tag, `<table`, in six page templates does *not* mint it. Only
 * bare prose does.
 *
 * And the green list lost `ui/study-badge.ts`, its second entry removed by the work
 * rather than by tidying: `live` moved off `bg-green-100` onto the accent.
 *
 * Then 26,118 -> **26,224**, and this +106 is two rules exactly: 50 bytes for
 * `.border-ink-500{border-color:var(--color-ink-500)}` and 56 for its `dark:`
 * counterpart at `ink-400`. The old pair stayed, because the closed chip still uses
 * `ink-300` for an edge that genuinely is decorative. 50 + 56 = 106, so nothing else
 * in the sheet moved -- checked by extracting the two rules and measuring them, not by
 * inferring them from the total.
 *
 * What bought them: the first *systematic* pass over the pair list in
 * `tokens.spec.ts`, rather than the two reactive ones before it. It found one real
 * defect, and the shape of it is the lesson -- a wrong **bar**, not a missing row.
 * `control edge on a card` had been in the list all along, asking for 1.0, while the
 * edge on every input and every secondary button measured 1.48 light and 1.94 dark
 * against the 3.0 WCAG 1.4.11 requires of a boundary that identifies a control.
 * Adding rows, which is what both earlier rounds did, could not have found it.
 * Nineteen further roles turned out to be drawn and unnamed; none of those failed.
 * R326-R329.
 *
 * Then 26,224 -> **28,571**, +2,347, for six primitives -- `mw-card`,
 * `mw-page-header`, `mw-stat`, `mw-empty`, `mw-async`, `mw-rows`/`mw-figure` -- plus
 * the type scale as tokens, proved end to end by migrating `/dev`. Attributed by
 * diffing the two emitted sheets rule by rule, which is the only way the three
 * numbers below are knowable:
 *
 *   -   454  the `--text-*` declarations in `:root`. Sixteen, not thirty-two: the four
 *            roles nothing used *at the time* emitted nothing, which is the same
 *            property the colour ramps rely on, measured rather than assumed.
 *            (All nine roles are used now, so this is no longer where to look to see
 *            the property working. It still holds and was re-measured at 24,778:
 *            `signal-100`, `signal-900`, `signal-950` and `--radius-overlay` are
 *            declared and emit nothing, and **no emitted variable is referenced by no
 *            rule** -- the claim is stronger than this note ever put it.)
 *   - 1,821  seventeen new rules -- five type-role utilities, eight arbitrary
 *            descendant rules for the data grid, four layout utilities.
 *   -    72  two new `@media (prefers-color-scheme:dark)` wrappers, 3 blocks -> 5,
 *            opened by the grid's two dark descendant rules.
 *
 * **+2,347 for six against +5,172 for the first four**, which is the slope the earlier
 * note predicted and is worth recording as confirmed: the radius scale, the focus
 * edge, the disabled treatment and the `@property` declarations were all paid for by
 * the first batch. Nothing was removed, because 24 screens still paint with `zinc`.
 *
 * **R47 fired twice on the way, both from comments in this batch's own source, and
 * the second cost 2,089 bytes on its own.** `.rounded-md` came from a comment listing
 * the four radii `mw-card` retires; the far more expensive one came from a sentence
 * saying the card has no elevation, naming the utility for it -- which drags in its
 * `@property` block and everything that references it. Both reworded, because these
 * are shipped source. And **the first rewrite of the warning named them again**, the
 * identical mistake R325 recorded one commit earlier: a sentence cautioning about a
 * word is still a sentence containing it.
 *
 * Then 28,571 -> **28,564**. The last two primitives, `mw-chip` and `mw-identity`,
 * made the sheet **7 bytes smaller** -- the first entry in this history where a
 * primitive gave back more than it took. `.rounded-full` (41) and `.ml-2` (43) left,
 * because the four hand-drawn pills and the three identity strips were the only
 * things asking for them; `.gap-x-3` (45) and `.gap-y-1` (32) arrived. 84 out, 77 in.
 *
 * That is the shape the curve was always going to take, and it is worth having the
 * number: a primitive costs bytes while it is the only caller of its own vocabulary,
 * and starts paying them back at the point where it deletes the shapes it replaced.
 * The earlier +5,172 and +2,347 were both the first half of that.
 *
 * R47 fired a tenth time on the way, from `identity.ts` saying `failedSays` was an
 * input rather than one of the copy words that names a position utility. 22 bytes,
 * caught by this pin, reworded. Four firings in three commits, every one of them from
 * a doc comment explaining a design decision -- which is the pattern now, rather than
 * a run of bad luck.
 *
 * Then 28,564 -> **28,873**, +309, for `mw-pane`: +18 in `:root` for `--radius-pane`
 * and 291 across seven rules (`bg-ink-950`, `rounded-pane`, `text-signal-200`,
 * `text-ink-100`, `text-ink-400`, `overflow-x-auto`, `whitespace-pre`). 18 + 291 =
 * 309, so nothing else moved.
 *
 * **Paid before there is a caller**, which is worth saying rather than leaving to be
 * noticed: Tailwind scans `ui/pane.ts` whether or not a screen imports the component,
 * so these bytes ship now and the landing hero the pane was built for is the next
 * commit. The set of ten primitives is otherwise "landed" in the sense
 * `docs/design/design-system.md` defines -- built, specified, and used by a screen.
 *
 * Then 28,873 -> **29,396**, +523, for the landing page: +87 in `:root` for the four
 * `--text-display` declarations, +569 across eight rules (`text-display`, the range
 * control's two accent colours, and five spacing utilities), **-133** as `.text-4xl`
 * and `.p-6` left with the two clickable cards the page no longer has.
 *
 * **R47's eleventh firing, and it sharpens the rule rather than repeating it.** A
 * comment about the hero sequence used the ordinary word that names the `visibility`
 * utility, and minted it. The same word already sat in
 * `pages/admin/system-studies.page.ts` and had never minted anything -- so the
 * difference was measured rather than guessed, by moving only that one:
 *
 *   - `...the difference visible.`      -> no rule emitted
 *   - `...the difference visible here.` -> `.visible{visibility:visible}`, +28 bytes
 *
 * A word with punctuation attached is not a candidate; the same word followed by a
 * space is. That explains why some prose here has survived and some has not, and it
 * is **not** a technique to rely on -- the safe rule is still that the word does not
 * appear. It is worth knowing when reading the exclusions: they do not catch
 * everything they look as though they should.
 *
 * Then 29,396 -> **29,471**, +75: `.w-fit` (48, it carries a `-moz-` twin) and
 * `.max-w-full` (27), so the frame is the width of the replica rather than the width
 * of the column it sits in. Looking at the built page caught it: an 80-column line
 * inside a 992px frame is not a true-to-width replica, it is a line in a dark bar,
 * and nothing in the suite was asking about the frame.
 *
 * Then 29,471 -> **29,538**, +67, for the pane's dark-theme frame. Also found by
 * looking, and the more interesting of the two: R317 decided this frame and wrote its
 * pair into `tokens.spec.ts` when the dark theme was designed -- `signal-500` on
 * `ink-900`, 3.90 -- and the component shipped without it, so on the dark page the
 * replica was `ink-950` on `ink-900` at **1.12**, less than a hairline, and the one
 * object this design is built around was not an object.
 *
 * No guard could have caught it. The pair list is a claim about roles, and
 * `signal-500` is painted elsewhere, so token coverage was satisfied; the dark
 * completeness check was satisfied because nothing in that string was half-themed
 * until the frame arrived. **A measured pair that no component draws is still an
 * unkept claim**, and the only thing that catches it is opening the page.
 *
 * Then 29,538 -> **29,166**, and the sign is the news: **-372**, the first batch of
 * the screen migration, seven files off the ledger. Attributed:
 *
 *   -  -269  five stock-ramp rules, now unreferenced: three amber and two zinc, from
 *            `mw-confirm` becoming a warn banner with two `mw-button`s.
 *   -  -144  the `@theme` colour declarations those five dragged with them. **This is
 *            the compounding half and it was not obvious**: a stock colour costs a
 *            `lab()` entry in `:root` as well as its rule, so retiring one utility
 *            takes more than the utility.
 *   -   -77  the same effect in the theme block.
 *   -  +118  `.bg-signal-600` and `.dark:bg-signal-400`, the quota bar's two fills.
 *
 * The bar needed two, and the measurement is why: a bar is meaningless unless it is
 * distinguishable from its own track, which WCAG 1.4.11 puts at 3.0, and `signal-400`
 * against the light track is **1.96**. One colour in both themes was the obvious
 * answer and it fails in one of them. The light pair is now in `tokens.spec.ts`.
 *
 * Then 29,166 -> **29,435**, +269, for batch 2: the four admin screens. The sign went
 * back up, and the reason is worth having rather than explaining away:
 *
 *   -  +219  `.text-h3`, first used here. A type role costs its four declarations the
 *            first time and nothing after.
 *   -   +81  the `@theme` entries those roles reference.
 *   -   +72  `.justify-end` and `.self-start`.
 *   -  -103  `.bg-green-600` and its `lab()` entry -- **the app's last filled green**,
 *            and the whole of what left.
 *
 * **A stock ramp's `:root` entry leaves only when its last user does**, which batch 1
 * happened to hit (nothing but `mw-confirm` used amber) and batch 2 did not: zinc and
 * red are still referenced by the ten files left on the ledger. So the saving is not
 * proportional to screens migrated, it is all at the end, and a batch in the middle
 * reads like a regression while being the opposite.
 *
 * Then 29,435 -> **29,748**, +313, and every byte of it is `mw-rows` being wrong.
 * Two defects, both found by reading the built page and neither visible to any test:
 *
 *   -  +194  two `pr-4` descendant rules. The grid had **no horizontal cell spacing
 *            at all**, so on the payouts screen a right-aligned money column ran
 *            straight into the date beside it and read as one string.
 *   -   +80  the head-alignment rule, rewritten as `[&_th:not([mw-figure])]`. It was
 *            `[&_th]:text-left`, a *descendant* selector, which outranks the plain
 *            `text-right` that `mw-figure` puts on the element -- so a figure
 *            column's header rendered over the wrong edge of its own column with both
 *            classes present and correct. `layout.spec.ts` asserted the class was
 *            there and passed; **a class-presence test cannot see specificity.**
 *   -   +39  `[&_td]:py-2` and `[&_th]:py-2` no longer merge into one rule.
 *
 * R47's fourteenth firing on the way, from the comment explaining the first of those:
 * the word for a grid of rows, again, reworded again.
 *
 * Then 29,748 -> **29,566**, -182, for batch 3: the three buyer screens. Attributed:
 *
 *   -  -145  `.hover:border-blue-500` and its two `--color-blue-500` entries. The
 *            credit pack was one large button whose edge lit on hover; it is a card
 *            holding a `Buy` button now, so the last reference to that ramp went.
 *   -   -96  `.text-amber-900`, `.dark:text-amber-100` and the two `--color-amber-100`
 *            entries, from the reviewer note becoming `mw-banner tone="warn"`.
 *   -   -46  `.px-5`, the pack button's padding, gone with the button that wore it.
 *   -  +170  `.w-12`, `.shrink-0`, `.gap-x-6` and `.lg:grid-cols-3` -- the three-up
 *            pack grid, and the share column that now has a width of its own.
 *
 * **Two stock ramps left entirely this time**, which is the effect the batch-2 note
 * predicted: blue and amber-100 each had exactly one user left, and the saving lands
 * in the batch that removes the last one rather than being spread across the ten.
 *
 * R47 fired for the fifteenth time inside this work, and the word was in the comment
 * explaining the `w-12` above -- a CSS position, written with a space after it. The
 * `.fixed` row in the list below would have caught it; the diff caught it first.
 *
 * Then 29,566 -> **29,249**, -317, for batch 4: `/buyers`, `/data` and the waitlist
 * form. The largest drop of the four, and every byte of it is a hand-rolled shape
 * being deleted rather than restyled:
 *
 *   -  -138  `.hover:bg-blue-700` and its two `--color-blue-700` entries, when the
 *            waitlist button became `mw-button`. Blue is down to `blue-600`, held up
 *            by the four screens still on the ledger.
 *   -  -110  `.bg-zinc-200` and `.dark:bg-zinc-800` -- the data page had its own copy
 *            of `mw-bar`, track and all, painted from the stock ramp and never
 *            measured against WCAG 1.4.11. It calls the primitive now.
 *   -   -63  `.rounded-2xl` and `--radius-2xl`: the radius scale grows with what an
 *            element contains (design system 5), and `rounded-card` is what a card is.
 *   -   -38  `.p-5`, the same card's padding, now `mw-card pad="lg"`.
 *   -   -33  `.sm:flex-row`, the waitlist form's one-row layout, gone with the label.
 *   -   -27  `.text-left`, and the buyers table was its **last user in the whole
 *            application**: `mw-rows` aligns heads through
 *            `[&_th:not([mw-figure])]:text-left`, which is a different selector.
 *   -   +92  `.max-w-[24ch]`, `.max-w-xl` and `--container-xl`, the measure caps on
 *            two headings and a price table.
 *
 * R47's sixteenth firing was caught here by the list below rather than by the byte
 * count, which is the first time that has happened: the word was the adjective for
 * something one can see, in a comment about giving a control a label, and `.visible`
 * has its own row because it shipped once before for the same reason.
 *
 * Then 29,249 -> **28,098**, **-1,151**, for batch 5: `/dev/settings` and
 * `/admin/invariants`. Four times the next largest batch, from two screens, and the
 * whole of it is the compounding the batch-2 note predicted arriving at once:
 *
 *   -  -676  red. `border-red-200/400`, `bg-red-600`, `text-red-800`, and four
 *            `dark:` twins, plus the `@theme` entries for red-200, -400, -800 and
 *            -900. The delete panel's frame and the invariants page's three alarm
 *            boxes were the last users of every one of those steps.
 *   -  -359  green, the same story: `border-green-400`, `text-green-700` and their
 *            dark twins were the "Saved." line and the "all invariants hold" panel,
 *            which are `mw-banner tone="done"` now. Both `@theme` entries went with
 *            them, and `GREEN_STILL_THERE` is down to the wizard.
 *   -  -163  `text-zinc-600` / `dark:text-zinc-300` and the zinc-600 entry.
 *   -   -70  `.mr-2` and `.gap-1`.
 *   -  +117  `.mr-3` and `.sm:grid-cols-[max-content_1fr]`, the data summary's two
 *            columns, which used to be a two-up grid that put a value under a label
 *            rather than beside it.
 *
 * **A stock step's `@theme` entry costs about 70 bytes and its utilities cost 50 each,
 * so a ramp leaving is worth ten times a utility leaving.** Four batches moved -182,
 * -313, +269 and -317; this one moved -1,151, and not because more was migrated.
 *
 * Then 28,098 -> **25,781**, **-2,317**, for batch 6: the two wizards, which were the
 * last two files on the colour ledger. Exact, and it adds up to the byte:
 *
 *   -  -993  **the whole `@supports (color: lab(0% 0 0))` block**, wrapper and all 20
 *            wide-gamut twins it held. This is the finding worth keeping. Tailwind
 *            emits that block to carry a `lab()` version of each of *its own*
 *            colours; this palette stores its colours as plain hex on purpose, so the
 *            block never held a single Tickover token. With the last stock colour
 *            gone it has nothing to carry and Tailwind emits none of it -- an entire
 *            browser-capability query that the token layer simply never pays for.
 *   - -1083  the 21 remaining stock-ramp utility rules.
 *   -  -500  the 20 plain-hex `--color-<ramp>-NNN` entries in `:root`.
 *   -  -123  `.rounded-lg` and `.rounded-xl` with their two `--radius-*` entries. The
 *            wizards were the last callers of both; every panel is `rounded-card`.
 *   -  +382  `.size-4`, `.gap-1`, the `space-y-4` rule and `.sm:grid-cols-[14rem_1fr]`.
 *
 * The sheet was **18,014** before any of this, and the design token layer is what put
 * it up. It carries nineteen primitives, **nine** type roles, a **22**-step ink and
 * signal palette, nine state colours and every screen migrated.
 *
 * That sentence said "25,346 now", "eleven type roles" and "a 21-step palette", and
 * all three were wrong -- stale by a batch, two too many, one too few, in the very
 * paragraph arguing the layer is cheap. Narrative numbers in a comment, so nothing
 * went red. `tokens.spec.ts` asserts the 22 steps; the roles are countable in
 * `src/styles.css`; the size is pinned above. None of the three had to be typed.
 *
 * Then 25,781 -> **25,346**, -435, for batch 7: the type roles reach every page.
 *
 *   -  -539  six stock-scale utility rules: `text-lg`, `text-xl`, `text-2xl`,
 *            `text-3xl`, `text-3xl/tight` and `tracking-tight`.
 *   -  -285  their `@theme` entries, each size dragging a `calc()` line-height with
 *            it, plus `--tracking-tight` and `--leading-tight`.
 *   -  +389  `.text-h1-public` and its four declarations, minted for the first time.
 *            The role was declared when the scale was and had never been used; it
 *            cost nothing until it did, which is the property the whole `@theme`
 *            block relies on.
 *
 * **309 of those 824 removed bytes came from rewording three comments.** The last
 * thing minting `.text-2xl` and `.text-3xl` was the prose explaining that the roles
 * replaced them: two sentences in `src/styles.css` itself and one in
 * `ui/page-header.ts`. R47's seventeenth firing, in the note that documents R47's own
 * subject matter -- and `tokens.spec.ts` now counts `src/styles.css` too, because a
 * ledger that could not see the stylesheet reported this migration finished while it
 * was not.
 *
 * Then 25,346 -> **24,778**, -568, for batch 8: the six primitives, which is the last
 * of the migration. Tailwind's own type scale is gone from the sheet entirely:
 *
 *   -  -426  five utility rules -- `.text-base`, `.text-sm`, `.text-sm/relaxed`,
 *            `.text-xs` and `.tracking-[0.004em]`.
 *   -  -193  `--text-xs`, `--text-sm` and `--text-base` with their `calc()` line
 *            heights, plus `--leading-relaxed`, which the banner's modifier was
 *            holding up on its own.
 *   -   -94  **the `--tw-tracking` custom property, and it costs in two places**: its
 *            own `@property` declaration and its entry in the initialiser block every
 *            `--tw-*` variable needs. The badge's `tracking-[0.004em]` was its last
 *            user, and a role carries tracking as part of the role, so no `--tw-*`
 *            variable is involved at all. A utility that reaches for Tailwind's
 *            variable machinery costs about 94 bytes more than one that does not.
 *   -  +145  `.text-body` and its two `@theme` declarations, minted for the first
 *            time.
 *
 * **Nothing moved.** Measured in Chromium before and after, eleven controls across
 * four screens, to the hundredth of a pixel: every button, input and chip kept its
 * height exactly, because `min-h-9` and `min-h-11` set them and the line heights
 * differ by under a pixel inside that. The badge grew 0.8px, a table row 0.8px, the
 * two-row textarea 1.6px. The one visible change is the banner, **2.45px tighter**,
 * because `text-sm/relaxed` was 1.625 and the small role is 1.45 -- which is the
 * point of a role: a line height chosen once for the role, not per component.
 *
 * Then 24,778 -> **24,717**, -61, for the review's first fix round. One rule, and
 * nothing added:
 *
 *   -   -61  `.sm:grid-cols-[14rem_1fr]`, whose only user was the kind column on
 *            `/admin/system-studies`. At 14rem the select clipped its own default
 *            option to "profile (unpaid, 1/day, publisl", losing the word that says
 *            the kind publishes to the open internet; the column is sized to its
 *            content now and `.sm:grid-cols-[max-content_1fr]` already existed.
 *
 * The other three fixes in that round cost nothing at all, which is worth one line
 * because it is the token layer's argument arriving from the other direction: the
 * credits page trading a banner for a line of `review-fg` text, `mw-confirm` gaining
 * a variant it already had a rule for, and four admin screens gaining a loading rung
 * all reused utilities the sheet was already emitting.
 *
 * Then 24,717 -> **25,272**, +555, for the terminal hero (R318). The largest single
 * addition since the faces, and two thirds of it is one texture:
 *
 *   +  399  `.mw-lattice` and its dark twin, written as plain CSS in `styles.css`
 *            rather than as a utility. 194 bytes for the pair of gradients and the
 *            9x21 cell, 205 for the same pair again under the dark media query,
 *            which is what a background-image costs to restate.
 *   +  245  five utilities the hero is the first user of: `.py-12` for the band,
 *            `.text-signal-400` for the working marker and the caret, `.mb-2` and
 *            `.border-ink-800` for the prompt box, and `.dark:border-ink-800` for
 *            the band's hairline on the dark ground.
 *   -   89  `.mt-16` and `.pt-10`, whose only user was the rule between the hero and
 *            the two paths. The band draws that boundary now, so the rule and its
 *            spacing both left.
 *
 * Nothing else moved: the terminal session is `text-ink-400`, `text-white`,
 * `rounded-control`, `px-2`, `py-1` and `mt-3`, all of which the sheet already had,
 * and `mw-shell` gaining a second slot re-used every class the old `main` carried.
 * The session is about a third of the hero's markup and cost 0 bytes, which is the
 * token layer's argument again: the sheet grows with new *ideas*, not with new HTML.
 *
 * Then 25,272 -> **25,189**, -83, for the coherence pass, and the arithmetic is the
 * tree-shaking property a third time:
 *
 *   -   84  `.max-w-2xl` and `.max-w-3xl`. Design system 4 caps prose at 68ch and
 *            the screens gave four answers to it; 49 caps are one answer now, and
 *            `.max-w-[68ch]` was already in the sheet, so unifying them cost nothing
 *            and removed two rules.
 *   -   44  `--container-2xl` and `--container-3xl`, which left `:root` when their
 *            last utility user did. Nothing removed them -- the same property the
 *            palette relies on, measured again on a variable Tailwind ships rather
 *            than one this system declares.
 *   +   45  `.mb-4`, the gap below `mw-page-header`, which the header owns now
 *            instead of thirteen screens setting five different values between them.
 *
 * The rest of that pass -- four headings moved between two roles that both already
 * existed, two middle dots retired, seven paragraphs capped, and the 404 R313
 * decided finally built with a heading, a sentence and three routes out -- moved the
 * sheet by 0 bytes between them.
 *
 * Then 25,189 -> **25,363**, +174, for three of the six primitives section 6.5
 * specified and nobody built. The split is visible in the arithmetic:
 *
 *   +  174  `mw-state-track`, all of it: `.h-1` (27), `.bg-ink-300` (50),
 *            `.text-ink-500` (41) and `.dark:bg-ink-600` (56). It is a new object --
 *            the study lifecycle drawn as the sequence it is -- so it brings new
 *            rules. `.bg-signal-600` and `.dark:bg-signal-400` were already here.
 *   +    0  `mw-meta` and `mw-range`. Neither adds an idea; each retires a copy, so
 *            every class they carry was in the sheet already -- six hand-written meta
 *            lines with three different gaps between them, and two ranges with the
 *            same nine classes typed out twice.
 *
 * That is the clearest statement of the layer's economics on this branch. A primitive
 * that unifies what screens were already doing is free. A primitive that draws
 * something new costs what the new thing costs, and nothing more.
 *
 * Then 25,363 -> **25,515**, +152, for the fourth, `mw-record`:
 *
 *   +  152  two descendant rules, `[&_dt]:text-ink-600` (55) and its dark twin (97).
 *            The dark one is dearer because it opens a media block of its own rather
 *            than joining the one every other dark utility sits in -- a descendant
 *            selector sorts after them, so it cannot share the block.
 *
 * This one is the trade stated honestly rather than a free win: the sheet grows 152
 * bytes and the source loses ten copies of the same two classes on ten consecutive
 * `dt` elements, plus an em dash that was doing a column's job. Worth it, and not
 * because of the bytes.
 *
 * Then 25,515 -> **25,528**, +13, for the content measure (R368). The cheapest entry
 * in this history and the one that fixed the most visible defect:
 *
 *   +   50  `.max-w-content`, and +27 for `--container-content: 1120px` in `:root`
 *   -   42  `.max-w-5xl`, and -22 for `--container-5xl`, which left when its last
 *            user did -- the tree-shaking property a fourth time
 *
 * Design system 5 has always said app content is 1120px; `mw-shell` approximated it
 * with Tailwind's `5xl`, which is 1024. The 96px between them is exactly what the
 * landing hero's own slider needs: at 120 columns the replica is 1008px of character
 * cells, and inside 992px of content it was clipped on every screen made, a 1920px
 * monitor included, with 900px of page unused either side.
 *
 * A note on how this figure was reached, since the history above is the useful part
 * of this file: the first build after `mw-record` came to 25,537, and the orphan
 * check below named `.fixed` -- minted from the ordinary English word in the new
 * component's own doc comment, where it described the rail it was not using. R47 for
 * the eighteenth time on this branch, and the first time the byte pin and the orphan
 * check caught the same one together.
 */

// `pretest` builds (R80), so what is read here is the artifact this tree produces.
// CLAUDE.md's second trap — a suite that exercises a stale `dist/` — is closed by the
// build, not by trusting R43's process rule to bind whoever comes next.
describe('the emitted stylesheet', () => {
  it('is the size a clean build produces', () => {
    expect(
      statSync(stylesheet()).size,
      `${css} is not the measured baseline. See the note above this constant before changing it.`,
    ).toBe(BASELINE_BYTES)
  })

  /**
   * The utilities prose has minted on this repository. Every one of them shipped
   * once; none is used by any template here.
   *
   * `visible` was the first that this list caught rather than a hand measurement: two
   * comments written while adding the spec §7 legal pages used the word
   * "crawler-visible" and "a visible price", and the byte count went 18,038 -> 18,066.
   * Both were reworded -- those are shipped source files, and the `@source not`
   * exclusions are for trees that are not.
   *
   * `static` is different again, and had been shipping the whole time. It comes from the
   * package *root* -- `vite.config.ts`'s `static: true` and `package.json`'s `tsx
   * e2e/static-server.ts` -- which the exclusions did not cover, so no amount of care in
   * `src` would have stopped it. The branch review found it by extracting all 243 class
   * selectors from the emitted sheet and testing each against every file under `src`:
   * 82 did not match, 81 of them numeric fragments of `oklch()` values, and `static` was
   * the only real name. Two more `@source not` lines removed it, exactly 24 bytes.
   *
   * `hidden` is deliberately **not** in this list. It is minted from shipped copy —
   * spec §4.7's "a hidden sponsor" and "attention (hidden check)" — so it is an
   * orphan by accident of vocabulary, not prose contamination, and it stays.
   *
   * If a template ever legitimately uses one of these, delete it from the list in
   * the same commit. Do not add an `@source not` line to hide it.
   */
  it.each(['invisible', 'visible', 'fixed', 'relative', 'table', 'filter', 'static'])(
    'does not carry .%s, which no template asks for',
    (utility) => {
      expect(readFileSync(stylesheet(), 'utf8'), `.${utility} is back — something outside src/ is being scanned`)
        .not.toContain(`.${utility}{`)
    },
  )
})
