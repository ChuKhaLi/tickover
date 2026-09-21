export const RULES = {
  MIN_TURN_SECONDS: 8,
  MAX_PAID_PER_DAY: 10,
  MIN_GAP_MINUTES: 5,
  SESSION_WARMUP_MINUTES: 2,
  SKIP_STREAK: 2,
  SKIP_PAUSE_MINUTES: 60,
  PROFILE_MAX_PER_DAY: 1,
  RESERVATION_MINUTES: 10,
  LATE_GRACE_MINUTES: 5,
  MIN_LATENCY_MS: 1000,
  ATTENTION_NEW_THRESHOLD: 20,
  ATTENTION_RATE_NEW: 10,
  ATTENTION_RATE_ESTABLISHED: 30,
  ATTENTION_FAILS_TO_EXCLUDE: 2,
  PAYOUT_MIN_CENTS: 1000,
  GITHUB_MIN_AGE_MONTHS: 6,
  LONG_POLL_SECONDS: 25,
  LONG_POLL_INTERVAL_MS: 3000,
  STATUS_LINE_MAX_COLUMNS: 80,
  QUESTION_TEXT_MAX: 120,
  OPTION_TEXT_MAX: 40,
  CONTEXT_MAX: 200,
  ACTIVE_WINDOW_DAYS: 14,
} as const

export const PRICING = {
  BASE_CENTS: 100,
  TARGETING_CENTS: 50,
  DEVELOPER_SHARE: 0.5,
  AT_COST_FEE_CENTS: 5,
  MIN_RESPONDENTS: 50,
  MAX_RESPONDENTS: 500,
} as const

export interface StudyQuote {
  priceCents: number
  developerCents: number
}

export function quoteStudy(input: { targeted: boolean; atCost: boolean }): StudyQuote {
  const full = PRICING.BASE_CENTS + (input.targeted ? PRICING.TARGETING_CENTS : 0)
  const developerCents = Math.floor(full * PRICING.DEVELOPER_SHARE)
  const priceCents = input.atCost ? developerCents + PRICING.AT_COST_FEE_CENTS : full
  return { priceCents, developerCents }
}

/**
 * The one domain this product owns, and the only one a shipped surface may name.
 *
 * This exists because the previous domain belonged to somebody else. `api.<that domain>` was the
 * daemon's `DEFAULT_SERVER_URL` -- the value written into every fresh install's `config.json`, with
 * no environment override, read once at daemon start -- so an A record added by that domain's owner
 * would have pointed every default install at their host, carrying the disclosure payload and the
 * API token. It failed closed only because the subdomain happened not to resolve (R137). The
 * consent screen pointed at their `/privacy`, and the privacy contact and the account-appeal route
 * were both an address on their domain.
 *
 * Fourteen surfaces named it and none of them agreed with anything. `domain.test.ts` now holds every
 * hostname and address in shipped source to these values, including the surfaces that cannot import
 * anything: two package manifests, the setup skill's consent paragraph and the web templates.
 */
export const SITE = {
  DOMAIN: 'tickover.dev',
  ORIGIN: 'https://tickover.dev',
  /** Where a fresh install points before anyone edits `config.json`. */
  API_ORIGIN: 'https://api.tickover.dev',
  /** The privacy contact on /privacy, and the appeal route on /terms/developers. */
  CONTACT_EMAIL: 'hello@tickover.dev',
} as const
