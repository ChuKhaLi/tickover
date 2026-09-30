import { Component, input, output } from '@angular/core'
import type { ButtonVariant } from './button'
import { Banner } from './banner'
import { Button } from './button'

/**
 * The step between clicking an admin action and it happening.
 *
 * Every action it guards is a one-way door: approving sends a study to
 * developers, closing settles the ledger and charges the buyer, creating a payout
 * batch debits balances, marking a batch paid closes it, banning a developer
 * stops their money going out. None of them has an undo, and none of them is
 * obvious enough from the button label to act on unread.
 *
 * The consequences are projected rather than passed in as strings so a page can
 * put a real <tk-money> figure in them -- amounts on this surface come from the
 * server response or the contract, never from a number typed into copy.
 *
 * `go` is the only way any of those calls is reached: the pages hold the action
 * behind an armed signal, so a click on the button in the row opens this panel and
 * nothing else. That is what the specs assert, rather than the panel's presence.
 * (Tailwind scans this comment; a word that is a utility name mints one -- R64.)
 */
@Component({
  selector: 'tk-confirm',
  imports: [Banner, Button],
  template: `
    <tk-banner data-confirm tone="warn" class="mt-3">
      <p class="font-medium">{{ heading() }}</p>
      <ng-content />
      <div class="mt-3 flex flex-wrap items-center gap-2">
        <button type="button" data-go tk-button [variant]="variant()" size="sm" [disabled]="busy()" (click)="go.emit()">{{ action() }}</button>
        <button type="button" data-cancel tk-button variant="secondary" size="sm" [disabled]="busy()" (click)="cancel.emit()">Cancel</button>
      </div>
    </tk-banner>`,
})
export class Confirm {
  heading = input.required<string>()
  action = input.required<string>()
  busy = input(false)

  /**
   * The confirming button's treatment, and `danger` is the default because most of
   * what arms this panel is destructive.
   *
   * It used to be the *only* option, hardcoded. Five of the ten things this component
   * confirms are not destructive -- Approve and go live, Create and go live, Create
   * the batch, Mark paid, Reinstate -- and all ten rendered in the same filled red.
   * On `/admin/developers` that put Reinstate and Ban in the same red button in the
   * same panel, distinguishable only by the word on them.
   *
   * R342 spent the row actions' colour precisely to keep that distinction: it made
   * every row action quiet on the argument that "the destructive treatment belongs to
   * the button that actually bans, which is inside tk-confirm". That argument is only
   * true if the button inside tells the truth, and for half the call sites it did not
   * (R360).
   */
  variant = input<ButtonVariant>('danger')
  go = output<void>()
  cancel = output<void>()
}
