/**
 * The landing hero's sequence as a pure function of elapsed time (R384).
 *
 * The page never decides what is on screen at a given moment; it asks this. That keeps the beats,
 * the final frame and the row's honesty checkable without a browser, and it keeps the clock
 * (`hero-player.ts`) from knowing anything about what it is playing.
 *
 * Tailwind scans this file (R47): the words the frame uses for "on screen" are `shown` and
 * `running`, because the obvious English ones are utility names and would mint rules into the
 * shipped sheet.
 */
import type { Flash } from '../ui/pane'

export const PROMPT = 'refactor the auth module to use the new token flow'
export const SPINNER_TEXT = 'Reworking the refresh flow…'
export const TOOL_LINES = ['Read src/auth/session.ts (142 lines)', 'Updated src/auth/tokens.ts'] as const

/**
 * Claude Code's own spinner glyphs, and the one it holds when the work settles. The middle dot is
 * left out of the cycle: design system 7 gives it to the status line alone, and the tokens.spec
 * middle-dot guard is right to hold that line -- escaping the character to dodge the guard would
 * not satisfy it.
 */
const SPINNER_GLYPHS = ['✢', '✳', '✶', '✻', '✽'] as const
const SPINNER_STILL = '✻'
const SPINNER_STEP_MS = 120
const FLASH_MS = 600

/** Milliseconds from the moment the pane came into view. The spec's storyboard, verbatim. */
export const AT = {
  typeFrom: 300,
  typeTo: 2000,
  submit: 2200,
  spinner: 2400,
  tool1: 2900,
  tool2: 4000,
  question: 4800,
  credited: 7800,
  end: 9800,
} as const
export const DURATION_MS = AT.end

/** The page's existing figures: one more paid answer today, and its payout pending. */
const BEFORE = { todayPaid: 3, pendingCents: 250 } as const
const AFTER = { todayPaid: 4, pendingCents: 300 } as const
export const AVAILABLE_CENTS = 1000

export type RowState = 'idle' | 'question' | 'credited'

export interface HeroFrame {
  /** Characters of `PROMPT` in the prompt box. Zero once it has been sent. */
  typed: number
  /** Whether `PROMPT` has moved into the transcript. */
  submitted: boolean
  /** How many of `TOOL_LINES` have arrived. */
  tools: number
  spinner: { shown: boolean; glyph: string; seconds: number; running: boolean }
  row: RowState
  todayPaid: number
  pendingCents: number
  flash: Flash
}

function compute(ms: number): HeroFrame {
  const t = Math.max(0, ms)
  const submitted = t >= AT.submit
  const typing = Math.floor(((t - AT.typeFrom) * PROMPT.length) / (AT.typeTo - AT.typeFrom))
  const typed = submitted || t < AT.typeFrom ? 0 : Math.min(PROMPT.length, typing)
  const running = t >= AT.spinner && t < AT.end
  const glyph = running
    ? SPINNER_GLYPHS[Math.floor((t - AT.spinner) / SPINNER_STEP_MS) % SPINNER_GLYPHS.length]!
    : SPINNER_STILL
  const seconds = submitted ? Math.floor((Math.min(t, AT.end) - AT.submit) / 1000) : 0
  const row: RowState = t >= AT.end ? 'idle' : t >= AT.credited ? 'credited' : t >= AT.question ? 'question' : 'idle'
  const flash: Flash =
    t >= AT.question && t < AT.question + FLASH_MS ? 'row'
    : t >= AT.credited && t < AT.credited + FLASH_MS ? 'money'
    : 'none'
  return {
    typed,
    submitted,
    tools: t >= AT.tool2 ? 2 : t >= AT.tool1 ? 1 : 0,
    spinner: { shown: t >= AT.spinner, glyph, seconds, running },
    row,
    ...(t >= AT.credited ? AFTER : BEFORE),
    flash,
  }
}

/**
 * What the prerender emits, what reduced motion shows, and what the sequence ends on. One frame
 * for all three, so hydration never swaps one picture for another.
 */
export const FINAL_FRAME: HeroFrame = compute(DURATION_MS)

/** After a width drag: the settled session, with the question back on the row, which has rungs to fall through. */
export const DRAGGED_FRAME: HeroFrame = { ...FINAL_FRAME, row: 'question' }

export function frameAt(ms: number): HeroFrame {
  return ms >= DURATION_MS ? FINAL_FRAME : compute(ms)
}

export interface PaneInputs {
  showQuestion: boolean
  answeredCents: number | null
  todayPaid: number
  pendingCents: number
}

/** The frame's row, as the inputs `tk-pane` composes from. The pane, not this, decides the text. */
export function paneInputs(f: HeroFrame, payoutCents: number): PaneInputs {
  return {
    showQuestion: f.row === 'question',
    answeredCents: f.row === 'credited' ? payoutCents : null,
    todayPaid: f.todayPaid,
    pendingCents: f.pendingCents,
  }
}
