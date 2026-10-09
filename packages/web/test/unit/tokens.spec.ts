// The design tokens, checked rather than trusted.
//
// Deriving the palette in `src/styles.css` turned up two classes of defect, neither
// of which was visible to the eye, and this file exists to encode both:
//
//  1. **A pair that misses AA by a rounding error.** The first neutral put muted text
//     at 4.48 and 4.24 against the two page grounds — under 4.5, and close enough to
//     it that no review would have queried the colour. Nothing but arithmetic catches
//     that.
//  2. **A colour outside the sRGB gamut.** Six of the eleven accent steps were first
//     generated beyond what sRGB can express. `oklch()` does not fail there; it
//     clips. So the value in the stylesheet and the value that had been measured for
//     contrast were two different colours, and the measurement was of a colour that
//     would never be painted. `expectsGamut` below is the assertion that closes it.
//
// This reads `src/styles.css` — the file the build consumes — rather than a copy of
// the palette kept beside it. A second table of hexes would be a second source of
// truth, and the bug this suite is for travels through the stylesheet.
//
// Why this file may say `border`, `outline`, `ring` and `shadow` freely while
// `src/` may not: `../test/**` is excluded from Tailwind's scan in `src/styles.css`,
// so prose here cannot mint a utility (R47).
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, it, expect } from 'vitest'
import { tokenSource } from './token-source'

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const source = tokenSource()

/**
 * `--color-<name>: #RRGGBB;` optionally followed by the `oklch()` it was generated
 * from. The provenance comment is parsed, not skipped: a comment nothing reads is a
 * comment that drifts, and here it is what makes the gamut check possible.
 */
function tokens(): Map<string, { hex: string; oklch?: [number, number, number] }> {
  const found = new Map<string, { hex: string; oklch?: [number, number, number] }>()
  const line = /--color-([a-z0-9-]+):\s*(#[0-9A-Fa-f]{6});(?:\s*\/\*\s*oklch\(([\d.]+)\s+([\d.]+)\s+([\d.]+)\)\s*\*\/)?/g
  for (const m of source.matchAll(line)) {
    found.set(m[1]!, {
      hex: m[2]!.toUpperCase(),
      oklch: m[3] ? [Number(m[3]), Number(m[4]), Number(m[5])] : undefined,
    })
  }
  return found
}

const PALETTE = tokens()
/** Not a token, but half of most pairs: a card sits on white in the light theme. */
const LITERALS: Record<string, string> = { white: '#FFFFFF' }

function hexOf(name: string): string {
  const literal = LITERALS[name]
  if (literal) return literal
  const token = PALETTE.get(name)
  // A renamed or deleted token has to fail here. Returning a default would let the
  // pair table go on passing while measuring nothing — the shape of the vacuous
  // tests this repository has shipped before.
  expect(token, `no --color-${name} in src/styles.css; the pair table below names it`).toBeDefined()
  return token!.hex
}

const channel = (c: number): number => {
  const s = c / 255
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
}

/** WCAG 2.1 relative luminance. */
function luminance(hex: string): number {
  const h = hex.replace('#', '')
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as [number, number, number]
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number]
  return (hi + 0.05) / (lo + 0.05)
}

/** OKLCH to linear sRGB, unclamped — the sign of each channel is the gamut test. */
function linearRgb(L: number, C: number, hueDeg: number): [number, number, number] {
  const h = (hueDeg * Math.PI) / 180
  const a = C * Math.cos(h)
  const b = C * Math.sin(h)
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ]
}

const encode = (c: number): number => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055)

function oklchToHex(L: number, C: number, hueDeg: number): string {
  return (
    '#' +
    linearRgb(L, C, hueDeg)
      .map((v) => Math.round(Math.min(1, Math.max(0, encode(v))) * 255).toString(16).padStart(2, '0').toUpperCase())
      .join('')
  )
}

/**
 * Every foreground/background pair the design system declares, with the ratio it has
 * to clear: 4.5 for normal text, 3.0 for large text and for a boundary that carries
 * meaning, 1.0 for a hairline that is decorative and only has to be discernible.
 *
 * Adding a pair here is how a new role gets covered. A role drawn in the templates
 * but missing from this table is unmeasured — the list is the claim.
 *
 * `ink-500` appears once, and deliberately at 4.5, to hold the line that made it a
 * non-text token: it measures 4.52, clearing AA by 0.02. If a future edit lightens it
 * by one step this goes red, which is the point. It is used for placeholders and
 * decorative marks, never for body text.
 */
