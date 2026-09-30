/**
 * The whole server, for the smoke suite. Every request the app makes is answered
 * here, so the suite needs no NestJS, no Postgres and no Docker, and nothing it
 * does can reach the internet.
 *
 * It is a stand-in for the server, not for the contract: study views are built from
 * what the wizard actually posted and priced with `quoteStudy`, so a page that
 * printed a hardcoded amount instead of the one it was sent would show a figure
 * this file never produced.
 */
import type { Page, Route } from '@playwright/test'
import { StudyInput, quoteStudy, type StudyView } from '@tickover/contract'
import { PORT } from './static-server'

/**
 * The three principals, and why all three can be signed in at once.
 *
 * No route redirects a signed-in principal away from anything — `auth.ts`'s guards
 * redirect on a 401 and on nothing else, and the two login pages carry no guard of
 * their own. So one mock can answer for every screen in the product, including the
 * login forms, which is what lets the measure sweep visit all 22 routes in one pass
 * instead of one session per area.
 */
const DEVELOPER = {
  id: '4c1d6a7e-9b2f-4c3d-8e5a-1f2b3c4d5e6f',
  github_login: 'tickover-e2e',
  balance_pending_cents: 50,
  balance_available_cents: 1250,
  today_paid_answers: 3,
  activity_tier: 'regular',
  can_cash_out: true,
  payout_method: { type: 'paypal', email: 'dev@example.test' },
} as const

const HISTORY = {
  rows: [
    { answered_at: '2026-09-18T09:12:00.000Z', sponsor: 'Acme Analytics', study_title: 'Tagline test', kind: 'choice', cents: 50, status: 'pending', source: 'pane' },
    { answered_at: '2026-09-17T14:02:00.000Z', sponsor: 'Tickover', study_title: 'Panel profile', kind: 'profile', cents: 0, status: 'unpaid', source: 'claude' },
    { answered_at: '2026-09-16T11:40:00.000Z', sponsor: 'Northwind', study_title: 'Pricing pulse', kind: 'choice', cents: 50, status: 'released', source: 'vscode' },
  ],
  next_cursor: null,
} as const

const DATA_SUMMARY = {
  github_login: DEVELOPER.github_login,
  os: 'win32',
  tool_version: '2.1.278',
  country: 'VN',
  language_mix: { ts: 412, md: 88, css: 31 },
  turns_recorded: 531,
  answers_recorded: 12,
  first_seen_at: '2026-08-02T08:00:00.000Z',
  last_seen_at: '2026-09-18T09:12:00.000Z',
} as const

const ADMIN_DEVELOPERS = [
  { id: DEVELOPER.id, github_login: DEVELOPER.github_login, status: 'active', flag_reason: null, country: 'VN', activity_tier: 'regular', created_at: '2026-08-02T08:00:00.000Z', last_seen_at: '2026-09-18T09:12:00.000Z' },
  { id: '5d2e7b8f-0c3a-4d4e-9f6b-2a3c4d5e6f70', github_login: 'someone-else', status: 'flagged', flag_reason: 'Two attention checks wrong in one week', country: 'DE', activity_tier: 'light', created_at: '2026-08-20T08:00:00.000Z', last_seen_at: null },
] as const

/**
 * `artifact` is the CSV **content**, not a filename: `payouts.ts:77` stores what the
 * adapter produced and `payouts.page.ts:186` hands it straight to `saveAs` as the file
 * body. A filename here made the page look right while downloading a one-line file
 * containing its own name.
 */
const BATCHES = [
  { batch_id: 'pb_2026_09', adapter: 'manual-csv', count: 4, total_cents: 6200, artifact: 'email,cents\ndev@example.test,1250\nsomeone@example.test,4950\n', created_at: '2026-09-01T00:00:00.000Z', paid_at: null, failed_at: null },
  { batch_id: 'pb_2026_08', adapter: 'manual-csv', count: 3, total_cents: 4500, artifact: 'email,cents\ndev@example.test,4500\n', created_at: '2026-08-01T00:00:00.000Z', paid_at: '2026-08-03T09:00:00.000Z', failed_at: null },
] as const

/**
 * One problem, not none. An invariants page reporting a clean ledger renders a
 * single line and sweeps clean past any check of what it says when something is
 * wrong — and what it says when something is wrong is the prose worth measuring.
 */
const INVARIANTS = {
  ok: false,
  // Quoted from `packages/server/src/domain/invariants.ts`, not invented: the longest
  // of the four strings it emits, carrying two UUIDs. A fixture longer than anything
  // the server writes would make the page's cap look necessary when it was not.
  problems: [`answer 7c9a1b3d-2e4f-4a6b-8c0d-1e2f3a4b5c6d settled 2 times for developer ${DEVELOPER.id}`],
} as const

