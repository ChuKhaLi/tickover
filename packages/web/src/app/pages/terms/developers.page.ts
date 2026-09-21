import { Component } from '@angular/core'
import { PRICING, RULES, quoteStudy } from '@tickover/contract'
import { Shell } from '../../ui/shell'
import { Money } from '../../ui/money'

/**
 * Spec §7's legal minimum, first item: "Developer terms (independent-contractor
 * earnings)". The substance is in the name -- what makes this not an employment
 * agreement is that there is no obligation to answer anything, no schedule, and no
 * withholding.
 *
 * R58: every figure is `quoteStudy` or `RULES`, never typed. The developer rate is
 * the one number on this page a developer will check against their balance, and
 * seven money-copy defects on the plan-2 branch were all literals.
 */
/**
 * Both rates, because there are two and the page has to name both. `quoteStudy` pays
 * `floor(listPrice * DEVELOPER_SHARE)`, and the list price rises with targeting -- so a
 * targeted study pays the developer 75c, not 50c.
 *
 * The share is `PRICING.DEVELOPER_SHARE`, not a ratio of one quote. Those are different
 * numbers: on an at-cost study the buyer pays 55c and the developer keeps 50c, which is
 * 91% of what the buyer paid and still 50% of the list price. The list price is the one
 * the rule is actually written against, so it is the one the page states.
 */
const standard = quoteStudy({ targeted: false, atCost: false })
const targeted = quoteStudy({ targeted: true, atCost: false })