const PAIRS: ReadonlyArray<readonly [string, string, string, number]> = [
  ['heading on the page ground', 'ink-900', 'ink-50', 4.5],
  ['body text on the page ground', 'ink-800', 'ink-50', 4.5],
  ['body text on a card', 'ink-800', 'white', 4.5],
  ['muted text on the page ground', 'ink-600', 'ink-50', 4.5],
  ['muted text on a card', 'ink-600', 'white', 4.5],
  ['ink-500, which is why it is not a text token', 'ink-500', 'ink-50', 4.5],
  ['hairline on the page ground', 'ink-200', 'ink-50', 1.0],
  // The systematic scan's one real defect, and it was a wrong *bar* rather than a
  // missing row — which is why two earlier rounds of adding rows never found it. This
  // role was named, and asked for 1.0, the bar for something decorative. A control
  // whose boundary is the only thing identifying it as a control is not decorative:
  // WCAG 1.4.11 puts it at 3.0, and both edges were far under (ink-300 on white 1.48,
  // ink-600 on ink-800 1.94). The fill rescues neither theme — white on ink-50 is
  // 1.05, ink-800 on ink-900 is 1.21 — so the edge carries the whole affordance, and
  // is measured against the fill it encloses *and* the ground it sits on.
  //
  // ink-500 is the first light step that clears both, and it is the token R304 set
  // aside as too light for text and too dark for decoration; this is the job that
  // describes. Dark could have reused ink-500 and saved a utility, but on a card it
  // lands at 3.09 — a 0.09 margin, and R304 is the ruling that refused a 0.02 one.
  ['control edge on the page ground', 'ink-500', 'ink-50', 3.0],
  ['control edge on a card', 'ink-500', 'white', 3.0],
  ['control edge, dark, on the page ground', 'ink-400', 'ink-900', 3.0],
  ['control edge, dark, on a card', 'ink-400', 'ink-800', 3.0],
  // R316 lightened these. The ramp did not move a single value — the roles did.
  // The primary fill is the same in both themes, which is why there is one pair for
  // it rather than a light one and a dark one.
  ['primary button label', 'ink-950', 'signal-400', 4.5],
  ['primary button label, hovered', 'ink-950', 'signal-300', 4.5],
  ['link on the page ground', 'signal-600', 'ink-50', 4.5],
  ['link on a card', 'signal-600', 'white', 4.5],
  ['focus edge on the page ground', 'signal-600', 'ink-50', 3.0],
  ['live chip', 'ink-950', 'signal-400', 4.5],
  ['draft chip', 'ink-700', 'ink-200', 4.5],
  ['in-review chip', 'review-fg', 'review-bg', 4.5],
  ['in-review chip edge', 'review-edge', 'review-bg', 1.0],
  ['settled chip', 'settled-fg', 'settled-bg', 4.5],
  ['settled chip edge', 'settled-edge', 'settled-bg', 1.0],
  ['rejected chip', 'rejected-fg', 'rejected-bg', 4.5],
  ['rejected chip edge', 'rejected-edge', 'rejected-bg', 1.0],
  // The replica of the status line. It is this surface in both themes, because it is
  // a picture of a terminal rather than a surface of the page.
  ['status-line replica text', 'ink-100', 'ink-950', 4.5],
  ['status-line replica muted text', 'ink-400', 'ink-950', 4.5],
  ['status-line replica accent', 'signal-300', 'ink-950', 4.5],
  ['status-line replica sponsor name', 'signal-200', 'ink-950', 4.5],
  ['status-line replica payout figure', 'white', 'ink-950', 4.5],
  // R317. On the dark page ground the replica is ink-950 on ink-900, which measures
  // 1.12 — less than a hairline manages (1.20), so the one object the whole design
  // is built around stops being an object at all. It takes a frame that carries
  // meaning rather than one that decorates.
  ['status-line replica frame, on the dark ground', 'signal-500', 'ink-900', 3.0],
  // The hero shows the replica inside the terminal it lives at the bottom of, so the
  // surface carries agent output as well as the status line (R318). These four rows
  // were written when R318 was decided and spent four commits describing a surround
  // nothing drew -- which the coverage check below now catches in that direction, and
  // caught here. The landing hero draws all four.
  ['terminal, the prompt that was typed', 'white', 'ink-950', 4.5],
  ['terminal, output that has settled', 'ink-400', 'ink-950', 4.5],
  ['terminal, the working directory label', 'ink-400', 'ink-950', 4.5],
  ['terminal, the cursor', 'signal-400', 'ink-950', 3.0],
  // The study lifecycle track. The step reached is an indicator of state, so it is
  // asked for 3.0 against the page and is also 4.97 against an unreached step; the
  // unreached ones are the ground the sequence is drawn on, carry no meaning of their
  // own, and are judged as decoration. None of it is load-bearing on its own: the step
  // reached is the only label at raised weight, which `primitives.spec.ts` asserts, so
  // the distinction survives a reader who cannot separate the two bar colours at all.
  ['study track, a step reached', 'signal-600', 'ink-50', 3.0],
  ['study track, a step not reached', 'ink-300', 'ink-50', 1.0],
  // The fifth, which R318 did not specify because it did not draw the prompt box.
  // Judged at the decorative bar and not at 3.0 on purpose: the pane is a single
  // role=img and nothing inside it is operable, so this is a picture of a control
  // rather than a control, and WCAG 1.4.11 is about the second. It is asked to clear
  // the lattice's own 1.20 all the same, and does, at 1.36.
  ['terminal, the edge of the prompt box', 'ink-800', 'ink-950', 1.0],
  // R319. The dark theme is designed rather than derived, so its banners are pinned
  // here too — the amber edge failed at 2.50 on the first attempt.
  ['dark done banner text', 'signal-200', 'signal-800', 4.5],
  ['dark done banner edge', 'signal-500', 'ink-900', 3.0],
  ['dark warn banner text', 'review-edge', 'review-bg-dark', 4.5],
  ['dark warn banner edge', 'review-edge-dark', 'ink-900', 3.0],
  // Added after seeing the banners on screen. The error tone had no dark fill of its
  // own and no pair naming its dark edge, so it rendered on the neutral ground with
  // an edge at 2.74 — and nothing failed, because the table did not ask. The list is
  // the claim: a role drawn in the templates but missing from it is unmeasured.
  ['dark error banner text', 'rejected-edge', 'rejected-bg-dark', 4.5],
  ['dark error banner edge', 'rejected-edge-dark', 'ink-900', 3.0],
  ['dark error banner fill against the page', 'rejected-bg-dark', 'ink-900', 1.0],
  ['dark info banner text', 'ink-100', 'ink-800', 4.5],
  // The badge's dark theme, added with it. `settled` needed tokens of its own, and
  // its edge is the third state where reusing the light `-fg` as the dark edge fails
  // the 3.0 bar — 1.78, after amber's 2.50 and red's 2.74. Three for three makes it a
  // rule, which `src/styles.css` now states.
  ['dark settled chip', 'settled-edge', 'settled-bg-dark', 4.5],
  ['dark settled chip edge', 'settled-edge-dark', 'ink-900', 3.0],
  ['dark settled chip fill against the page', 'settled-bg-dark', 'ink-900', 1.0],
  ['dark closed chip edge', 'ink-600', 'ink-700', 1.0],
  ['closed chip edge', 'ink-300', 'ink-200', 1.0],
  ['dark chip label', 'ink-100', 'ink-700', 4.5],
  ['dark secondary button label', 'ink-100', 'ink-900', 4.5],
  ['dark danger button label', 'white', 'rejected-fg', 4.5],
  // The light half, added when `tk-bar` migrated and the measurement refused the
  // obvious answer: `signal-400` on the light track is **1.96**, so the fill is a
  // different step in each theme rather than one colour in both.
  ['quota bar against its track', 'signal-600', 'ink-200', 3.0],
  ['dark quota bar against its track', 'signal-400', 'ink-700', 3.0],
  ['the character-cell grid, light', 'ink-200', 'ink-50', 1.0],
  ['the character-cell grid, dark', 'ink-800', 'ink-900', 1.0],
  ['dark theme heading', 'ink-50', 'ink-900', 4.5],
  ['dark theme body text', 'ink-100', 'ink-900', 4.5],
  ['dark theme muted text', 'ink-400', 'ink-900', 4.5],
  ['dark theme muted text on a card', 'ink-400', 'ink-800', 4.5],
  ['dark theme hairline', 'ink-700', 'ink-900', 1.0],
  ['dark theme link', 'signal-300', 'ink-900', 4.5],
  ['dark theme primary button label', 'ink-950', 'signal-400', 4.5],
  ['dark theme primary button label, hovered', 'ink-950', 'signal-300', 4.5],
  ['dark theme focus edge', 'signal-400', 'ink-900', 3.0],
  ['dark theme study track, a step reached', 'signal-400', 'ink-900', 3.0],
  ['dark theme study track, a step not reached', 'ink-600', 'ink-900', 1.0],
  // Roles the systematic scan found drawn in shipped source with no row naming them.
  // Worth recording plainly: not one of them failed. The hole was in the asking rather
  // than in the palette, and eighteen of these nineteen rows only write down a number
  // the ramps had already earned. That is the argument for enumerating roles from the
  // source instead of from memory — three of these tokens (`signal-50`, `signal-700`,
  // `rejected-fg-hover`) had never been measured against anything at all, and nothing
  // in the suite would have said so.
  ['done banner text', 'signal-700', 'signal-50', 4.5],
  ['done banner edge', 'signal-300', 'signal-50', 1.0],
  ['done banner fill against the page', 'signal-50', 'ink-50', 1.0],
  ['info banner text', 'ink-800', 'ink-100', 4.5],
  ['info banner edge', 'ink-200', 'ink-100', 1.0],
  ['info banner fill against the page', 'ink-100', 'ink-50', 1.0],
  ['warn banner fill against the page', 'review-bg', 'ink-50', 1.0],
  ['error banner fill against the page', 'rejected-bg', 'ink-50', 1.0],
  ['settled chip fill against the page', 'settled-bg', 'ink-50', 1.0],
  ['field error message on the page ground', 'rejected-fg', 'ink-50', 4.5],
  ['field error message on a card', 'rejected-fg', 'white', 4.5],
  ['field error message, dark', 'rejected-edge', 'ink-900', 4.5],
  ['placeholder on a card', 'ink-500', 'white', 4.5],
  ['focus edge on a card', 'signal-600', 'white', 3.0],
  ['secondary button label, hovered', 'ink-800', 'ink-100', 4.5],
  ['link on the page ground, hovered', 'signal-700', 'ink-50', 4.5],
  ['dark theme link, hovered', 'signal-200', 'ink-900', 4.5],
  // Darker on hover rather than lighter, which is the opposite of what primary does.
  ['danger button label, hovered', 'white', 'rejected-fg-hover', 4.5],

  // The six pairs a systematic scan of shipped source found painted together with no
  // row naming that combination. Every one already cleared the bar its role asks for,
  // so nothing here is a fix -- they are added because the table is this branch's
  // stated claim about what has been measured, and "the token appears somewhere in
  // the table" is not that claim. The same shape as the wrong-bar defect R326 found.
  //
  // Five are an edge against its own fill, which is decoration: the object is already
  // separated from the page by the rows above, each measured at 3.0 against `ink-900`.
  // The sixth is not decoration -- a focus ring is an affordance wherever it lands,
  // so it is asked for 3.0 against the surface it is actually drawn on.
  ['raised card edge against its own fill, dark', 'ink-700', 'ink-800', 1.0],
  ['dark error chip edge against its own fill', 'rejected-edge-dark', 'rejected-bg-dark', 1.0],
  ['dark warn chip edge against its own fill', 'review-edge-dark', 'review-bg-dark', 1.0],
  ['dark settled chip edge against its own fill', 'settled-edge-dark', 'settled-bg-dark', 1.0],
  ['dark done banner edge against its own fill', 'signal-500', 'signal-800', 1.0],
  ['focus ring on a dark input surface', 'signal-400', 'ink-800', 3.0],
]

