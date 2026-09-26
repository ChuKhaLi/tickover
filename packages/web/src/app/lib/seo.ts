import { DOCUMENT } from '@angular/common'
import { Injectable, inject } from '@angular/core'
import { Meta } from '@angular/platform-browser'
import { SITE_URL, pageMetaFor, pageUrl } from './page-meta'
import { structuredDataFor } from './structured-data'

export const OG_IMAGE_PATH = '/og.png'

/**
 * The one writer of the document head (spec §2). It runs from the title strategy, so it runs during
 * the build-time render (that is what a crawler reads) and on every client navigation afterwards. The
 * description and og tags used to stay those of the first page loaded.
 *
 * A route off `PAGE_META` is not public: it gets noindex and loses the canonical, so a screen reached
 * by in-app navigation never claims a public page's URL.
 */
@Injectable({ providedIn: 'root' })
export class Seo {
  private readonly meta = inject(Meta)
  private readonly doc = inject(DOCUMENT)

  apply(url: string): void {
    const page = pageMetaFor(url)
    this.doc.head.querySelectorAll('script[type="application/ld+json"]').forEach((n) => n.remove())
    if (!page) {
      this.meta.updateTag({ name: 'robots', content: 'noindex' })
      this.doc.head.querySelector('link[rel="canonical"]')?.remove()
      return
    }
    const href = pageUrl(page.path, SITE_URL)
    this.meta.removeTag('name="robots"')
    this.meta.updateTag({ name: 'description', content: page.description })
    this.meta.updateTag({ property: 'og:title', content: page.title })
    this.meta.updateTag({ property: 'og:description', content: page.description })
    this.meta.updateTag({ property: 'og:url', content: href })
    this.meta.updateTag({ property: 'og:image', content: `${SITE_URL}${OG_IMAGE_PATH}` })
    this.meta.updateTag({ name: 'twitter:card', content: 'summary_large_image' })
    let link = this.doc.head.querySelector<HTMLLinkElement>('link[rel="canonical"]')
    if (!link) { link = this.doc.createElement('link'); link.rel = 'canonical'; this.doc.head.appendChild(link) }
    link.href = href
    const ld = structuredDataFor(page.path, SITE_URL)
    if (ld) {
      const s = this.doc.createElement('script')
      s.type = 'application/ld+json'
      s.textContent = JSON.stringify(ld)
      this.doc.head.appendChild(s)
    }
  }
}
