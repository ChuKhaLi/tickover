// R402. Organization and WebSite on the landing page, nothing else anywhere.
// No FAQPage (deprecated 2026-05-08, docs removed 2026-06-15) and no SoftwareApplication: its rich
// result needs genuine ratings, and there are none to give.
import { SITE } from '@tickover/contract'
import { SITE_NAME } from './page-meta'

export function structuredDataFor(path: string, siteUrl: string): object | null {
  if (path !== '/') return null
  const home = `${siteUrl}/`
  return {
    '@context': 'https://schema.org',
    '@graph': [
      // R418: the public repository is the Organization's other identity.
      { '@type': 'Organization', '@id': `${home}#org`, name: SITE_NAME, url: home, logo: `${siteUrl}/logo-512.png`, sameAs: [SITE.SOURCE_REPO] },
      { '@type': 'WebSite', '@id': `${home}#website`, name: SITE_NAME, url: home, publisher: { '@id': `${home}#org` } },
    ],
  }
}