/**
 * Where the built artifact posts the waitlist during the suite. Same origin on
 * purpose: a cross-origin JSON POST is a preflighted request, and a preflight is
 * not something `page.route` reliably answers.
 *
 * `playwright.config.ts` bakes this into the build through
 * `VITE_WAITLIST_ENDPOINT`, which is why the suite can exercise the success path at
 * all — the variable is unset in this repo, and `submitWaitlist` reports an unset
 * endpoint as a failure rather than pretending to send.
 */
export const WAITLIST_ENDPOINT = `http://127.0.0.1:${PORT}/e2e/waitlist`

const BUYER = {
  id: '8f0b0f2e-6f6a-4a3a-9c1f-0f1e2d3c4b5a',
  email: 'pm@acme.test',
  org: null,
  credit_cents: 10_000,
  first_study_used: false,
} as const

/** Stable so a URL assertion can name it; a real server would mint one per row. */
export const STUDY_ID = '22222222-2222-4222-8222-222222222222'
const QUESTION_ID = '11111111-1111-4111-8111-111111111111'

export const AGGREGATE_QUESTION = {
  question_id: '33333333-3333-4333-8333-333333333333',
  text: 'Which model do you use most?',
  options: ['Opus', 'Sonnet'],
  counts: [30, 10],
  total: 40,
}

/**
 * A study the server would already be holding, for the screens that are only
 * reachable when one exists: the buyer's study page, the review queue, the system
 * studies list. Built with `quoteStudy` like `studyFrom` below, for the same reason.
 */
const LIVE_QUOTE = quoteStudy({ targeted: true, atCost: false })
export const LIVE_STUDY: StudyView = {
  id: STUDY_ID,
  kind: 'paid',
  state: 'live',
  title: 'Tagline test',
  sponsor: 'Acme Analytics',
  price_cents: LIVE_QUOTE.priceCents,
  developer_cents: LIVE_QUOTE.developerCents,
  at_cost: false,
  target_count: 50,
  respondents_completed: 18,
  hold_cents: LIVE_QUOTE.priceCents * 50,
  charged_cents: LIVE_QUOTE.priceCents * 18,
  refunded_cents: 0,
  targeting: { languages: ['ts'], countries: ['VN', 'DE'], activity_tiers: ['regular'], os: ['win32'] },
  questions: [
    { id: QUESTION_ID, position: 0, text: 'Which database do you reach for on a new side project?', options: ['Postgres', 'SQLite', 'MySQL'], context: 'Answer for a project you would start this month, not one you maintain.' },
  ],
  review_note: null,
  created_at: '2026-09-10T10:00:00.000Z',
  live_at: '2026-09-12T10:00:00.000Z',
  closed_at: null,
  amount_due_cents: 0,
  payment_reference: null,
  payment_instructions: null,
  paypal_available: false,
}

const REVIEW_STUDY: StudyView = {
  ...LIVE_STUDY,
  id: '44444444-4444-4444-8444-444444444444',
  state: 'in_review',
  title: 'Pricing pulse',
  sponsor: 'Northwind',
  respondents_completed: 0,
  charged_cents: 0,
  live_at: null,
}

const PROFILE_STUDY: StudyView = {
  ...LIVE_STUDY,
  id: '55555555-5555-4555-8555-555555555555',
  kind: 'profile',
  title: 'Panel profile',
  sponsor: 'Tickover',
  price_cents: 0,
  developer_cents: 0,
  hold_cents: 0,
  charged_cents: 0,
  targeting: null,
}

const RESULTS = {
  study_id: STUDY_ID,
  respondents_completed: 18,
  valid_responses: 17,
  breakdown_state: 'withheld_until_settled',
  questions: [
    { question_id: QUESTION_ID, position: 0, text: LIVE_STUDY.questions[0]!.text, options: LIVE_STUDY.questions[0]!.options, counts: [11, 4, 2], breakdown: {} },
  ],
} as const

export interface MockState {
  /** What the built page actually put on the wire, in order. */
  waitlistPosts: Array<{ email?: unknown; audience?: unknown }>
  studies: StudyView[]
  /** Any `/api/**` path this file has no answer for. A non-empty list is a defect in one of the two. */
  unhandled: string[]
  /** Whether `/submit` answers with a study still needing payment rather than `in_review`. */
  uncovered: boolean
}

