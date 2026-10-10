import type { Type } from '@angular/core'
import { TestBed } from '@angular/core/testing'
import { provideRouter } from '@angular/router'
import { describe, it, expect } from 'vitest'
import { PRICING, RULES, SITE, quoteStudy } from '@tickover/contract'
import PrivacyPage from './privacy.page'
import DevelopersPage from './developers.page'
import DeveloperTermsPage from './terms/developers.page'
import BuyerTermsPage from './terms/buyers.page'
import { formatCents } from '../lib/money'
import { PAGE_META } from '../lib/page-meta'

/**
 * Spec §7's "Legal minimum": developer terms (independent-contractor earnings), a
 * privacy page mirroring the consent screen, and buyer terms banning personal-data
 * harvesting. None of the three existed when plan 2 merged, and Phase 0 collects
 * email addresses, so the privacy page is the one that gates the outreach.
 *
 * Two rules from this branch apply to every assertion below.
 *
 * R58 — a price is a function of the configuration, never a constant. Every figure
 * is computed from the contract on both sides, as `landing.spec.ts` does, because
 * seven money-copy defects on the plan-2 branch were all literals.
 *
 * The prose is the opposite: it is pinned as literals, because these pages *are*
 * the promise. A test that rebuilt the sentence from the same source the page
 * renders would follow a narrowed disclosure straight down, which is the hole the
 * consent screen sat in for a whole branch.
 */
const full = quoteStudy({ targeted: false, atCost: false })
const atCost = quoteStudy({ targeted: false, atCost: true })

// The three spec §5.5 lists, quoted. `packages/contract`'s DISCLOSURE is what the
// pages render; these literals are what stops it being narrowed in one commit.
const SENT = 'GitHub id, operating system, Claude Code version, when each turn starts and stops, the Claude Code session id and when that session started, counts of file extensions in your project directory, which questions you skip, and your answers with how long you took and where you answered them (terminal pane, local page, VS Code, or inside Claude Code)'
const DERIVED = 'your country, from the IP address of the request, and an activity tier from how many turns you run a week (light under 5, regular 5 to 20, heavy over 20)'
const NEVER = 'prompts, file contents, file paths, repository names, repository owners, or transcripts'

function textOf<T>(page: Type<T>): string {
  TestBed.resetTestingModule()
  TestBed.configureTestingModule({ providers: [provideRouter([])] })
  const fixture = TestBed.createComponent(page)
  fixture.detectChanges()
  return ((fixture.nativeElement as HTMLElement).textContent ?? '').replace(/\s+/g, ' ')
}

function normalize(text: string | null | undefined): string {
  return (text ?? '').replace(/\s+/g, ' ').trim()
}

function elementOf<T>(page: Type<T>): HTMLElement {
  TestBed.resetTestingModule()
  TestBed.configureTestingModule({ providers: [provideRouter([])] })
  const fixture = TestBed.createComponent(page)
  fixture.detectChanges()
  return fixture.nativeElement as HTMLElement
}

/** The whole rendered text of the buyer terms page — for a negative claim, which needs the
 * whole page rather than one section, since it says a word appears nowhere on it. */
function pageText(): string {
  return textOf(BuyerTermsPage)
}

/** The paragraph immediately after the heading `headingSelector` names, on the buyer terms
 * page. Scoped to that one element (R99), rather than the whole page, because the claim is
 * about what that paragraph says. */
function paragraphAfter(headingSelector: string): string {
  const heading = elementOf(BuyerTermsPage).querySelector(headingSelector)
  expect(heading, `no heading matching ${headingSelector}`).not.toBeNull()
  return normalize(heading!.nextElementSibling?.textContent)
}

/** Every sibling between the heading `headingSelector` names and the next h2, on the buyer
 * terms page — the section that heading owns. */
function sectionText(headingSelector: string): string {
  const heading = elementOf(BuyerTermsPage).querySelector(headingSelector)
  expect(heading, `no heading matching ${headingSelector}`).not.toBeNull()
  const parts: string[] = []
  let node = heading!.nextElementSibling
  while (node && node.tagName !== 'H2') {
    parts.push(node.textContent ?? '')
    node = node.nextElementSibling
  }
  return normalize(parts.join(' '))
}

