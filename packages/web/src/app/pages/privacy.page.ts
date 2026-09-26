import { Component } from '@angular/core'
import { RULES, SITE } from '@tickover/contract'
import { Shell } from '../ui/shell'
import { Link } from '../ui/button'
import { DERIVED_LIST, NEVER_LIST, SENT_LIST } from '../lib/disclosure'

/**
 * Spec §7's legal minimum, second item: "a privacy page mirroring the consent
 * screen". Mirroring is why the three lists here are rendered from the contract's
 * DISCLOSURE rather than summarised: this page and the consent screen are the same
 * disclosure shown at two different moments, and a summary that drifts is worse
 * than no page.
 *
 * It is also the only one of the four surfaces a developer can read *before*
 * installing anything -- the consent screen comes after /tickover:setup starts,
 * and /dev/settings needs an account.
 *
 * Everything below is a claim about code in this repository. The buyer-facing
 * paragraph is drawn from domain/results.ts (per-answer rows, four segment columns,
 * a per-study salted pseudonym), the deletion paragraph from
 * domain/developer-history.ts (deleteDeveloperAccount anonymises; it does not
 * delete), and the cookie sentence from auth/session.ts (one cookie, mw_session).
 * If one of those changes, this page is wrong and legal.spec.ts is where it should
 * fail.
 */