describe('the design tokens', () => {
  it.each(PAIRS)('%s clears its ratio', (_name, fg, bg, need) => {
    const [a, b] = [hexOf(fg), hexOf(bg)]
    expect(contrast(a, b), `${fg} ${a} on ${bg} ${b}`).toBeGreaterThanOrEqual(need)
  })

  /**
   * The two generated ramps, and only those: the state colours are picked rather than
   * generated and carry no provenance. Naming the expected count means a step added
   * without its `oklch()` comment fails here instead of quietly escaping both checks
   * below.
   */
  const generated = [...PALETTE].filter(([name]) => /^(ink|signal)-\d+$/.test(name))

  it('has all 22 generated steps, each with the oklch it came from', () => {
    expect(generated).toHaveLength(22)
    for (const [name, { oklch }] of generated) {
      expect(oklch, `--color-${name} has no /* oklch(...) */ provenance comment`).toBeDefined()
    }
  })

  it.each(generated.map(([name, v]) => [name, v] as const))(
    '%s is inside the sRGB gamut, so its hex is not a clipped approximation',
    (name, { oklch }) => {
      const [L, C, h] = oklch!
      for (const [i, v] of linearRgb(L, C, h).entries()) {
        // Outside [0,1] means oklch() would clip, and the hex beside it would be a
        // different colour from the one declared. Six steps failed this while the
        // palette was being derived.
        expect(v, `--color-${name} channel ${'rgb'[i]} is ${v.toFixed(4)} for oklch(${L} ${C} ${h})`)
          .toBeGreaterThan(-0.001)
        expect(v).toBeLessThan(1.001)
      }
    },
  )

  it.each(generated.map(([name, v]) => [name, v] as const))(
    '%s stores the hex its oklch produces',
    (name, { hex, oklch }) => {
      const [L, C, h] = oklch!
      const produced = oklchToHex(L, C, h)
      // Per channel rather than string equality: rounding may differ by one, and a
      // failure should mean the two have genuinely diverged.
      for (let i = 0; i < 3; i++) {
        const stored = parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16)
        const expected = parseInt(produced.slice(1 + i * 2, 3 + i * 2), 16)
        expect(Math.abs(stored - expected), `--color-${name} is ${hex}; oklch(${L} ${C} ${h}) produces ${produced}`)
          .toBeLessThanOrEqual(1)
      }
    },
  )

  it('declares no green token, which design system 3.4 removed on purpose', () => {
    // Money is set in ink rather than coloured, and the ledger's entry types are
    // types rather than sentiment. A green token reintroduced without reading that
    // section should fail rather than merely look inconsistent.
    for (const [name, { hex }] of PALETTE) {
      const r = parseInt(hex.slice(1, 3), 16)
      const g = parseInt(hex.slice(3, 5), 16)
      const b = parseInt(hex.slice(5, 7), 16)
      const green = g > 90 && g - r > 40 && g - b > 40
      expect(green, `--color-${name} ${hex} reads as green`).toBe(false)
    }
  })
})