export interface MockOptions {
  signedIn?: boolean
  /** The developer web session, and the admin one. Independent of `signedIn`: they are three principals, not three levels. */
  devSignedIn?: boolean
  adminSignedIn?: boolean
  /** Studies the buyer already has. Empty is the wizard's starting point and renders the empty state. */
  studies?: StudyView[]
  /**
   * Exact `/api/...` paths to answer 500, ahead of every other branch.
   *
   * For proving a guard fires rather than for describing a server: a screen that
   * cannot load says so in its own way, and a sweep that cannot see it says nothing.
   */
  failing?: string[]
  /** The waitlist endpoint's reply. 500 is what proves the success assertion is not vacuous. */
  waitlistStatus?: number
  /** A submit the credit does not cover: the study comes back `awaiting_payment` rather than `in_review`. */
  uncovered?: boolean
  /** R505: whether a waiting study offers `paypal_available: true`, and the order route answers. */
  paypal?: boolean
  /** R514: whether the first payout batch is one the server calls sendable via PayPal. */
  sendableBatch?: boolean
}

/**
 * A study as the server would return it for what the wizard posted.
 *
 * `at_cost` follows the buyer's entitlement rather than being fixed, and the price
 * comes from `quoteStudy` with the study's own targeting — the four configurations
 * are 55c, 80c, $1.00 and $1.50, and a mock that answered one of them for all four
 * would let a page that ignores `price_cents` pass (R58).
 */
function studyFrom(input: unknown, state: StudyView['state']): StudyView {
  const parsed = StudyInput.parse(input)
  const targeted = parsed.targeting !== undefined
  const atCost = !BUYER.first_study_used
  const quote = quoteStudy({ targeted, atCost })
  return {
    id: STUDY_ID,
    kind: 'paid',
    state,
    title: parsed.title,
    sponsor: parsed.sponsor,
    price_cents: quote.priceCents,
    developer_cents: quote.developerCents,
    at_cost: atCost,
    target_count: parsed.target_count,
    respondents_completed: 0,
    hold_cents: state === 'draft' ? 0 : quote.priceCents * parsed.questions.length * parsed.target_count,
    charged_cents: 0,
    refunded_cents: 0,
    targeting: parsed.targeting ?? null,
    questions: parsed.questions.map((q, position) => ({
      id: QUESTION_ID,
      position,
      text: q.text,
      options: q.options,
      context: q.context ?? null,
    })),
    review_note: null,
    created_at: '2026-09-10T10:00:00.000Z',
    live_at: null,
    closed_at: null,
    amount_due_cents: 0,
    payment_reference: null,
    payment_instructions: null,
    paypal_available: false,
  }
}