@Component({
  imports: [Shell, Link],
  template: `
    <mw-shell [links]="[{ href: '/developers', label: 'For developers' }, { href: '/buyers', label: 'For buyers' }]">
      <h1 class="text-h1-public text-ink-900 dark:text-ink-50">Privacy</h1>
      <p class="mt-3 max-w-[68ch] text-ink-600 dark:text-ink-400">The same three lists the plugin shows you before it sends anything, plus what happens to them afterwards. Last updated 26 September 2026.</p>

      <h2 class="mt-10 text-h2 text-ink-900 dark:text-ink-50">Who runs this</h2>
      <p class="mt-2 max-w-[68ch]">Tickover is a trading name of an independent sole proprietor based in Vietnam. There is no company behind it yet. Questions, corrections and requests all go to the same place: hello&#64;tickover.dev, answered by a person.</p>

      <h2 class="mt-10 text-h2 text-ink-900 dark:text-ink-50">What the plugin sends</h2>
      <!-- Rendered from the contract's DISCLOSURE, the one source the consent
           screen, /developers and /dev/settings are also held to.
           No backtick anywhere in here: one ends the template literal. -->
      <p class="mt-2 max-w-[68ch]">Your {{ sentList }}.</p>
      <p class="mt-2 max-w-[68ch]">Derived on our side, not sent by the plugin: {{ derivedList }}. Buyers can target on both.</p>
      <p class="mt-2 max-w-[68ch] font-medium">Never: {{ neverList }}. Your status line JSON names the repository you are in; the plugin does not forward it. Your working directory is read on your own machine to count file extensions and is never sent.</p>

      <h2 class="mt-10 text-h2 text-ink-900 dark:text-ink-50">What it is used for</h2>
      <ul class="mt-2 max-w-[68ch] list-disc space-y-1 pl-5">
        <li>Deciding which question to offer you, and whether you match a buyer's audience.</li>
        <li>Paying you: an answer becomes a ledger entry, and the ledger is what a payout run reads.</li>
        <li>Enforcing the limits that keep the panel worth buying — at most {{ maxPaidPerDay }} paid answers a day, and attention checks mixed in with them.</li>
        <li>Weekly aggregates from the unpaid profile questions, published on the data page. Those are counts by option. No individual answer is published.</li>
      </ul>
      <p class="mt-2 max-w-[68ch]">Nothing here is sold, and nothing is used to build a profile for anyone but you and the buyer of a study you answered.</p>

      <h2 class="mt-10 text-h2 text-ink-900 dark:text-ink-50">What a buyer receives</h2>
      <p class="mt-2 max-w-[68ch]">One row per answer: the option you chose, when you chose it, your country, your most-used file extension, your activity tier, your operating system, and a respondent code. That code is a salted digest of your account and the study — so it is a different code in every study, and two buyers cannot line their exports up to rebuild one person across both.</p>
      <p class="mt-2 max-w-[68ch] font-medium">What a buyer never receives: never your GitHub login, never your GitHub id, never your email address, never anything you typed into Claude Code.</p>
      <p class="mt-2 max-w-[68ch]">Those four segment columns are withheld until a study settles. On a narrowly targeted study, a buyer watching answers arrive one at a time could otherwise read one person's country, language, tier and operating system off the first row.</p>

      <h2 class="mt-10 text-h2 text-ink-900 dark:text-ink-50">Who else handles it</h2>
      <ul class="mt-2 max-w-[68ch] list-disc space-y-1 pl-5">
        <li><span class="font-medium">GitHub</span> — you sign in with it, and we read your account id, your login and the date the account was created. Nothing is written back.</li>
        <li><span class="font-medium">Paddle</span> — the merchant of record for buyer payments. Buyers pay Paddle; we never see a card number. Paddle's checkout script loads on the buyer credits page and on no other page of this site.</li>
        <li><span class="font-medium">PayPal</span> — how developers are paid. We hold the PayPal address you give us and send it with a payout batch.</li>
      </ul>
      <p class="mt-2 max-w-[68ch]">There are no advertising networks here, no third-party analytics, and no tracking pixels. One cookie exists, named mw_session, and it is what keeps you signed in.</p>

      <h2 class="mt-10 text-h2 text-ink-900 dark:text-ink-50">How long it is kept</h2>
      <p class="mt-2 max-w-[68ch]">Turn timings, your language mix, your operating system, your tool version and your last-seen time are kept while your account is open, and go when you close it. Answers, the ledger entries behind them and completed payouts are accounting records a buyer has already been charged for, and are kept.</p>

      <h2 class="mt-10 text-h2 text-ink-900 dark:text-ink-50">What you can do</h2>
      <p class="mt-2 max-w-[68ch]">Signed in, the settings page lists every value we hold about you, read out of the database rather than described. The same page deletes your account.</p>
      <p class="mt-2 max-w-[68ch]">Deleting is not the same as erasing, and the difference is worth reading before you do it.</p>
      <ul class="mt-2 max-w-[68ch] list-disc space-y-1 pl-5">
        <li><span class="font-medium">Removed:</span> your GitHub login, operating system, Claude Code version, country, activity tier, file-extension counts, last-seen time, the date your GitHub account was created, every turn we recorded, and your payout method.</li>
        <li><span class="font-medium">Kept:</span> your answers, the ledger entries behind them and any payout already made. They are accounting records a buyer has been charged for, and after deletion there is nothing on them that names you. The account row stays too, emptied: an internal id, the date you first signed up, and your GitHub id, which is what stops a closed account being made again.</li>
        <li>Every way back in closes at once: your command-line token stops working, every browser session ends, and any sign-in link still outstanding stops working.</li>
        <li>Your GitHub account cannot be used with Tickover again. This is permanent.</li>
        <li>Anything not yet paid out is forfeited: a closed account is left out of every payout run. If you are owed money, wait for the next one first.</li>
      </ul>

      <h2 class="mt-10 text-h2 text-ink-900 dark:text-ink-50">If this page changes</h2>
      <p class="mt-2 max-w-[68ch]">The plugin is open source and so is <a mw-link [href]="historyUrl">this page's history</a>. A change that narrows what we collect needs no warning; a change that widens it will be shown in the consent screen again before it takes effect.</p>
    </mw-shell>`,
})
export default class PrivacyPage {
  /** R418: the public repository publishes this file at the same path, so its history is checkable. */
  historyUrl = `${SITE.SOURCE_REPO}/commits/main/packages/web/src/app/pages/privacy.page.ts`
  sentList = SENT_LIST
  derivedList = DERIVED_LIST
  neverList = NEVER_LIST
  maxPaidPerDay = RULES.MAX_PAID_PER_DAY
}