// ---------------------------------------------------------------------------
// The three checks that make the table above complete rather than diligent.
//
// `PAIRS` is a hand-written claim, and a hand-written claim is exactly as complete as
// whoever last extended it. Twice this design system's defects were found by *looking*
// at the workshop rather than by a test -- the error tone had no dark fill, and its
// edge sat at 2.74 -- and both times for the same reason: the table did not name the
// role, so nothing was asked. Adding the row afterwards fixes that role and leaves the
// method exactly as it was.
//
// So the roles are enumerated from the source instead:
//
//   1. a token painted anywhere in shipped source must appear in `PAIRS`. A colour
//      drawn but never measured against anything is unmeasured, whatever the table's
//      length suggests.
//   2. a class string that gives any property a dark treatment must give *every*
//      coloured property one. This is the error-banner defect stated as a rule: that
//      string had `dark:` for its edge and its text but not its fill, so the most
//      urgent tone in the app rendered half in one theme and half in the other.
//   3. the control edges, measured from the class strings themselves rather than from
//      a row above -- see the comment on `CONTROL_EDGES`, which exists because a
//      mutation showed checks 1 and 2 do not catch the defect this round fixed.
//
// None of the three replaces the measurement. They make every colour reach it.

/** Utilities that take a colour. `ring`/`divide`/`from` are unused today, deliberately listed. */
const COLOUR_PROPS = ['bg', 'text', 'border', 'outline', 'ring', 'divide', 'from', 'via', 'to', 'accent', 'caret', 'decoration', 'fill', 'stroke']  as const

/**
 * One class, if it paints with a token. The lookahead in `paintedToken` and the exact
 * match here both matter: `ink-50` is a prefix of `ink-500` and `review-bg` of
 * `review-bg-dark`, so a substring test would report the wrong token and every check
 * below would then be reasoning about a colour that is not on the page.
 */
function paints(cls: string): { prop: string; token: string; dark: boolean; state: string } | undefined {
  // Arbitrary variants come off first. Tailwind writes them `[&_thead]:text-ink-600`,
  // and the pattern below rejects `[`, `&` and `_` -- so all four colour utilities on
  // `tk-rows`, the data grid every table screen uses, parsed to nothing and the whole
  // string counted as painting no colour at all. Stripping them leaves the part this
  // is asking about, and keeps `dark:` where the dark check can still see it.
  const bare = cls.replace(/\[[^\]]*\]:/g, '')
  const m = /^((?:[a-z-]+:)*)([a-z]+)-([a-z0-9-]+)$/.exec(bare)
  if (!m) return undefined
  const [, variants, prop, token] = m as unknown as [string, string, string, string]
  if (!COLOUR_PROPS.includes(prop as (typeof COLOUR_PROPS)[number])) return undefined
  if (!PALETTE.has(token) && !(token in LITERALS)) return undefined
  return { prop, token, dark: variants.includes('dark:'), state: variants.replace('dark:', '') }
}

/**
 * Every quoted run of two or more words in a file. Class strings in this package come
 * in three shapes -- a `Record` of variants, a `const` of always-on classes, and
 * `class="..."` inside a template literal -- and quoting is the one thing all three
 * share. Runs that are not classes parse to nothing and cost only the attempt.
 */
function classRuns(body: string): string[][] {
  const runs: string[][] = []
  for (const m of body.matchAll(/'([^'\n]{8,})'|"([^"\n]{8,})"/g)) {
    // Every quoted run, including one of a single word. It used to require two, and
    // `class="text-signal-950"` -- the most ordinary shape a template has -- was
    // therefore invisible to both checks below. False positives are bounded: a word
    // still has to parse as `prop-token` and name a colour in the palette, and
    // anything that does is a paint.
    runs.push((m[1] ?? m[2]!).trim().split(/\s+/))
  }
  return runs
}

/**
 * Every colour this product actually paints is measured against something.
 *
 * Asked of the artifact, not of the templates, and the reason is the same one that
 * moved the migration ledgers: a source-side version of this question could not see a
 * single-word `class` attribute or a class behind an arbitrary variant, so `tk-rows`
 * -- the grid on every table screen -- sat outside it entirely. The sheet has no such
 * blind spots. A token that reaches `:root` is a token a rule references, and a rule
 * that references it is a colour on the page.
 *
 * Both directions, because each catches a different defect. A token emitted with no
 * `PAIRS` row is a colour nobody measured. A `PAIRS` row naming an ink or signal step
 * that never reaches the sheet is a row measuring nothing -- which is how four rows
 * came to describe a terminal surround no component drew, for four commits, until
 * this direction was added and named them. They describe the landing hero now, and
 * the check is what said they did not.
 */
describe('every colour the product paints', () => {
  const measured = new Set(PAIRS.flatMap(([, fg, bg]) => [fg, bg]))
  const emitted = new Set(
    [...emittedTheme().matchAll(/--color-([a-z0-9-]+):/g)].map((m) => m[1]!).filter((n) => !(n in LITERALS)),
  )

  it('is a colour the pair table measures', () => {
    expect(
      [...emitted].filter((t) => !measured.has(t)).sort(),
      'this colour is in the shipped sheet and no pair above names it',
    ).toEqual([])
  })

  it('is measured against a ground, not merely named', () => {
    const ramp = [...measured].filter((t) => /^(ink|signal)-\d+$/.test(t))
    expect(
      ramp.filter((t) => !emitted.has(t)).sort(),
      'a pair row measures a ramp step nothing in the product paints',
    ).toEqual([])
  })

  it('is reading colours at all', () => {
    expect(emitted.size, 'no colour tokens in the sheet, so the checks above proved nothing').toBeGreaterThanOrEqual(20)
    expect(emitted, 'the accent is not in the sheet, so this is not our stylesheet').toContain('signal-400')
  })
})