describe('the privacy page', () => {
  // Spec §7 says it mirrors the consent screen. Mirroring means the same three
  // lists, not a summary of them: this is the page a developer can read before
  // installing anything, so it is the only copy of the disclosure most of them
  // will see before agreeing to it.
  it('carries the same three lists as the consent screen and /developers', () => {
    const text = textOf(PrivacyPage)
    for (const claim of [SENT, DERIVED, NEVER]) {
      expect(text, 'the privacy page is missing one of spec 5.5s lists').toContain(claim)
    }
  })

  // Four surfaces now carry these lists. Reading two of them in one test is what
  // makes a one-page edit fail; `settings.page.spec.ts` does the same for the other
  // two, so no single page can be narrowed on its own.
  it('agrees with the public developers page word for word', () => {
    const privacy = textOf(PrivacyPage)
    const developers = textOf(DevelopersPage)
    for (const claim of [SENT, DERIVED, NEVER]) {
      expect(developers, 'the developers page moved and the privacy page did not follow').toContain(claim)
      expect(privacy).toContain(claim)
    }
  })

  // Deletion anonymises rather than erases (`deleteDeveloperAccount`), and the
  // settings page already says so to a signed-in developer. Someone deciding
  // whether to install has no account and cannot reach that page.
  it('says what deletion actually does, on both sides', () => {
    const text = textOf(PrivacyPage)
    expect(text).toContain('every turn we recorded')
    expect(text, 'the page implies deletion erases everything').toContain('accounting records')
    expect(text).not.toContain('erased')
    expect(text, 'a deleted account can silently never come back').toContain('cannot be used with Tickover again')
    // `deleteDeveloperAccount` revokes the bearer token, deletes every web session and
    // deletes any unspent login token. The settings page says so to someone signed in;
    // this page is the one read by someone who has no account to check it from.
    expect(text, 'nothing says access ends immediately').toContain('command-line token stops working')
  })

  // What a buyer receives is the question this page exists to answer, and the
  // honest answer is not "nothing": `resultsCsv` hands over one row per answer
  // with four segment columns. Naming the pseudonym is what makes the rest true.
  it('says exactly what a buyer receives, including the per-study pseudonym', () => {
    const text = textOf(PrivacyPage)
    expect(text).toContain('a different code in every study')
    expect(text, 'the GitHub login is not ruled out of buyer results').toContain('never your GitHub login')
  })

  // R912. The export's column is primary_language: topLanguages(languageMix, 1) in
  // domain/results.ts, a language name worked out from extension counts -- not an extension.
  it('names the language column a buyer receives as the language it is', () => {
    const el = elementOf(PrivacyPage)
    const heading = Array.from(el.querySelectorAll('h2')).find((h) => h.textContent?.trim() === 'What a buyer receives')
    const row = normalize(heading!.nextElementSibling?.textContent)
    expect(row).toContain('your primary programming language (the one with the most files in your file-extension counts)')
    expect(row).not.toContain('file extension,')
    expect(textOf(PrivacyPage)).toContain('Last updated 9 October 2026.')
  })

  /**
   * The review's Minor 5. `dev-web.test.ts` pins `SURVIVES = ['id', 'githubId', 'createdAt']`
   * and `dev/settings.page.ts` names all three; this page named only the GitHub id. Same
   * class as the deletion gap already closed here, and for the same reason: this is the page
   * read by someone with no account to check it from.
   */
  it('names every column the account row keeps, not just the one with a reason', () => {
    const keeps = textOf(PrivacyPage)
    for (const phrase of ['an internal id', 'the date you first signed up', 'your GitHub id']) {
      expect(keeps, `the Kept list does not name ${phrase}`).toContain(phrase)
    }
  })

  // R505/R508: PayPal is now a buyer payment option, not only a payout method, and
  // this is the entry it belongs to -- scoped to the entry itself (R99), so a claim
  // that is true only because the developer-payout bullet also says "PayPal" cannot
  // pass this test by accident.
  it('names PayPal in the Payments entry as a processor the buyer can choose', () => {
    const li = elementOf(PrivacyPage).querySelector('[data-privacy="payments"]')
    expect(li, 'no Payments entry with data-privacy="payments"').not.toBeNull()
    const text = normalize(li!.textContent)
    expect(text).toContain('PayPal')
    expect(text, 'the entry does not say what PayPal receives').toContain('name, email address and payment details')
    expect(text, 'the entry does not say what we receive back').toContain('payment reference and amount')
  })

  it('names the operator, the processors and a way to reach a person', () => {
    const text = textOf(PrivacyPage)
    expect(text).toContain('hello@tickover.dev')
    expect(text).toContain('Vietnam')
    for (const processor of ['GitHub', 'PayPal']) {
      expect(text, `${processor} handles personal data and is not named`).toContain(processor)
    }
    // R500: no merchant of record any more.
    expect(text, 'the privacy page still names a payment provider').not.toContain('Paddle')
    // R505: PayPal is the way to pay; bank transfer is not offered.
    expect(text, 'the privacy page does not say how buyers pay').toContain('buyers pay by PayPal')
    expect(text, 'the privacy page still offers bank transfer').not.toContain('bank transfer')
  })
})

