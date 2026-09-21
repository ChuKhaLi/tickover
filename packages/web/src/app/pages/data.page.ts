import { DatePipe } from '@angular/common'
import { Component, PendingTasks, inject, signal } from '@angular/core'
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
      <!-- The ladder is mw-async's. It matters more here than on a signed-in screen:
           an outage and a body the contract rejects arrive the same way, and this page
           exists to show the panel produces data, so reporting either as an empty
           product is the one wrong answer it can give. -->
      <mw-async
        class="mt-8"
        [failed]="failed()"
        [loading]="data() === null"
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
  // Wrapped in `PendingTasks.run`: the promise chain hanging off `firstValueFrom`
  // is unknown to Angular's stability tracking, so `whenStable()` resolves while
  // the page still says "Loading…" — the test saw exactly that before this.
  // (Prose here is scanned by Tailwind and mints utilities, so it avoids words
  // that are class names — R47.)
  constructor() {
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
  }
}