/**
 * The exception, named rather than allowed for in the rule.
 *
 * A class string may legitimately mix a property that is theme-independent with one
 * that only exists in the dark theme, and the pane is the case: its surface is
 * `ink-950` in *both* themes, because it is a picture of a terminal rather than a
 * surface of the page, while its frame exists only on the dark ground where the
 * surface would otherwise vanish into it (R317, 1.12).
 *
 * Listed per file and property so that a second property going half-themed in the
 * same file still fails. The alternative -- loosening the rule to "some properties"
 * -- would have stopped it catching the error-banner defect it was written for.
 */
const SAME_IN_BOTH_THEMES: Readonly<Record<string, readonly string[]>> = {
  'ui/pane.ts': ['bg-ink-950'],
}

/**
 * Every shipped file under `src/app`.
 *
 * Two guards still read templates rather than the artifact, and they have to. Dark
 * completeness is about a light utility and a dark one appearing in the *same class
 * string*; the money-voice check is about what sits inside a table cell. Neither
 * question survives minification, so neither can move to the sheet.
 *
 * Stories are excluded for the reason `src/styles.css` excludes them from Tailwind's
 * scan: nothing in them ships, and a colour chosen in the workshop to demonstrate a
 * variant is not a claim this product makes.
 */
function shippedSources(): string[] {
  const appDir = resolve(packageRoot, 'src/app')
  return readdirSync(appDir, { recursive: true, encoding: 'utf8' })
    .filter((f) => f.endsWith('.ts') && !f.endsWith('.spec.ts') && !f.endsWith('.stories.ts'))
    .map((f) => f.split('\\').join('/'))
}

const shipped = shippedSources().map((rel) => ({
  rel,
  body: readFileSync(resolve(packageRoot, 'src/app', rel), 'utf8'),
}))

/**
 * Prose is capped at a measure, and the caps agree with each other.
 *
 * Design system 4 ends with one sentence -- prose measure is capped at 68ch, inside
 * the 80-character limit and set in `ch` so it survives a change of face -- and the
 * screens had four different answers to it. `max-w-3xl` on four admin pages is about
 * 110 characters at `text-small`; `max-w-2xl` across the legal pages is about 84 at
 * `text-body`; and seven paragraphs had no cap at all, so they ran the width of the
 * container. The worst was the earnings page's status legend, a 340-character
 * sentence about why money a developer is owed disappears from a balance before it
 * arrives, set at 12px across roughly 137 characters.
 *
 * Source-side, and it has to be: this is about which class string is on which
 * element, a question minification does not preserve. Same reasoning as the dark
 * check above.
 *
 * The narrower named caps stay allowed. A cap is not only a measure -- a form is
 * sized to its fields, and a banner beside a `max-w-md` form should not be wider
 * than the form it belongs to -- so the rule is that prose is *capped*, and capped at
 * no more than the measure.
 */
const MEASURE = 'max-w-[68ch]'
const NARROWER = ['max-w-[24ch]', 'max-w-md', 'max-w-sm', 'max-w-xs']

/**
 * A heading below the page title has three treatments, and there is no fourth. The
 * third, R385, is the label of a group inside a section rather than a level of its own.
 *
 * The rule design system 4 now states: **a section of the page is `text-h2`; a
 * heading inside a card or panel is `text-h3`.** Both are `<h2>` elements -- the
 * document outline is h1 then h2 everywhere, and the type role is the thing that
 * varies -- and the split is structural rather than a matter of how important the
 * words feel, which is the form of this decision that drifts.
 *
 * Four screens disagreed with it when it was written down: the new-study form set
 * its two bare sections at `text-h3` while setting its two card panels at the same
 * `text-h3`, which is the whole hierarchy of the page flattened into one step, and
 * settings did the same with Payout and Your data.
 *
 * What this asserts is narrower than the rule and is the part a regex can be honest
 * about: **the set of heading treatments is closed.** Whether a particular heading
 * sits inside a card is a question about nesting, and a regex answering it would be
 * the kind of guard that returns a confident wrong answer; that half is enforced by
 * the written rule and by review. A fourth treatment appearing is what this catches,
 * and a fourth treatment is how the four heading sizes section 7 retired got there.
 */
const HEADING_TREATMENTS = [
  'text-h2 text-ink-900 dark:text-ink-50',
  'text-h3 text-ink-900 dark:text-ink-50',
  // R385: the label of one group of controls inside a section or card -- the targeting
  // groups (Languages, Countries, ...) -- which is a step below the card's own title so
  // that it does not read as a sibling of "Quote". Body size, semibold, same ink.
  'text-body font-semibold text-ink-900 dark:text-ink-50',
  // The one exception, and it is about a single destructive action rather than about
  // a level: settings' delete-account panel is titled in the error voice, which is
  // the same treatment every other irreversible thing on that page uses.
  'text-h3 text-rejected-fg dark:text-rejected-edge',
]

/**
 * The middle dot belongs to one component, and to nothing else.
 *
 * Design system 7 retires the dotted chain everywhere but the replica: spec 5.4 puts
 * the mark in the status line, so it is the product's one distinctive typographic
 * device, and page chrome borrowing it spends that device on decoration. The footer
 * chain went first. Two survived the migration, both with a reason written beside
 * them, and the reasons are the shape this branch has learned to distrust -- the
 * admin targeting line was exempted because "that string is built in TypeScript and
 * is data the reviewer reads, not chrome this template joins together", which is a
 * fact about where the join happens and not about what a reader sees.
 *
 * Source-side because that is where the claim is: the mark is a character in a
 * template or in a string a component builds, and the sheet has never seen it.
 */
const MARK_BELONGS_TO = 'ui/pane.ts'

describe('the middle dot', () => {
  it('appears in the component spec 5.4 gives it to, and in no other file', () => {
    const elsewhere = shipped
      .filter(({ rel, body }) => rel !== MARK_BELONGS_TO && body.includes('·'))
      .map(({ rel }) => rel)
    expect(elsewhere.sort(), 'the replica lends its mark to page chrome').toEqual([])
  })

  it('is in the component it belongs to, so this is not passing by looking nowhere', () => {
    const pane = shipped.find(({ rel }) => rel === MARK_BELONGS_TO)
    expect(pane, `${MARK_BELONGS_TO} is not in the shipped set`).toBeDefined()
    expect(pane!.body, 'the replica composes its fields with something else now').toContain('·')
  })
})