export async function mockApi(page: Page, opts: MockOptions = {}): Promise<MockState> {
  const signedIn = opts.signedIn ?? false
  const devSignedIn = opts.devSignedIn ?? false
  const adminSignedIn = opts.adminSignedIn ?? false
  const waitlistStatus = opts.waitlistStatus ?? 200
  const paypal = opts.paypal ?? false
  const state: MockState = { waitlistPosts: [], studies: [...(opts.studies ?? [])], unhandled: [], uncovered: opts.uncovered ?? false }
  // Mutable, unlike `BATCHES` itself: a send has to be reflected on the next list
  // fetch, the way `state.studies` reflects a create, or the button this page
  // put up after Send would revert to the one that put it there (R514).
  let batchRows: unknown[] = opts.sendableBatch ? [{ ...BATCHES[0], sendable: true }, BATCHES[1]] : [...BATCHES]

  const json = (route: Route, status: number, body: unknown) =>
    route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })

  await page.route('**/e2e/waitlist', async (route) => {
    state.waitlistPosts.push((route.request().postDataJSON() ?? {}) as MockState['waitlistPosts'][number])
    await json(route, waitlistStatus, waitlistStatus === 200 ? { ok: true } : { error: 'nope' })
  })

  const failing = new Set(opts.failing ?? [])

  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname
    const method = route.request().method()

    // Ahead of everything, so a forced failure is not accidentally shadowed by a
    // branch that happens to match the same path.
    if (failing.has(path)) return json(route, 500, { error: 'forced' })

    if (path === '/api/buyer/me') {
      return signedIn ? json(route, 200, BUYER) : json(route, 401, { error: 'unauthorized' })
    }
    if (path === '/api/buyer/studies' && method === 'GET') return json(route, 200, state.studies)
    if (path === '/api/buyer/studies' && method === 'POST') {
      // The real endpoint requires it, so a client that stopped sending it would get a
      // 400 in production and a green suite here. This is the only place the header is
      // watched through a real browser rather than through a mocked HttpClient.
      if (!(route.request().headers()['idempotency-key'] ?? '').trim()) {
        return json(route, 400, { error: 'idempotency_key_required' })
      }
      let study: StudyView
      try {
        study = studyFrom(route.request().postDataJSON(), 'draft')
      } catch (e) {
        // The server answers a body the contract rejects with a 400, and so does
        // this. Throwing out of the handler instead would leave the route
        // unfulfilled and the browser waiting, which reads as a hung page rather
        // than as a wizard that sent something invalid.
        return json(route, 400, { error: 'invalid_study', detail: String(e) })
      }
      state.studies.unshift(study)
      return json(route, 200, study)
    }
    if (path === '/api/buyer/studies/estimate') {
      return json(route, 200, { reachable_developers: 120, estimated_fill_hours: 40 })
    }
    if (path.endsWith('/submit')) {
      const draft = state.studies[0]
      if (!draft) return json(route, 404, { error: 'not_found' })
      const sent = state.uncovered
        ? { ...draft, state: 'awaiting_payment' as const, amount_due_cents: 2800, payment_reference: 'TKO-TEST0001', payment_instructions: 'Bank A\nAccount 123', paypal_available: paypal }
        : { ...draft, state: 'in_review' as const }
      state.studies[0] = sent
      return json(route, 200, sent)
    }
    // R505: the buyer clicks "Pay with PayPal" and the page redirects to this url --
    // `buyer.spec.ts` asserts the real navigation, so the token is fixed rather than random.
    if (path.endsWith('/paypal/order') && method === 'POST') {
      return json(route, 200, { approve_url: 'https://www.sandbox.paypal.com/checkoutnow?token=ORDER-E2E' })
    }
    // Before the study-by-id branch, which this path also starts with: answering it
    // with a StudyView leaves the page parsing a study as results, and the page
    // renders the failure rather than the screen.
    if (path.endsWith('/results')) {
      const study = state.studies[0]
      return study ? json(route, 200, { ...RESULTS, study_id: study.id }) : json(route, 404, { error: 'not_found' })
    }
    if (path.startsWith('/api/buyer/studies/')) {
      const study = state.studies[0]
      return study ? json(route, 200, study) : json(route, 404, { error: 'not_found' })
    }
    if (path === '/api/buyer/payments') return json(route, 200, [])

    // The developer web session. `tickover web` trades the CLI token for a link and
    // everything past that is a cookie, so from the page's side it is just these.
    if (path === '/api/dev/web/me') {
      return devSignedIn ? json(route, 200, DEVELOPER) : json(route, 401, { error: 'unauthorized' })
    }
    if (path === '/api/dev/web/history') return json(route, 200, HISTORY)
    if (path === '/api/dev/web/data') return json(route, 200, DATA_SUMMARY)

    if (path === '/api/admin/me') {
      return adminSignedIn ? json(route, 200, { ok: true }) : json(route, 401, { error: 'unauthorized' })
    }
    if (path === '/api/admin/studies') {
      // The queue and the live list are two calls to one path, told apart by the
      // query. Answering both with the same rows would let a page that ignores the
      // state it asked for pass.
      const wanted = new URL(route.request().url()).searchParams.get('state')
      const rows = wanted === 'live' ? [LIVE_STUDY] : wanted === 'in_review' ? [REVIEW_STUDY] : [LIVE_STUDY, REVIEW_STUDY]
      return json(route, 200, rows)
    }
    if (path === '/api/admin/system-studies') return json(route, 200, [PROFILE_STUDY])
    if (path === '/api/admin/developers') return json(route, 200, ADMIN_DEVELOPERS)
    if (path === '/api/admin/payouts/batches' && method === 'GET') return json(route, 200, batchRows)
    if (path.startsWith('/api/admin/payouts/batches/') && path.endsWith('/send') && method === 'POST') {
      const sent = { ...BATCHES[0], sent_at: '2026-09-10T11:00:00.000Z', provider_batch_id: 'PB-1', confirmed: true, sendable: false, refreshable: true }
      batchRows = [sent, BATCHES[1]]
      return json(route, 200, sent)
    }
    if (path === '/api/admin/invariants') return json(route, 200, INVARIANTS)
    if (path === '/api/public/aggregates') {
      return json(route, 200, { generated_at: '2026-09-10T10:00:00.000Z', questions: [AGGREGATE_QUESTION] })
    }

    // Recorded rather than swallowed: a page that starts calling something new
    // should show up as a named path in a failing assertion, not as a silent 404
    // the page renders an error for.
    state.unhandled.push(`${method} ${path}`)
    return json(route, 404, { error: 'not_found' })
  })

  return state
}