describe('the developer terms', () => {
  // Spec §7 names this one by its substance: independent-contractor earnings. The
  // three claims below are the ones that make it that rather than employment.
  it('states the relationship is not employment', () => {
    const text = textOf(DeveloperTermsPage)
    expect(text).toContain('independent contractor')
    expect(text, 'the page does not rule out an employment relationship').toContain('not an employee')
    expect(text, 'nothing says answering is optional').toContain('no obligation')
    expect(text, 'tax responsibility is unstated').toContain('your own taxes')
  })

  /**
   * The branch review's Important 1. This page said "$0.50 per valid answer to a paid
   * study, which is 50% of what the buyer pays for it" — one `quoteStudy` configuration
   * rendered as if it covered all four. A targeted study pays the developer **75c**
   * (`buyer-studies.test.ts` asserts `developer_cents: 75`), and on an at-cost study the
   * developer keeps 91% of what the buyer paid, not 50%.
   *
   * The old assertion could not see it: it built the expected string from
   * `quoteStudy({ targeted: false, atCost: false })`, the identical call the page made,
   * so both sides moved together and neither could notice that three configurations were
   * missing. R58 one level up — not a literal, a constant *configuration* standing in for
   * a rule.
   *
   * So this enumerates the configurations instead, which is the thing the page does not
   * do, and asserts every distinct rate is named.
   */
  it('names the rate for every configuration a study can have, not one of them', () => {
    const text = textOf(DeveloperTermsPage)
    const rates = new Set<number>()
    for (const targeted of [false, true]) {
      for (const atCost of [false, true]) rates.add(quoteStudy({ targeted, atCost }).developerCents)
    }
    // Without this the loop below passes on a contract that pays one rate for everything.
    expect(rates.size, 'the contract no longer has two distinct developer rates').toBe(2)
    for (const cents of rates) {
      expect(text, `a study paying the developer ${formatCents(cents)} is not named`).toContain(formatCents(cents))
    }
    // The share as the contract's own constant. A ratio of one quote is a different
    // number on three of the four configurations.
    expect(text).toContain(`${PRICING.DEVELOPER_SHARE * 100}% of the study's list price`)
    expect(text, 'the share is stated against what the buyer paid, which is false at cost')
      .not.toContain('of what the buyer pays')
  })

  it('prices the work from the contract, not from copy', () => {
    const text = textOf(DeveloperTermsPage)
    expect(text).toContain(`${formatCents(full.developerCents)} per valid answer`)
    expect(text).toContain(`${RULES.MAX_PAID_PER_DAY} paid answers a day`)
    expect(text).toContain(`${formatCents(RULES.PAYOUT_MIN_CENTS)}`)
  })

  /**
   * Spec §4.3: "Cash-out requires a GitHub account at least 6 months old. Younger
   * accounts accrue but cannot withdraw until they age." `canCashOut` is the only
   * reader of the rule and it gates `createPayoutBatch`, not registration.
   *
   * The first draft of this page put the age under "who can take part", which would
   * have told a five-month-old account it may not answer at all. The distinction is
   * the whole content of the rule, so it is asserted rather than described.
   */
  it('says the account age gates withdrawal, not taking part', () => {
    const text = textOf(DeveloperTermsPage)
    expect(text).toContain(`younger than ${RULES.GITHUB_MIN_AGE_MONTHS} months can answer and earn like any other`)
    expect(text).toContain('cannot do yet is withdraw')
    // Spec §4.3's other promise, which nothing on any page read until now.
    expect(text, 'the fee promise is unstated').toContain('Payment fees never come out of your share.')
  })

  /**
   * The branch review's Minor 7. "Paid studies carry attention checks" claimed all of them.
   * `serveAssignment` injects one only when `study.kind === 'paid' && !study.atCost`, at most
   * once per developer per study, and only on a roll: `shouldInjectAttention` fires at
   * 1/ATTENTION_RATE_NEW while the developer has fewer than ATTENTION_NEW_THRESHOLD answers
   * and 1/ATTENTION_RATE_ESTABLISHED after. So it is occasional, not universal, and never in
   * an at-cost study at all.
   *
   * It matters more now that this page also says a second failure holds back the whole
   * balance: a developer told every paid study is checked will read that consequence as far
   * more likely than it is.
   */
  it('says how often an attention check actually appears, not that every study carries one', () => {
    const text = textOf(DeveloperTermsPage)
    expect(text, 'the page claims every paid study carries one').not.toContain('Paid studies carry attention checks')
    for (const figure of [RULES.ATTENTION_RATE_NEW, RULES.ATTENTION_RATE_ESTABLISHED, RULES.ATTENTION_NEW_THRESHOLD]) {
      expect(text, `the rate figure ${figure} is not stated`).toContain(`${figure}`)
    }
    expect(text, 'at-cost studies never carry one and the page does not say so').toContain('at cost')
    expect(text).toContain('once')
  })

  /**
   * The branch review's second round, and the reason this test is scoped to elements rather
   * than to page text.
   *
   * The first version of it asserted four substrings against the whole rendered page, and
   * **deleting the entire bullet it existed to guard left the suite at 23 passed**. Every one
   * of its assertions was satisfied by text that was already elsewhere on the page: `'2'` by
   * "Last updated 7 September 2026", `'every payout run'` by the closing-your-account bullet,
   * `'until'` by the account-age paragraph, and the negative by a different edit in the same
   * commit. A thirteenth test that asserted nothing, added in the commit that was fixing the
   * same class of defect.
   *
   * So each risk is a `[data-risk]` element and each assertion reads that element alone.
   * Deleting a bullet makes its query return null and the test red, which no amount of
   * coincidental wording elsewhere can satisfy.
   *
   * The three risks, executed against `decideValidity` rather than read off the page:
   *
   *     FIRST-EVER attention failure -> valid: ['att','real']  invalid: []      excluded: []
   *     SECOND attention failure     -> valid: []              invalid: both    excluded: ['d1']
   *
   * A single failure invalidates nothing — `settle.ts` releases every valid answer, so the
   * developer is *paid* for the check they got wrong. The threshold failure invalidates every
   * answer in that study, not "that answer". The page said the opposite of both.
   */
  it('states each way earnings can be taken back on its own bullet, and gets each one right', () => {
    TestBed.resetTestingModule()
    TestBed.configureTestingModule({ providers: [provideRouter([])] })
    const fixture = TestBed.createComponent(DeveloperTermsPage)
    fixture.detectChanges()
    const el = fixture.nativeElement as HTMLElement
    const risk = (name: string) => {
      const node = el.querySelector(`[data-risk="${name}"]`)
      expect(node, `the "${name}" bullet is not on the page at all`).not.toBeNull()
      return (node!.textContent ?? '').replace(/\s+/g, ' ')
    }

    // Per-answer, and the only one that is. `latencyMs < RULES.MIN_LATENCY_MS` marks that row.
    expect(risk('fast')).toContain('that one answer')
    expect(risk('fast')).toContain('reversed at settlement')

    // One failure costs nothing, which is the half the page had backwards.
    expect(risk('attention-once'), 'the page still implies a single failure is penalised').toContain('costs you nothing')
    expect(risk('attention-once')).toContain('still paid')

    // And the threshold, which is neither per-answer nor a ban.
    const threshold = risk('attention-threshold')
    expect(threshold).toContain(`${RULES.ATTENTION_FAILS_TO_EXCLUDE} of them wrong in total`)
    expect(threshold, 'the scope of the invalidation is understated').toContain('every answer you gave in the study')
    expect(threshold, 'nothing says the whole balance is held').toContain('your whole balance')
    expect(threshold, 'a flag is described as ending the account').toContain('keeps answering and keeps earning')
  })

  // The two ways money that looks earned can go away. Both are implemented
  // (`decideValidity` reverses a pending entry; `deleteDeveloperAccount` leaves the
  // account out of every payout run), and neither is obvious.
  it('says when earnings can be taken back', () => {
    const text = textOf(DeveloperTermsPage)
    expect(text).toContain('attention')
    expect(text, 'reversal after settlement is not disclosed').toContain('reversed')
    expect(text, 'deletion silently forfeits an unpaid balance').toContain('forfeited')
  })
})