describe('a heading below the page title', () => {
  const found = new Map<string, string[]>()
  for (const { rel, body } of shipped) {
    for (const m of body.matchAll(/<h[23]\s+class="([^"]*)"/g)) {
      const cls = m[1]!.replace(/^(mt-\d+|mb-\d+)\s+/, '')
      found.set(cls, [...(found.get(cls) ?? []), rel])
    }
  }

  it('is one of the three treatments the system has, and never a fourth', () => {
    const strays = [...found].filter(([cls]) => !HEADING_TREATMENTS.includes(cls))
    expect(
      strays.map(([cls, files]) => `${cls} — in ${[...new Set(files)].join(', ')}`).sort(),
      'a heading treatment this design system does not have',
    ).toEqual([])
  })

  it('is reading headings at all, and both levels are in use', () => {
    expect(found.size, 'no headings found, so the check above proved nothing').toBeGreaterThan(0)
    expect([...found.keys()]).toContain(HEADING_TREATMENTS[0])
    expect([...found.keys()]).toContain(HEADING_TREATMENTS[1])
  })

  it('has the group label in use, so the third treatment is not an allowance nobody takes', () => {
    const group = HEADING_TREATMENTS[2]!
    expect(found.get(group), 'no group label uses it').toBeDefined()
    // The four targeting groups on the new-study form, and nothing that is a card title.
    expect([...new Set(found.get(group))]).toEqual(['pages/app/studies/new.page.ts'])
    expect(found.get(group)!.length).toBe(4)
  })
})

describe('prose is capped at a measure', () => {
  const uncapped: string[] = []
  for (const { rel, body } of shipped) {
    for (const line of body.split('\n')) {
      const tag = /<(p|ul|ol)\s+[^>]*class="([^"]*)"/.exec(line)
      if (!tag) continue
      // What the element actually says, with bindings standing in for their values
      // and markup removed -- an interpolation is prose too, and the longest one here
      // expands to four sentences.
      const text = line
        .slice(tag.index + tag[0].length)
        .replace(/\{\{[^}]*\}\}/g, 'aaaaaaaa')
        .replace(/<[^>]*>/g, '')
        .trim()
      if (text.length < 70) continue
      const cls = tag[2]!
      if (cls.includes(MEASURE) || NARROWER.some((c) => cls.includes(c))) continue
      uncapped.push(`${rel}: <${tag[1]}> runs ${text.length} characters with no measure — ${text.slice(0, 48)}…`)
    }
  }

  it('leaves no declared class string without a cap', () => {
    expect(uncapped.sort(), 'prose with no cap, or a cap wider than the measure').toEqual([])
  })

  /**
   * And the rule is doing work rather than matching nothing. Both floors are facts
   * about this product: it is a text-heavy site with two legal pages, and every one
   * of those paragraphs is capped.
   */
  it('is reading prose at all', () => {
    const capped = shipped.flatMap(({ body }) => [...body.matchAll(/class="[^"]*max-w-\[68ch\][^"]*"/g)])
    expect(capped.length, 'no capped prose found, so the check above proved nothing').toBeGreaterThan(40)
  })
})

describe('a dark treatment is all-or-nothing', () => {
  const halfDone: string[] = []
  for (const { rel, body } of shipped) {
    for (const run of classRuns(body)) {
      const painted = run.map(paints).filter((p): p is NonNullable<typeof p> => p !== undefined)
      // A string with no dark utility at all is a surface that reads the same in both
      // themes on purpose -- the primary fill, the live chip, the danger button -- and
      // saying so by omission is how this system expresses it.
      if (!painted.some((p) => p.dark)) continue
      for (const p of painted.filter((q) => !q.dark)) {
        // Same state, not merely same property: a `hover:` light value answered only
        // by a `dark:` base value leaves the cascade to decide which wins on a dark
        // page, and that is a render nobody chose.
        if (SAME_IN_BOTH_THEMES[rel]?.includes(`${p.prop}-${p.token}`)) continue
        if (!painted.some((q) => q.dark && q.prop === p.prop && q.state === p.state)) {
          halfDone.push(`${rel}: ${p.state}${p.prop}-${p.token} has no dark twin`)
        }
      }
    }
  }

  it('leaves no property in one theme only', () => {
    expect(halfDone.sort(), 'a dark-themed class string still painting one property in light only').toEqual([])
  })
})

/**
 * The control edges, read out of the source and measured here.
 *
 * This check exists because a mutation proved the two above do not do its job. Putting
 * `border-ink-300` back on the input -- the exact defect this round found -- left both
 * of them green: check 1 only asks whether a painted token appears *somewhere* in
 * `PAIRS`, and ink-300 does appear there, as the closed chip's decorative edge. So a
 * control edge could be set to any token the table happens to mention for some other
 * role, at any ratio, and the suite would agree.
 *
 * A pair table is a claim about roles; a class string is what renders. Only a check
 * that reads the second and measures it can tell whether the claim is being kept, and
 * it is worth doing exactly where the boundary *is* the affordance. The grounds are
 * not inferred -- an input and a button sit on the page or on a card, and that is a
 * design statement, so it is written down.
 */
const GROUNDS = { light: ['ink-50', 'white'], dark: ['ink-900', 'ink-800'] } as const

const CONTROL_EDGES: ReadonlyArray<readonly [string, RegExp, keyof typeof GROUNDS]> = [
  ['the input, light', /(?<!dark:)\bborder-(ink-\d+)\b/, 'light'],
  ['the input, dark', /dark:border-(ink-\d+)\b/, 'dark'],
  ['the secondary button, light', /(?<!dark:)\bborder-(ink-\d+)\b/, 'light'],
  ['the secondary button, dark', /dark:border-(ink-\d+)\b/, 'dark'],
  // Added with the primitive, which is the case R328 said to watch for: a new control
  // whose edge is its only affordance, and no row above naming it.
  ['the selectable chip, light', /(?<!dark:)\bborder-(ink-\d+)\b/, 'light'],
  ['the selectable chip, dark', /dark:border-(ink-\d+)\b/, 'dark'],
]

const EDGE_FILES: Record<string, string> = {
  'the input, light': 'ui/input.ts',
  'the input, dark': 'ui/input.ts',
  'the secondary button, light': 'ui/button.ts',
  'the secondary button, dark': 'ui/button.ts',
  'the selectable chip, light': 'ui/chip.ts',
  'the selectable chip, dark': 'ui/chip.ts',
}

