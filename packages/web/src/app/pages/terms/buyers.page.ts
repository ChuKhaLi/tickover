import { Component } from '@angular/core'
import { CREDIT_PACK_CENTS, PRICING, quoteStudy } from '@tickover/contract'
import { Shell } from '../../ui/shell'
import { Money } from '../../ui/money'

/**
 * Spec §7's legal minimum, third item: "buyer terms banning personal-data
 * harvesting". The ban is not a slogan here -- spec §4.7 is the review policy the
 * operator actually applies before a study goes live, and the five grounds below
 * are that list, so a buyer reads the same rule the reviewer applies.
 *
 * R58: the prices come from `quoteStudy`, both branches, exactly as the buyer
 * controller quotes them.
 */
const full = quoteStudy({ targeted: false, atCost: false })
const targeted = quoteStudy({ targeted: true, atCost: false })
const atCost = quoteStudy({ targeted: false, atCost: true })

@Component({
  imports: [Shell, Money],
  template: `
    <mw-shell [links]="[{ href: '/buyers', label: 'For buyers' }, { href: '/privacy', label: 'Privacy' }]">
      <h1 class="text-h1-public text-ink-900 dark:text-ink-50">Buyer terms</h1>
      <p class="mt-3 max-w-[68ch] text-ink-600 dark:text-ink-400">What you may ask, what you get back, and what you may not do with it. Last updated 26 September 2026.</p>

      <h2 class="mt-10 text-h2 text-ink-900 dark:text-ink-50">What you are buying</h2>
      <p class="mt-2 max-w-[68ch]">One single-choice question, shown to developers in the idle window of their AI coding tool, answered with one key. You buy responses, not attention time and not impressions: <mw-money [cents]="priceCents" /> per valid response, or <mw-money [cents]="targetedCents" /> with targeting. A study is {{ minRespondents }} to {{ maxRespondents }} respondents. Your first study runs at cost — <mw-money [cents]="atCostCents" /> per response, which is the developer's share plus payment fees, and we take nothing.</p>
      <p class="mt-2 max-w-[68ch]">You are charged for valid responses. An answer that fails an attention check is not one, is not billed, and is not in your results.</p>

      <h2 class="mt-10 text-h2 text-ink-900 dark:text-ink-50">What you may not ask</h2>
      <p class="mt-2 max-w-[68ch]">Every study is read by a person before it goes live. These are the grounds for refusing one, and they are the same list our reviewer works from:</p>
      <ul class="mt-2 max-w-[68ch] list-disc space-y-1 pl-5">
        <li><span class="font-medium">Harvesting personal data.</span> A question whose purpose is to collect a fact about the respondent rather than an opinion — a name, an employer, an email address, a location finer than a country, or anything that would identify them.</li>
        <li>Political or adult content.</li>
        <li>Deceptive framing: a question that misstates what it is for, or that reads as neutral while being written to produce one answer.</li>
        <li>Questions phrased as feedback about Claude Code or Anthropic. Tickover runs inside someone else's tool and does not sell opinions about it.</li>
        <li>A hidden sponsor. The sponsor name you give is shown with the question, and it has to be the real one.</li>
      </ul>
      <p class="mt-2 max-w-[68ch]">A rejected study is refunded in full: the credit is returned to your balance, and a first study rejected at cost does not use up your at-cost entitlement.</p>

      <h2 class="mt-10 text-h2 text-ink-900 dark:text-ink-50">What you may not do with the results</h2>
      <p class="mt-2 max-w-[68ch]">Results come as one row per answer, with a respondent code, a country, a primary language, an activity tier and an operating system. The code is salted per study, so the same person is a different code in each of them.</p>
      <p class="mt-2 max-w-[68ch] font-medium">You may not attempt to re-identify a respondent, and you may not combine two exports to follow one respondent across studies. You may not sell or pass on the row-level export; the findings drawn from it are yours to publish.</p>
      <p class="mt-2 max-w-[68ch]">You may not contact respondents. There is no channel to do so, and asking for one in a question is harvesting personal data.</p>

      <h2 class="mt-10 text-h2 text-ink-900 dark:text-ink-50">Payment</h2>
      <p class="mt-2 max-w-[68ch]">Paddle is the merchant of record for every purchase here. Your contract for payment is with Paddle, your receipt and any sales tax come from Paddle, and we never see your card details. Credit is bought ahead in packs of @for (cents of packs; track cents; let last = $last, i = $index) {<mw-money [cents]="cents" />@if (i === packs.length - 2) { or }@else if (!last) {, }}. It buys studies and cannot be transferred to another account.</p>
      <p class="mt-2 max-w-[68ch]">A study you submit places a hold on your credits, and the hold is released when the study settles. If a study cannot be filled, the unspent part comes back to your balance.</p>

      <!-- R417: Paddle's domain review asks for a refund policy reachable from the navigation; the
           footer links this heading by its id. Spent credit is not refundable because the
           developers who answered have already been credited their share. -->
      <h2 id="refunds" class="mt-10 text-h2 text-ink-900 dark:text-ink-50">Refunds</h2>
      <p class="mt-2 max-w-[68ch]">Unused credit is refunded to your original payment method on request within 14 days of purchase. Write to hello&#64;tickover.dev from the address you sign in with, and the refund is issued through Paddle.</p>
      <p class="mt-2 max-w-[68ch]">Credit spent on a study that has started collecting responses is not refundable, because the developers who answered have already been paid their share. A rejected study, and the unspent part of a study that could not be filled, come back to your balance as credit, as described above.</p>

      <h2 class="mt-10 text-h2 text-ink-900 dark:text-ink-50">What we do not promise</h2>
      <p class="mt-2 max-w-[68ch]">We do not promise a fill time, and we do not promise a full audience: a narrowly targeted study may settle short, and you pay for the responses you got. Answers are opinions given by people in a few seconds, and are not advice you should act on unexamined.</p>

      <h2 class="mt-10 text-h2 text-ink-900 dark:text-ink-50">The boring part</h2>
      <p class="mt-2 max-w-[68ch]">Tickover is a trading name of an independent sole proprietor based in Vietnam. Vietnamese law governs these terms. Liability is limited to what you paid for the study in question. Write to hello&#64;tickover.dev and a person will read it.</p>
    </mw-shell>`,
})
export default class BuyerTermsPage {
  priceCents = full.priceCents
  targetedCents = targeted.priceCents
  atCostCents = atCost.priceCents
  minRespondents = PRICING.MIN_RESPONDENTS
  maxRespondents = PRICING.MAX_RESPONDENTS
  packs = CREDIT_PACK_CENTS
}
