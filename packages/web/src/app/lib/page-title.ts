import { Injectable, inject } from '@angular/core'
import { Title } from '@angular/platform-browser'
import { TitleStrategy, type RouterStateSnapshot } from '@angular/router'
import { SITE_NAME, pageMetaFor } from './page-meta'
import { Seo } from './seo'

/**
 * The prerendered head is what a crawler reads for a link preview; this is what the
 * developer's own browser tab reads once the SPA has taken over, and after an in-app
 * navigation the two disagree unless something sets it. Same `PAGE_META` the
 * build-time render uses, so one place owns the strings.
 *
 * Analog's file routes carry no `title` in their route data unless the page declares
 * one, so Angular's default strategy usually has nothing to read and leaves the tab
 * on whatever loaded first.
 *
 * Three sources, in order. `PAGE_META` first, because it is also what the prerendered
 * head says and the two must not disagree; its keys are exactly the prerender list and
 * nothing else may join it. Then the route's own `title`, which is how a page with no
 * prerendered head — every screen behind a sign-in — names itself, via `routeMeta`.
 * Then the site name, so a route that named nothing still gets something true rather
 * than the previous page's headline or the landing claim.
 *
 * It also owns the rest of the head, through `Seo`: the description, og tags, the
 * canonical, noindex and JSON-LD. A title strategy runs on every navigation, the
 * build-time render included, which is the one hook that covers both what a crawler
 * reads and what a client navigation leaves behind.
 */
@Injectable()
export class PageMetaTitleStrategy extends TitleStrategy {
  private readonly title = inject(Title)
  private readonly seo = inject(Seo)

  override updateTitle(snapshot: RouterStateSnapshot): void {
    this.title.setTitle(pageMetaFor(snapshot.url)?.title ?? this.buildTitle(snapshot) ?? SITE_NAME)
    this.seo.apply(snapshot.url)
  }
}