describe('the buyer terms', () => {
  // Spec §7: "buyer terms banning personal-data harvesting". Spec §4.7 is the
  // review policy the operator actually applies, so the ban and the five grounds
  // are the same list on both sides of the transaction.
  it('bans harvesting personal data, in the words the review policy uses', () => {
    const text = textOf(BuyerTermsPage)
    expect(text).toContain('harvesting personal data')
    // Lowercased: what is asserted is that the ground is named, not where the
    // sentence it opens happens to start.
    const lower = text.toLowerCase()
    for (const ground of ['political', 'adult', 'deceptive framing', 'hidden sponsor']) {
      expect(lower, `spec 4.7 rejects ${ground} and the terms do not say so`).toContain(ground)
    }
    expect(text, 'questions about Claude Code itself are rejected and unmentioned').toContain('Claude Code or Anthropic')
  })

  it('forbids re-identifying a respondent', () => {
    const text = textOf(BuyerTermsPage)
    expect(text).toContain('re-identify')
    expect(text, 'joining two exports on the pseudonym is not ruled out').toContain('across studies')
  })

  it('prices a study from the contract, at-cost row included', () => {
    const text = textOf(BuyerTermsPage)
    expect(text).toContain(`${formatCents(full.priceCents)} per valid answer to each question`)
    expect(text).toContain(`${formatCents(atCost.priceCents)}`)
    expect(text).toContain(`${PRICING.MIN_RESPONDENTS} to ${PRICING.MAX_RESPONDENTS}`)
  })

  // R907. This paragraph said "One single-choice question ... $1 per valid response" while the
  // server holds price x questions x respondents (study-view.ts holdFor) for a study of up to
  // five questions -- so a five-question study cost five times what the terms named. The terms
  // are what a buyer agrees to, so they say what the code charges.
  it('says a study is charged per answer to each of its questions', () => {
    const buying = paragraphAfter('#buying')
    expect(buying).toContain('Single-choice questions, one to five in a study')
    expect(buying).toContain('Every respondent answers every question, so a study costs that price × its questions × its respondents.')
    expect(buying).not.toContain('One single-choice question')
    expect(buying).not.toContain('per valid response')
  })

  // R910. The founding block on /buyers asks for payment later; this page said every uncovered
  // study is paid before review. Both are true of the founding spec's manual arrangement, so the
  // terms describe it instead of contradicting it.
  it('describes the founding arrangement in the terms, in the order it happens', () => {
    const founding = paragraphAfter('#founding')
    expect(founding).toContain('a founding study is written with us first and paid when we tell you the panel can fill it')
    expect(founding).toContain('Review starts once it is paid, as for every study.')
    expect(founding).toContain('If a founding study does not fill within 14 days of going live, we close it and refund the unused part to the account it was paid from.')
  })

  it('is dated the day its content last changed', () => {
    expect(textOf(BuyerTermsPage)).toContain('Last updated 9 October 2026.')
  })

  // R500: a study is paid by invoice, not through a merchant of record, and there is no
  // payment provider left to name.
  it('describes paying per study by PayPal, and names no merchant of record', () => {
    const payment = paragraphAfter('#payment')
    expect(payment).toContain('paid by PayPal before review starts')
    expect(payment, 'bank transfer is not offered').not.toContain('bank transfer')
    expect(pageText()).not.toContain('Paddle')
  })

  // R500: a rejected study is never charged in the first place, so there is nothing to
  // return -- the promise the old "credit is returned" line made about a refund does not
  // apply once payment happens before review, not after it.
  it('promises no charge for a rejected study and refunds of unused credit on request', () => {
    const refunds = sectionText('#refunds')
    expect(refunds).toContain('A rejected study is never charged')
    expect(refunds).toContain('Unused credit is refunded on request')
  })
})