describe('a control edge carries the whole affordance', () => {
  it.each(CONTROL_EDGES)('%s clears 3.0 against both grounds', (label, pattern, theme) => {
    const body = readFileSync(resolve(packageRoot, 'src/app', EDGE_FILES[label]!), 'utf8')
    const found = pattern.exec(body)
    // Not a soft skip. A control that stopped declaring an edge has either grown a
    // fill that identifies it -- in which case this check should be rewritten around
    // that fill, deliberately -- or lost its only affordance.
    expect(found, `${EDGE_FILES[label]} declares no ${theme} border-ink-* for ${label}`).not.toBeNull()
    for (const ground of GROUNDS[theme]) {
      expect(
        contrast(hexOf(found![1]!), hexOf(ground)),
        `${label}: ${found![1]} on ${ground} identifies the control and needs 3.0 (WCAG 1.4.11)`,
      ).toBeGreaterThanOrEqual(3.0)
    }
  })
})

// ---------------------------------------------------------------------------
// The migration, asserted against the artifact instead of against the source.
//
// Two source-side ledgers used to live here: one counting stock colour utilities in
// `src/app`, one counting stock type steps. Both reached zero, and a whole-branch
// review then found five different ways for a stock utility to reach the stylesheet
// that neither could see -- a file Tailwind scans and no ledger read (`index.html`
// and four files under `src/`), a step the pattern never listed (`text-7xl`), a
// single-word `class` attribute the extractor discarded, an arbitrary variant its
// regex could not parse (`[&_thead]:text-ink-600`), and `bg-black`, which has no
// numeric step to match.
//
// They are not five bugs. They are five routes to the sheet, and a sixth exists. Every
// one of them was the same mistake: **a guard reading source to make a claim about the
// artifact**, which is CLAUDE.md's second question answered wrongly seven times.
//
// So the claim is made where it is true. The mechanism is not a selector walk -- that
// would need Tailwind's own escaping undone (`.bg-red-50\/50`, `.\[\&_thead\]\:...`)
// and a bug in the unescaping is the same silent hole in better disguise. It is this:
//
//   **Tailwind emits a `@theme` variable only where a utility references it.**
//
// That property is the branch's own measured finding, relied on in eight commits: the
// roles nothing uses cost nothing, and a stock ramp's `:root` entry leaves when its
// last user does. Turned around, it is a guard. A stock colour utility cannot reach
// the sheet without dragging `--color-<ramp>-<step>` with it, and a stock type step
// cannot without `--text-<step>`. So: every `--color-*` and `--text-*` the artifact
// carries must be one `src/styles.css` declares. Nothing about which file minted it,
// how the class string was written, or what it was escaped to.

/**
 * The one exception, and it is a real one rather than an allowance.
 *
 * `white` is Tailwind's, and this system paints it on purpose -- the payout figure
 * inside `tk-pane`, the fill of a raised card, the label on a filled danger button.
 * `PAIRS` measures it as a literal for exactly that reason. It is named here so that
 * the rule below can be an equality rather than a subtraction with a hole in it.
 */
const NOT_OURS_ON_PURPOSE = ['color-white']

function emittedTheme(): string {
  const dir = resolve(packageRoot, 'dist/analog/public/assets')
  expect(
    existsSync(dir),
    'no build to read — this guard asserts against the emitted stylesheet, and `pretest` builds it (R80)',
  ).toBe(true)
  const sheet = readdirSync(dir).filter((f) => f.endsWith('.css'))
  expect(sheet, 'the build emits exactly one stylesheet').toHaveLength(1)
  const body = readFileSync(resolve(dir, sheet[0]!), 'utf8')
  const root = /@layer theme\{:root,:host\{(.*?)\}\}/s.exec(body)
  expect(root, 'the emitted sheet has no theme layer; the artifact is not what this expects').not.toBeNull()
  return root![1]!
}

describe('no stock utility reaches the stylesheet', () => {
  const declared = new Set([...source.matchAll(/--((?:color|text)-[a-z0-9-]+):/g)].map((m) => m[1]!))
  const emitted = [...new Set([...emittedTheme().matchAll(/--((?:color|text)-[a-z0-9-]+):/g)].map((m) => m[1]!))]

  it('carries no colour or type variable this design system did not declare', () => {
    const foreign = emitted.filter((n) => !declared.has(n) && !NOT_OURS_ON_PURPOSE.includes(n)).sort()
    expect(
      foreign,
      'a stock utility is in the shipped sheet — the variable names the ramp or the step it came from',
    ).toEqual([])
  })

  /**
   * The guard's own vacuity check, and it is the one that matters most here: if the
   * theme layer stopped being found, or the regex stopped matching, `foreign` would be
   * empty and the test above would pass by looking at nothing. Both floors are facts
   * about this palette rather than counts that drift -- 21 ramp steps exist whether or
   * not a screen paints them, and the type roles are nine.
   */
  it('is reading a real theme layer', () => {
    expect(emitted.length, 'no theme variables found at all').toBeGreaterThanOrEqual(30)
    expect(emitted, 'the ink ramp is not in the sheet, so this is not our stylesheet').toContain('color-ink-900')
    expect(emitted).toContain('text-small')
  })

  /**
   * And the positive control, because the two above only prove the sheet is clean
   * today. A stock name has to be *rejected* by the same predicate that accepts ours,
   * or the rule is "everything passes" wearing a filter.
   */
  it('would reject a stock name if one appeared', () => {
    const stock = ['color-zinc-200', 'color-black', 'text-7xl', 'text-sm', 'color-red-500']
    expect(stock.filter((n) => !declared.has(n) && !NOT_OURS_ON_PURPOSE.includes(n)), 'the predicate accepts stock names').toEqual(stock)
    const ours = ['color-ink-900', 'color-signal-400', 'text-h1-public', 'text-caption', 'color-rejected-fg']
    expect(ours.filter((n) => !declared.has(n) && !NOT_OURS_ON_PURPOSE.includes(n)), 'the predicate rejects our own tokens').toEqual([])
  })
})

