import { DatePipe } from '@angular/common'
import { Component, PendingTasks, afterNextRender, inject, signal } from '@angular/core'
import type { AggregatesResponse } from '@tickover/contract'
import type { z } from 'zod'
import { Async } from '../ui/async'
import { Bar } from '../ui/bar'
import { Card } from '../ui/card'
import { Shell } from '../ui/shell'
import { ApiService } from '../lib/api'

// `AggregatesResponse` is exported as a schema with no companion `export type` (R45).
type Aggregates = z.infer<typeof AggregatesResponse>

@Component({
  imports: [Shell, DatePipe, Async, Bar, Card],
  template: `
    <mw-shell [links]="[{ href: '/developers', label: 'For developers' }, { href: '/buyers', label: 'For buyers' }]">
      <h1 class="max-w-[24ch] text-h1-public text-ink-900 dark:text-ink-50">What AI-native developers say</h1>
      <p class="mt-3 max-w-[68ch] text-lead text-ink-600 dark:text-ink-400">Aggregates from unpaid panel-profile questions. Updated weekly. No individual answers are published.</p>
      @if (data(); as d) {
        <p class="mt-2 text-caption text-ink-600 dark:text-ink-400">Generated {{ d.generated_at | date: 'mediumDate' }}</p>
      }
      <!-- The ladder is mw-async's, but "still waiting to hear" is not one of its rungs, so it is
           handled here rather than through the loading input: production always answers with five
           questions, and a build that never reaches the browser must show that shape rather than
           mw-async's one-line loading paragraph (R400, spike measured CLS 0.604). failed therefore
           still wins over empty inside the ladder -- an outage and a body the contract rejects
           arrive the same way, and this page exists to show the panel produces data, so reporting
           either as an empty product is the one wrong answer it can give. -->
      <div class="mt-8">
        @if (failed() || data() !== null) {
          <mw-async
            [failed]="failed()"
            [empty]="(data()?.questions ?? []).length === 0"
            failedSays="Couldn't load the latest numbers. Try again shortly."
            emptySays="No data yet."
          >
            <div class="grid gap-6 md:grid-cols-2">
              @for (q of data()?.questions ?? []; track q.question_id) {
                <section mw-card pad="lg">
                  <h2 class="text-h3 text-ink-900 dark:text-ink-50">{{ q.text }}</h2>
                  <p class="mt-1 text-caption text-ink-600 dark:text-ink-400">{{ q.total }} {{ q.total === 1 ? 'answer' : 'answers' }}</p>
                  <ul class="mt-3 space-y-2">
                    @for (o of q.options; track $index; let i = $index) {
                      <li>
                        <div class="flex justify-between gap-4 text-small"><span>{{ o }}</span><span class="shrink-0 tabular-nums">{{ pct(q.counts[i] ?? 0, q.total) }}%</span></div>
                        <mw-bar class="mt-1 block" [pct]="pct(q.counts[i] ?? 0, q.total)" />
                      </li>
                    }
                  </ul>
                </section>
              }
            </div>
          </mw-async>
        } @else {
          <!-- Said once for assistive tech, outside the reserved frame below so its own child
               count -- the with-data e2e's contract for "the real answers arrived" -- stays a
               count of exactly five cards and nothing else. Prerendered along with the frame: the
               build-time render is what a screen reader meets first too, on a cold load slow
               enough that a person notices before the browser's own request lands. -->
          <p role="status" aria-live="polite" class="sr-only">Loading the latest numbers…</p>
          <!-- Reserves the five-card space before the browser has asked for anything. The pin is
               the rendered height of a card carrying five options, the widest row production ships
               today, measured by hand in a real browser: 342px at 375px wide (one column, more text
               wrap) and 315px at 1280px wide (two columns, less wrap). A div, not a section, and the
               mw-card attribute rather than a projected mw-card component instance: the with-data
               e2e test counts section[mw-card] to mean "the real answers arrived", and a placeholder
               built from the same selector would let that count pass while the network call never
               ran. -->
          <div data-aggregates-placeholder class="grid gap-6 md:grid-cols-2" aria-hidden="true">
            @for (row of placeholderRows; track row) {
              <div mw-card pad="lg" class="min-h-[342px] md:min-h-[315px]"></div>
            }
          </div>
        }
      </div>
    </mw-shell>`,
})
export default class DataPage {
  private api = inject(ApiService)
  private pending = inject(PendingTasks)
  data = signal<Aggregates | null>(null)
  failed = signal(false)
  // Clamped: `AggregatesResponse` constrains counts to non-negative integers, not to
  // `<= total`, and an unclamped bar escapes its track rather than filling it.
  pct(n: number, total: number): number { return total === 0 ? 0 : Math.min(100, Math.round((n / total) * 100)) }
  // Five placeholder cards, matching the five questions production answers with today. Tracked by
  // index: the array never changes shape, so identity would work too, but an index reads as what it
  // is -- a count, not a dataset.
  placeholderRows = [0, 1, 2, 3, 4]
  // `afterNextRender` defers the call to after the first render commits, which is what
  // `PendingTasks.run` below relies on for its own timing. It is not, on its own, what keeps the
  // build from calling the API: its built-in server check reads the global `ngServerMode`, and
  // Analog's build only ever sets that inside `@angular/platform-server`'s own compiled file
  // (`server-mode-plugin.js`), not in a page component's -- captured directly: with only
  // `afterNextRender` guarding it, a clean build logged the callback firing and the request failing
  // against the port this machine's build runs on, baking the failure back into the prerendered page
  // this task exists to stop (R407). `typeof window === 'undefined'` is the same check `media()` in
  // `index.page.ts` already uses for the same reason -- Node genuinely has no `window`, independent
  // of which internal flag a plugin remembered to set. jsdom, the vitest environment this suite
  // runs under, does provide `window`, so the check reads false there and the fetch proceeds exactly
  // as it did before this guard existed -- the unit suite pays nothing for it.
  constructor() {
    afterNextRender(() => {
      if (typeof window === 'undefined') return
      void this.pending.run(async () => {
        try { this.data.set(await this.api.publicAggregates()) }
        catch (e) {
          // An outage and a body the contract schema rejects arrive here alike, and
          // both used to render "No data yet." — a page whose whole job is to prove
          // the panel produces data must not report an outage as an empty product.
          console.warn('[tickover] /api/public/aggregates failed', e)
          this.failed.set(true)
        }
      })
    })
  }
}