// R417. Paddle's domain review wants the seller named in the terms: "the company name or sole
// proprietor's brand". A brand is enough, so the pages name Tickover as a trading name and not the
// person behind it; the phrase they replace is pinned out so it cannot come back on one page.
// R418. "So is this page's history" is a promise, and the public repository publishes this file at
// the same path, so the link goes to its commit history there -- the promise made checkable.
describe('the privacy page history', () => {
  it("links \"this page's history\" to the page file's commits in the public repository", () => {
    TestBed.resetTestingModule()
    TestBed.configureTestingModule({ providers: [provideRouter([])] })
    const fixture = TestBed.createComponent(PrivacyPage)
    fixture.detectChanges()
    const href = `${SITE.SOURCE_REPO}/commits/main/packages/web/src/app/pages/privacy.page.ts`
    const link = (fixture.nativeElement as HTMLElement).querySelector(`main a[href="${href}"]`)
    expect(link?.textContent?.trim()).toBe("this page's history")
  })
})

describe('who the seller is', () => {
  it.each([
    ['privacy', PrivacyPage],
    ['developer terms', DeveloperTermsPage],
    ['buyer terms', BuyerTermsPage],
  ] as Array<[string, Type<unknown>]>)('names a trading name, not a person, on the %s page', (_label, page) => {
    const text = textOf(page)
    expect(text).toContain('Tickover is a trading name of an independent sole proprietor based in Vietnam.')
    expect(text).not.toContain('independent developer')
  })
})