@Component({
  imports: [Shell, Money],
  template: `
    <mw-shell [links]="[{ href: '/developers', label: 'For developers' }, { href: '/privacy', label: 'Privacy' }]">
      <h1 class="text-h1-public text-ink-900 dark:text-ink-50">Developer terms</h1>
      <p class="mt-3 max-w-[68ch] text-ink-600 dark:text-ink-400">Plain terms for answering paid questions. Last updated 7 September 2026.</p>

      <h2 class="mt-10 text-h2 text-ink-900 dark:text-ink-50">What this is</h2>
      <p class="mt-2 max-w-[68ch]">You answer single-choice questions in the idle window of your AI coding tool, and you are paid per answer. You take part as an independent contractor. You are not an employee, not a worker, and not an agent of Tickover, and nothing here creates a partnership or a joint venture.</p>
      <p class="mt-2 max-w-[68ch]">There is no obligation on either side: no minimum number of answers, no schedule, no shift, and no consequence for skipping every question you are ever shown. Skips cost nothing and are not held against you.</p>

      <h2 class="mt-10 text-h2 text-ink-900 dark:text-ink-50">What you are paid</h2>
      <ul class="mt-2 max-w-[68ch] list-disc space-y-1 pl-5">
        <li><mw-money [cents]="standardCents" /> per valid answer to a paid study, or <mw-money [cents]="targetedCents" /> if the buyer targeted their audience — always {{ sharePercent }}% of the study's list price.</li>
        <li>A buyer running their first study at cost pays less than the list price. Your share does not change: the reduction comes out of ours, which on those studies is nothing.</li>
        <li>At most {{ maxPaidPerDay }} paid answers a day. Panel-profile questions are unpaid and capped at {{ profileMaxPerDay }} a day.</li>
        <li>Paid per answer, never per second. A longer Claude run earns nothing extra.</li>
        <li>Payment is by PayPal, in one monthly run, once your available balance reaches <mw-money [cents]="payoutMinCents" />. Below that it stays available and rolls into the next run.</li>
        <li>Payment fees never come out of your share.</li>
      </ul>
      <p class="mt-2 max-w-[68ch]">The sponsor and the amount are shown with every paid question, before you answer it.</p>

      <h2 class="mt-10 text-h2 text-ink-900 dark:text-ink-50">Taxes</h2>
      <p class="mt-2 max-w-[68ch]">You are responsible for your own taxes on what you earn here. Nothing is withheld or reported on your behalf, and no tax forms are issued.</p>

      <h2 class="mt-10 text-h2 text-ink-900 dark:text-ink-50">When earnings can be taken back</h2>
      <p class="mt-2 max-w-[68ch]">An answer is credited as pending, and becomes available when the study settles. Three things can happen in between, and all of them are real:</p>
      <ul class="mt-2 max-w-[68ch] list-disc space-y-1 pl-5">
        <li data-risk="fast">Answering faster than a person could read the question marks that one answer invalid on its own, and its pending amount is reversed at settlement.</li>
        <li data-risk="attention-once">Some paid questions are attention checks — a decoy with one correct option, never labelled as such. They appear occasionally rather than in every study: roughly one answer in {{ attentionRateNew }} while you are new, one in {{ attentionRateEstablished }} once you have answered {{ attentionNewThreshold }}, at most once per study, and never in a study a buyer is running at cost. Getting a single one wrong costs you nothing — that answer still counts and is still paid.</li>
        <li data-risk="attention-threshold">Getting {{ attentionFailsToExclude }} of them wrong in total, counted across every study you have ever answered rather than within one, is what bites. It invalidates every answer you gave in the study where the last one fell, not only the check itself, and it flags your account. A flagged account keeps answering and keeps earning, but is left out of every payout run until someone reviews it — so what waits is not one answer, it is your whole balance.</li>
        <li>Closing your account: anything not yet paid out is forfeited, because a closed account is left out of every payout run. Wait for the next run if you are owed money.</li>
      </ul>
      <p class="mt-2 max-w-[68ch]">An amount already paid out is never clawed back.</p>

      <h2 class="mt-10 text-h2 text-ink-900 dark:text-ink-50">Who can take part</h2>
      <p class="mt-2 max-w-[68ch]">You sign in with GitHub. One account per person. Automating answers and running several accounts end the account. Answering without reading is what the attention checks catch, and that flags the account rather than ending it — see above.</p>
      <p class="mt-2 max-w-[68ch]">A GitHub account younger than {{ minAccountAgeMonths }} months can answer and earn like any other. What it cannot do yet is withdraw: earnings accrue and the first payout waits until the account reaches {{ minAccountAgeMonths }} months.</p>

      <h2 class="mt-10 text-h2 text-ink-900 dark:text-ink-50">Ending it</h2>
      <p class="mt-2 max-w-[68ch]">You can uninstall the plugin at any moment; nothing is sent once it is gone. You can close your account from the settings page, which anonymises what we hold — the privacy page says exactly what is removed and what is kept, and closing is permanent: the same GitHub account cannot be used with Tickover again.</p>
      <p class="mt-2 max-w-[68ch]">We can end an account for the reasons above. If we do it in error, write to hello&#64;tickover.dev and a person will read it.</p>

      <h2 class="mt-10 text-h2 text-ink-900 dark:text-ink-50">The boring part</h2>
      <p class="mt-2 max-w-[68ch]">Tickover is run by one independent developer based in Vietnam, and Vietnamese law governs these terms. The service is provided as it is, with no promise that a question will ever be available to you, and liability is limited to money you have earned and not yet been paid. If one clause turns out to be unenforceable, the rest still stand.</p>
    </mw-shell>`,
})
export default class DeveloperTermsPage {
  standardCents = standard.developerCents
  targetedCents = targeted.developerCents
  sharePercent = PRICING.DEVELOPER_SHARE * 100
  maxPaidPerDay = RULES.MAX_PAID_PER_DAY
  profileMaxPerDay = RULES.PROFILE_MAX_PER_DAY
  payoutMinCents = RULES.PAYOUT_MIN_CENTS
  minAccountAgeMonths = RULES.GITHUB_MIN_AGE_MONTHS
  attentionFailsToExclude = RULES.ATTENTION_FAILS_TO_EXCLUDE
  attentionRateNew = RULES.ATTENTION_RATE_NEW
  attentionRateEstablished = RULES.ATTENTION_RATE_ESTABLISHED
  attentionNewThreshold = RULES.ATTENTION_NEW_THRESHOLD
}
