import { Component, inject, signal } from '@angular/core'
import type { RouteMeta } from '@analogjs/router'
import { ApiService } from '../../lib/api'
import { adminGuard } from '../../lib/auth'
import { SITE_NAME } from '../../lib/page-meta'
import { Banner } from '../../ui/banner'
import { Button } from '../../ui/button'
import { PageHeader } from '../../ui/page-header'

export const routeMeta = { title: `${SITE_NAME} — Invariants`, canActivate: [adminGuard] } satisfies RouteMeta

interface Result { ok: boolean; problems: string[] }

/**
 * Four states, not two. "The ledger is sound" and "we could not find out" are
 * different answers, and a page that draws them the same way — a green box, or
 * nothing at all — is the no-signal failure this branch keeps finding: the one
 * screen whose job is to notice something wrong, reporting nothing when it cannot.
 * A failed check therefore drops the previous answer rather than leaving it on
 * screen looking current.
 */
@Component({
  imports: [Banner, Button, PageHeader],
  template: `
    <tk-page-header heading="Invariants">
      <button tk-header-action type="button" data-recheck tk-button variant="secondary" size="sm" [disabled]="busy()" (click)="check()">{{ busy() ? 'Checking…' : 'Re-check' }}</button>
    </tk-page-header>
    <p class="max-w-[68ch] text-small text-ink-600 dark:text-ink-400">Every developer's pending and available balances sum non-negative, every answer's hold is settled exactly once, and every cent debited as a payout is matched by a payout row or credited back. Run against the whole ledger, each time you press the button.</p>

    @if (failed()) {
      <tk-banner data-check-failed class="mt-4" tone="error">
        <p class="font-medium">The check did not run.</p>
        <p class="mt-1 max-w-[68ch]">This is not a clean result. The ledger has not been checked, so treat it as unknown: do not create a payout batch until this page answers.</p>
      </tk-banner>
    } @else if (result(); as r) {
      @if (r.problems.length) {
        <tk-banner data-problems class="mt-4" tone="error">
          <p class="font-medium">The ledger does not add up: {{ r.problems.length }} problem{{ r.problems.length === 1 ? '' : 's' }}.</p>
          <p class="mt-1 max-w-[68ch]">Money has been released, reversed or paid in a way that does not reconcile. Do not create a payout batch until this is resolved — a batch debits balances these problems may be wrong about.</p>
          <!-- Capped like the two paragraphs above it, and it was not. A problem
               string is written by checkInvariants, and the longest of the four it
               emits carries two UUIDs: "answer ID settled 2 times for developer ID"
               is 107 characters before a single digit changes. So the one run of
               prose on this banner that a person has to read carefully was the one
               running the width of the page. The cap is on the list and not on the
               item: a problem cannot forget a cap the list owns. No backtick in
               here, which is what broke the build once -- one ends the template
               literal this comment sits inside. -->
          <ul class="mt-2 max-w-[68ch] list-disc space-y-1 pl-5">@for (p of r.problems; track p) { <li>{{ p }}</li> }</ul>
        </tk-banner>
      } @else if (r.ok) {
        <tk-banner data-ok class="mt-4" tone="done">All ledger invariants hold.</tk-banner>
      } @else {
        <!-- The server derives ok from the problem count, so the two agreeing is
             the only shape it emits today. If they ever disagree, that is a bug in
             the reporter and not a clean bill of health. (No backtick anywhere in
             these comments: one would end the template literal.) -->
        <tk-banner data-inconsistent class="mt-4" tone="error">The check reported a failure but listed no problems. Treat the ledger as unchecked and look at the server logs.</tk-banner>
      }
    } @else {
      <p data-checking class="mt-4 text-small text-ink-600 dark:text-ink-400">Checking the ledger…</p>
    }`,
})
export default class InvariantsPage {
  private api = inject(ApiService)
  result = signal<Result | null>(null)
  failed = signal(false)
  busy = signal(false)

  constructor() { void this.check() }

  async check(): Promise<void> {
    if (this.busy()) return
    this.busy.set(true)
    try {
      this.result.set(await this.api.adminInvariants())
      this.failed.set(false)
    } catch {
      // The old answer goes with it. Leaving a green box up beside a failed
      // re-check is exactly the thing this page must not do.
      //
      // Measured, and worth knowing before anyone deletes this line as dead: on
      // its own no mutant kills it, because the template asks `failed()` before
      // it asks `result()`, so a stale all-clear is never reached even when it is
      // still in the signal. Weakening that ordering on its own is also harmless,
      // because the signal really was cleared. It is the pair that goes red — so
      // this is a second guard, not a redundant one, and it is what holds if the
      // template is ever restructured (R66).
      this.result.set(null)
      this.failed.set(true)
    } finally {
      this.busy.set(false)
    }
  }
}