describe('the three legal pages', () => {
  // R42: with `ssr: false` the body is an empty shell, so a route that is not in
  // `PAGE_META` (and therefore not prerendered) ships the landing page's head to
  // anyone who links it. `postbuild.ts` throws for a PAGE_META route that was not
  // prerendered, so this one assertion pins both halves.
  it.each(['/privacy', '/terms/developers', '/terms/buyers'])('has its own link preview at %s', (route) => {
    expect(Object.keys(PAGE_META), `${route} is not in PAGE_META, so it ships another page's head`).toContain(route)
    expect(PAGE_META[route]!.path).toBe(route)
  })

  // A legal page nobody can find is not a legal minimum. The footer is on every
  // public page through `tk-shell`, which is the only place all three can be
  // reached from without knowing the URL.
  it.each([
    ['privacy', PrivacyPage],
    ['developer terms', DeveloperTermsPage],
    ['buyer terms', BuyerTermsPage],
  ] as Array<[string, Type<unknown>]>)('reaches the other two from the %s page footer', (_label, page) => {
    TestBed.resetTestingModule()
    TestBed.configureTestingModule({ providers: [provideRouter([])] })
    const fixture = TestBed.createComponent(page)
    fixture.detectChanges()
    const hrefs = Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll('footer a'),
      (a) => a.getAttribute('href'),
    )
    for (const route of ['/privacy', '/terms/developers', '/terms/buyers']) {
      expect(hrefs, `the footer does not link ${route}`).toContain(route)
    }
    // R417: the refund policy has to be reachable from the navigation. A path with the fragment
    // typed into routerLink would be encoded to %23 and land nowhere, so this is the real href.
    expect(hrefs, 'the footer does not link the refund policy').toContain('/terms/buyers#refunds')
    // R418: the source, as a plain link: it leaves the site, so it is not a route.
    expect(hrefs, 'the footer does not link the public repository').toContain(SITE.SOURCE_REPO)
  })
})
