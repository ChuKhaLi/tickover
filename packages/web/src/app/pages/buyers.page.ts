import { Component } from '@angular/core'
import { RouterLink } from '@angular/router'
import { PRICING, SITE, quoteStudy } from '@tickover/contract'
import { Link } from '../ui/button'
import { Money } from '../ui/money'
import { Figure, Rows } from '../ui/rows'
import { Shell } from '../ui/shell'
import { WaitlistForm } from '../ui/waitlist-form'

@Component({
  imports: [Shell, WaitlistForm, RouterLink, Link, Money, Figure, Rows],
  template: `
    <tk-shell [links]="[{ href: '/developers', label: 'For developers' }, { href: '/data', label: 'Data' }, { href: '/app/login', label: 'Sign in' }]">
      <h1 class="max-w-[24ch] text-h1-public text-ink-900 dark:text-ink-50">Ask 300 AI-native developers one question</h1>
      <p class="mt-3 max-w-[68ch] text-lead text-ink-600 dark:text-ink-400">Every respondent answered inside Claude Code. No panel can fake that. Message tests, feature validation, pricing pulses, delivered in days.</p>

      <!-- Every figure here is quoteStudy evaluated for the configuration named
           beside it. They were typed in until this commit: the prices happened to be
           right, because landing.spec.ts derives them and compares, so a PRICING move
           would have reddened the spec rather than shipping a wrong page. That is the
           safety net working, not the rule being kept (R58) -- the page is the thing
           that should be a function of the contract, and now it is.
           No backticks in these comments: the template is a template literal. -->
      <table tk-rows class="mt-8 max-w-xl">
        <tbody>
          <tr><td>Per valid response</td><td tk-figure><tk-money voice="data" [cents]="full.priceCents" /></td></tr>
          <tr><td>With targeting (language, country, activity, OS)</td><td tk-figure>+<tk-money voice="data" [cents]="targetingCents" /></td></tr>
          <tr><td>Study size</td><td tk-figure>{{ minRespondents }} to {{ maxRespondents }} respondents</td></tr>
          <!-- R500: an uncovered study waits before review until it is paid; there is no credit bought ahead. -->
          <tr><td>Pay per study</td><td tk-figure>By PayPal</td></tr>
          <!-- Both branches, because the row above sells targeting and nothing stops
               a first study from using it: quoteStudy charges the developer share
               plus the payment fee, so at cost is 55c untargeted and 80c targeted
               (spec 4.2, 4.3). A flat 55c understated the targeted case by 45%.

               A full-width cell, which is what makes the money in it speech rather
               than data: this is a sentence, not a column, and tokens.spec.ts draws
               that line at colspan. It is not muted either, although it reads like a
               footnote: it is the Phase 0 offer this page exists to make, and the
               launch offer set in the quietest ink on the page was a downgrade the
               eye caught straight away. -->
          <tr><td colspan="2">Your first study, at cost: <tk-money [cents]="atCost.priceCents" /> per response, or <tk-money [cents]="atCostTargeted.priceCents" /> with targeting — the developer's <tk-money [cents]="atCost.developerCents" /> or <tk-money [cents]="atCostTargeted.developerCents" /> plus <tk-money [cents]="atCostFeeCents" /> payment fees, we take $0</td></tr>
        </tbody>
      </table>

      <!-- Founding buyers (spec 2026-09-28-founding-buyers): the outreach emails link
           here, and the h1 above promises a panel that is still being recruited. This says
           so before the review policy, with the refund promise the emails make, so a buyer
           who follows the link reads the same offer they were sent. Classes are the ones
           the review policy below already uses, so the stylesheet does not move. -->
      <section id="founding">
        <h2 class="mt-10 text-h2 text-ink-900 dark:text-ink-50">Founding buyers</h2>
        <p class="mt-2 max-w-[68ch]">The developer panel is new and still growing. The first five buyers write their study now and pay only once the panel can fill it; if a founding study does not fill within 14 days of going live, the unused part is refunded. <a tk-link [href]="foundingMail">Email {{ contact }}</a> to take a place.</p>
      </section>

      <h2 class="mt-10 text-h2 text-ink-900 dark:text-ink-50">Review policy</h2>
      <!-- Spec 4.7 ends "Sponsor name *and payout amount* are always displayed with
           paid questions"; this page named only the sponsor. The amount is the half a
           developer decides on, and a buyer reading this page should know their study
           carries a price the developer is shown. Derived, never typed (R58). -->
      <p class="mt-2 max-w-[68ch]">Every study is approved by a person before it goes live. Not allowed: harvesting personal data, political or adult content, deceptive framing, questions phrased as feedback about Claude Code or Anthropic. The sponsor name and the <tk-money [cents]="developerPayCents" /> a developer earns are always shown with the question. <a tk-link routerLink="/terms/buyers">Full buyer terms</a>.</p>

      <!-- R50: /app/login exists as of task 4, so the call to action points at it
           again. The waitlist stays as the second way in, for a buyer who would
           rather be told when the first studies run than sign in today.
           Routed, not a bare href="#waitlist": index.html carries <base href="/">,
           against which a fragment-only href resolves to the site root, so the CTA
           navigated away from the form it points at. [routerLink]="[]" keeps the
           current route and appends the fragment. -->
      <p class="mt-6 max-w-[68ch]"><a tk-link routerLink="/app/login">Sign in to create a study</a>, or <a tk-link [routerLink]="[]" fragment="waitlist">ask us to tell you when the first studies run</a>:</p>
      <tk-waitlist-form id="waitlist" class="mt-3 block" audience="buyer" />
    </tk-shell>`,
})
export default class BuyersPage {
  full = quoteStudy({ targeted: false, atCost: false })
  atCost = quoteStudy({ targeted: false, atCost: true })
  atCostTargeted = quoteStudy({ targeted: true, atCost: true })
  targetingCents = quoteStudy({ targeted: true, atCost: false }).priceCents - this.full.priceCents
  developerPayCents = this.full.developerCents
  atCostFeeCents = PRICING.AT_COST_FEE_CENTS
  minRespondents = PRICING.MIN_RESPONDENTS
  maxRespondents = PRICING.MAX_RESPONDENTS
  contact = SITE.CONTACT_EMAIL
  foundingMail = `mailto:${SITE.CONTACT_EMAIL}?subject=Founding%20buyer`
}