/**
 * Money in a column is set as data; money in a sentence is not.
 *
 * R325 chose `speech` as `tk-money`'s default and said plainly why that is the weaker
 * failure: a bold mono figure mid-sentence is obvious, **a column that does not align
 * is not**. It named this guard as the thing that should exist and did not. Writing it
 * before the 23 screens rather than after is the whole point -- every one of those
 * screens has figures in cells, and this defect is invisible in a diff.
 *
 * A cell carrying `colspan` is not a column: it is a full-width row holding prose, and
 * the two in `payouts.page.ts` hold a confirmation sentence. Money there is speech and
 * is correct. That distinction is why the rule is written against cells without a
 * `colspan` rather than against cells.
 */
const CELL = /<t[dh]\b[^>]*>[\s\S]*?<\/t[dh]>/g

describe('money in a column', () => {
  const wrong: string[] = []
  for (const { rel, body } of shipped) {
    for (const cell of body.match(CELL) ?? []) {
      if (!cell.includes('<tk-money')) continue
      if (/\bcolspan\b/.test(cell)) continue
      if (!cell.includes('voice="data"')) wrong.push(`${rel}: ${cell.slice(0, 60).replace(/\s+/g, ' ')}`)
    }
  }

  it('is set as data, so the figures align with each other', () => {
    expect(wrong.sort(), 'a figure in a column still set as speech does not align with the one below it').toEqual([])
  })

  it('is looking at the cells that exist', () => {
    const cells = shipped.flatMap(({ body }) => (body.match(CELL) ?? []).filter((c) => c.includes('<tk-money')))
    expect(cells.length, 'no money cells found at all, so the check above proved nothing').toBeGreaterThanOrEqual(5)
  })
})
/**
 * A price is a function of the contract, never a string in a page (R58).
 *
 * `/buyers` was typed in until the migration reached it, and the prices happened to
 * be right the whole time -- `landing.spec.ts` derives them from `quoteStudy` and
 * compares, so a `PRICING` move would have reddened the spec rather than shipping a
 * wrong page. That is the safety net working, not the rule being kept, and the
 * difference matters: a net catches a change to `PRICING`, and it does not catch a
 * page nobody wrote a comparison for. `/developers` was the page nobody wrote one
 * for in both directions at once -- its three figures were literals, and the only
 * thing holding them to the contract was an assertion someone had remembered to
 * write. This guard needs nobody to remember.
 *
 * Comments are stripped first. Prose explaining where a figure came from is not a
 * figure, and this file would otherwise flag its own history.
 *
 * Two idioms are allowed, and neither is a Tickover price: an advertising CPM,
 * which is the comparison `/developers` and the landing page both draw and has
 * nothing in the contract to come from, and what Tickover takes on a first study,
 * which is nothing. A zero is not a figure that can drift.
 *
 * The share and the daily cap are figures too and are not `$`-shaped, so this
 * catches neither; `landing.spec.ts` derives both and compares.
 */
const NOT_A_TICKOVER_PRICE = ['$0.002 an ad', 'we take $0']
const TYPED_MONEY = /\$ ?\d/g

function withoutComments(body: string): string {
  return body
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    // Not a bare `//`: every site URL in this package contains one, and eating the
    // rest of those lines would hide a figure rather than a comment.
    .replace(/(?<!:)\/\/.*/g, '')
}

/**
 * The exact spans the exempt idioms occupy, so a figure is exempt only when it is
 * *inside* one.
 *
 * This was a 26-character window around the match, and a window is not a span: the
 * branch review found `we take $0, $0.50 each` exempting both figures, because the
 * second one's window still reached back far enough to see the idiom. Two characters
 * of phrasing was the whole margin. No phrasing on any page today falls in that gap,
 * which is exactly why it was worth closing rather than noting -- the hole was
 * invisible from the outside and it was on the money guard.
 */
function exemptSpans(text: string): Array<[number, number]> {
  const spans: Array<[number, number]> = []
  for (const idiom of NOT_A_TICKOVER_PRICE) {
    for (let at = text.indexOf(idiom); at !== -1; at = text.indexOf(idiom, at + 1)) {
      spans.push([at, at + idiom.length])
    }
  }
  return spans
}

describe('money on a page', () => {
  const typed: string[] = []
  for (const { rel, body } of shipped) {
    const text = withoutComments(body)
    const spans = exemptSpans(text)
    for (const m of text.matchAll(TYPED_MONEY)) {
      if (spans.some(([from, to]) => m.index >= from && m.index < to)) continue
      typed.push(`${rel}: ${text.slice(m.index, m.index + 40).replace(/\s+/g, ' ')}`)
    }
  }

  it('is drawn from the contract, not typed into the template', () => {
    expect(typed.sort(), 'a price typed into a page is a price that can disagree with what the server charges').toEqual([])
  })

  /**
   * The non-emptiness check the first version of this guard did not have, and every
   * sibling in this file does.
   *
   * Forcing `shippedSources()` to return nothing left four tests red and this one
   * green: it was covered by its neighbours rather than by itself, which is the shape
   * of the vacuous tests this repository keeps shipping. Written as "both exempt
   * idioms were found" rather than a file count, so it does a second job: an idiom
   * that stops appearing on any page is a stale exemption widening the guard for
   * nothing, and this says so.
   */
  it('is reading the shipped screens, and both exemptions still earn their place', () => {
    expect(shipped.length, 'no shipped sources found at all, so the check above scanned nothing').toBeGreaterThan(20)
    const all = shipped.map(({ body }) => withoutComments(body)).join('\n')
    for (const idiom of NOT_A_TICKOVER_PRICE) {
      expect(all, `nothing says "${idiom}" any more, so the exemption is stale`).toContain(idiom)
    }
  })

  it('would see one if it were there, and exempts a span rather than a neighbourhood', () => {
    const planted = withoutComments('<p>$1.00 per response</p>')
    expect([...planted.matchAll(TYPED_MONEY)], 'the pattern matches nothing at all').toHaveLength(1)

    // The hole the branch review found, stated as the test that would have caught it:
    // a real price two characters from an exempt idiom used to be exempted with it.
    const beside = 'we take $0, $0.50 each'
    const spans = exemptSpans(beside)
    const caught = [...beside.matchAll(TYPED_MONEY)]
      .filter((m) => !spans.some(([from, to]) => m.index >= from && m.index < to))
      .map((m) => beside.slice(m.index, m.index + 5))
    expect(caught, 'a price beside an exempt idiom is exempted with it').toEqual(['$0.50'])
  })
})
