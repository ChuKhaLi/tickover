import { Component } from '@angular/core'
import { PRICING, RULES, SITE, quoteStudy } from '@tickover/contract'
import { Money } from '../ui/money'
import { Link } from '../ui/button'
import { Shell } from '../ui/shell'
import { WaitlistForm } from '../ui/waitlist-form'
import { DERIVED_LIST, NEVER_LIST, SENT_LIST } from '../lib/disclosure'

@Component({
  imports: [Shell, WaitlistForm, Money, Link],
  template: `
    <tk-shell [links]="[{ href: '/buyers', label: 'For buyers' }, { href: '/data', label: 'Data' }]">
      <h1 class="max-w-[24ch] text-h1-public text-ink-900 dark:text-ink-50">Get paid to answer one question while Claude works</h1>
      <!-- Spec §7's launch angle, and it belongs on the page written for the audience
           it argues to. It lived only on the landing page's developer card until now,
           which also meant the /developers link preview quoted a headline from another
           page. That preview is the string the Phase 0 posts to r/ClaudeAI, r/cursor
           and X actually render, so PAGE_META quotes this line -- and quotes it from
           the same call to quoteStudy, so the title and the page it previews cannot
           disagree about the price.

           The comparison figure is left as it is written: an advertising CPM is not a
           Tickover price and has nothing in the contract to come from. -->
      <p class="mt-3 max-w-[68ch] text-lead text-ink-600 dark:text-ink-400"><tk-money [cents]="developerCents" /> a question, not $0.002 an ad. The plugin is <a tk-link [href]="sourceRepo">open source</a>.</p>
      <ol class="mt-6 max-w-[68ch] list-decimal space-y-2 pl-6">
        <li>Install the Tickover plugin from the Claude Code marketplace and run <code>/tickover:setup</code>. It installs the local daemon, <a tk-link [href]="npmPackage">tickover-cli</a>, from npm.</li>
        <li>When Claude has been working for a few seconds, one question appears in your status line with the sponsor and the amount.</li>
        <li>Answer with one key in a terminal pane, on a local page, or in the VS Code status bar. Skips cost nothing.</li>
      </ol>
      <!-- Every run of prose here is capped at the measure. It was not, and on a
           1280px screen the three disclosure paragraphs ran to about 120 characters a
           line -- on the page the launch posts point at. The cap is written in character widths
           because that is what the rule is about; the terms pages still cap in rem,
           which is the same intent in a different unit. No backtick in here: one
           ends the template literal. -->
      <h2 class="mt-10 text-h2 text-ink-900 dark:text-ink-50">The money</h2>
      <!-- Four figures, and every one of them was typed here. They were right, because
           landing.spec.ts derives them and compares -- which is a net under the page,
           not the rule being kept, and a net only catches the change someone wrote a
           comparison for (R58). -->
      <p class="mt-2 max-w-[68ch]"><tk-money [cents]="buyerPriceCents" /> per response to the buyer, you keep {{ developerShare }}%, up to {{ maxPaidPerDay }} paid answers a day. Paid per answer, never per second, so a longer Claude run earns nothing extra. Payout monthly from <tk-money [cents]="payoutMinCents" /> via PayPal.</p>
      <h2 id="what-leaves" class="mt-10 text-h2 text-ink-900 dark:text-ink-50">What leaves your machine</h2>
      <!-- Spec §5.5's three lists, rendered from the contract's DISCLOSURE rather
           than typed here. Four surfaces carry them -- this page, /privacy,
           /dev/settings and the plugin consent screen -- and the answer source
           (pane, page, vscode) was once missing from two of them at once, which
           is what a fourth hand-written copy would risk again.
           No backtick anywhere in here: one ends the template literal. -->
      <p class="mt-2 max-w-[68ch]">Your {{ sentList }}.</p>
      <!-- §5.5's third list. Leaving it out let /buyers sell targeting on a country
           this page never admitted to deriving. -->
      <p class="mt-2 max-w-[68ch]">Derived on our side, not sent by the plugin: {{ derivedList }}. Buyers can target on both.</p>
      <p class="mt-2 max-w-[68ch] font-medium">Never: {{ neverList }}. The plugin is <a tk-link [href]="sourceRepo">open source</a> and has no self-updater.</p>
      <h2 class="mt-10 text-h2 text-ink-900 dark:text-ink-50">Join the waitlist</h2>
      <tk-waitlist-form class="mt-3 block" audience="developer" />
    </tk-shell>`,
})
export default class DevelopersPage {
  private quote = quoteStudy({ targeted: false, atCost: false })
  developerCents = this.quote.developerCents
  sourceRepo = SITE.SOURCE_REPO
  npmPackage = SITE.NPM_PACKAGE_URL
  buyerPriceCents = this.quote.priceCents
  developerShare = PRICING.DEVELOPER_SHARE * 100
  maxPaidPerDay = RULES.MAX_PAID_PER_DAY
  payoutMinCents = RULES.PAYOUT_MIN_CENTS
  sentList = SENT_LIST
  derivedList = DERIVED_LIST
  neverList = NEVER_LIST
}
