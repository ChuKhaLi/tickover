import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs'
import { join, resolve, sep } from 'node:path'
import { SITE } from '../src/constants.js'

const repo = resolve(__dirname, '../../..')

/**
 * The first version of this file asserted that every host in shipped source is either ours or in a
 * named allowlist, on the mirror's own reasoning (R122): an unexplained host should get a decision
 * rather than a default. Measured, that rule is wrong here, and the measurement is the useful part
 * -- 431 references across 377 files, of which **307 are `www.w3.org`** from `xmlns` on SVG
 * elements, and most of the rest are documentation links in comments (MDN, the WHATWG spec,
 * Storybook, Vitest) and RFC 2606 names in fixtures (`acme.test`, `example.invalid`).
 *
 * None of those is the defect. The defect was a domain the product *told people to use* while
 * belonging to somebody else. An allowlist covering forty documentation hosts would guard nothing
 * and would teach the next person that the fix for a red guard is another allowlist entry, which is
 * how a guard stops being one. So the rule is narrower and structural instead: the fields that
 * declare the product's identity are held to `SITE`, and anything that merely *looks* like our
 * domain has to be it.
 *
 * What that deliberately does not catch: a brand-new surface naming some unrelated domain as ours.
 * Nothing short of a human reading it would, and pretending otherwise is worse than saying so.
 */

const SKIP_DIRS = new Set(['node_modules', 'dist', 'out-tsc', '.angular', '.vite', 'test-results', 'coverage'])
const READ_EXT = ['.ts', '.tsx', '.mjs', '.js', '.json', '.md', '.html', '.css', '.sql', '.yml', '.yaml']

/**
 * Directory roots, never file paths, and an absent root is skipped.
 *
 * Both halves matter. `packages/server` and `deploy` are withheld from the public mirror, so naming
 * a file inside either as a literal would make this published test read a file the mirror does not
 * carry -- that is R124, and its guard matches literals resolving to a tracked-and-withheld *file*.
 * A directory literal resolves to no such file, and a root that is not there is not walked, so in
 * the mirror this covers what the mirror contains and reports it by finding less.
 */
const ROOTS = ['packages', 'deploy']

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) walk(full, out)
    else if (READ_EXT.some((e) => entry.endsWith(e))) out.push(full)
  }
  return out
}

function shippedFiles(): string[] {
  const out: string[] = []
  for (const root of ROOTS) {
    const at = resolve(repo, root)
    if (existsSync(at)) walk(at, out)
  }
  return out
}

function rel(path: string): string {
  return path.slice(repo.length + 1).split(sep).join('/')
}

function read(path: string): string | null {
  const at = resolve(repo, path)
  return existsSync(at) ? readFileSync(at, 'utf8') : null
}

/** The product name as it appears inside a hostname or an address, lowercased. */
const BRAND = SITE.DOMAIN.split('.')[0]!

describe('the domain every shipped surface names', () => {
  // The control on the walk, because a guard whose only evidence is that it passed has not been
  // shown to look at anything (R114): an empty file list would pass every assertion below, and a
  // bad SKIP_DIRS entry or a renamed root is exactly what produces one.
  it('reads the files it claims to read', () => {
    const files = shippedFiles()
    expect(files.length, 'the walk found nothing, so every assertion below is vacuous').toBeGreaterThan(200)
    const found = (p: string) => files.some((f) => rel(f) === p)
    for (const p of [
      'packages/daemon/src/config.ts',
      'packages/daemon/package.json',
      'packages/vscode/package.json',
      'packages/plugin/skills/setup/SKILL.md',
      'packages/web/src/app/lib/page-meta.ts',
      'packages/web/index.html',
      'packages/web/src/app/pages/privacy.page.ts',
    ]) {
      expect(found(p), `${p} is a surface that names the domain and the walk missed it`).toBe(true)
    }
  })

  /**
   * Anything shaped like our own name, used as a host or an address, has to be our own domain. It
   * catches the near miss rather than the obvious one -- a `.com`, or a pluralised spelling of our
   * own brand -- and it needs no list to maintain, because it keys on the brand rather than on an
   * inventory of the world's hosts. A subdomain of ours passes, so `api.` and `www.` are fine.
   *
   * Only positions where the token really is a host or an address count: after `//`, or after `@`.
   * Written without that constraint first, it reported nineteen strays and every one was a false
   * positive -- the extension's command ids, the `.git` suffix on both manifests' repository URLs,
   * the plugin id in `install <brand>@<brand>`, and the near-miss examples inside this very comment,
   * which is why they are no longer spelled out in it.
   *
   * What it gives up: a bare mention in prose, with no scheme and no `@`. Worth saying rather than
   * implying, and the identity assertions below cover every surface where that would matter.
   */
  it('spells our own name as our own domain, everywhere it appears as a host or an address', () => {
    const strays: string[] = []
    const pattern = new RegExp(`(?://|@)([a-z0-9.-]*${BRAND}[a-z0-9-]*\\.[a-z]{2,})`, 'gi')
    for (const file of shippedFiles()) {
      for (const m of readFileSync(file, 'utf8').matchAll(pattern)) {
        const host = m[1]!.toLowerCase()
        // `.local` is mDNS and names this machine, not a registrable domain.
        if (host === SITE.DOMAIN || host.endsWith(`.${SITE.DOMAIN}`) || host.endsWith('.local')) continue
        strays.push(`${rel(file)}: ${m[1]}`)
      }
    }
    // The list, not a count, so a partial fix reddens naming what it missed (R115).
    expect(strays, `a shipped surface spells our name against a domain that is not ${SITE.DOMAIN}`).toEqual([])
  })

  /**
   * The fields that *declare* the product's identity, held to `SITE` one by one. These are the
   * surfaces a user acts on -- the page they visit, the address they write to, the host a fresh
   * install connects to -- and the ones that cannot import a constant, which is why they were all
   * typed by hand and all of them named a domain we did not own.
   */
  it('declares one identity across every surface that states it', () => {
    const daemon = JSON.parse(read('packages/daemon/package.json')!)
    const vscode = JSON.parse(read('packages/vscode/package.json')!)
    expect(daemon.homepage, 'packages/daemon/package.json homepage').toBe(SITE.ORIGIN)
    expect(vscode.homepage, 'packages/vscode/package.json homepage').toBe(SITE.ORIGIN)

    // R418: the public repository, which the site now links, is one address in every manifest.
    const plugin = JSON.parse(read('packages/plugin/.claude-plugin/plugin.json')!)
    expect(plugin.repository, 'plugin.json repository').toBe(SITE.SOURCE_REPO)
    for (const [name, pkg] of [['daemon', daemon], ['vscode', vscode]] as const) {
      expect(pkg.repository.url, `packages/${name}/package.json repository`).toBe(`git+${SITE.SOURCE_REPO}.git`)
    }
    // The npm page the site links is the package the daemon manifest publishes.
    expect(SITE.NPM_PACKAGE_URL, 'NPM_PACKAGE_URL names the published daemon').toBe(`https://www.npmjs.com/package/${daemon.name}`)

    // og:url on the SPA shell, which is what a crawler reads on a route the prerender missed.
    expect(read('packages/web/index.html'), 'packages/web/index.html og:url').toContain(`content="${SITE.ORIGIN}/"`)

    // The consent paragraph is the one legally meaningful surface the plugin shows, and it is
    // markdown: nothing but a test can hold it to anything.
    expect(read('packages/plugin/skills/setup/SKILL.md'), 'the setup skill consent paragraph').toContain(
      `${SITE.ORIGIN}/privacy`,
    )

    // page-meta derives its default now. Asserting the absence of a literal is the half that keeps
    // it derived: the constant could be imported and then ignored.
    const pageMeta = read('packages/web/src/app/lib/page-meta.ts')!
    expect(pageMeta, 'packages/web/src/app/lib/page-meta.ts imports SITE').toContain('SITE')
    expect(pageMeta, 'page-meta.ts hardcodes an origin instead of deriving it').not.toContain(`'${SITE.ORIGIN}'`)

    // The privacy contact and the route for appealing a closed account. Withheld from the mirror is
    // not a concern here -- these are web pages, which the mirror carries (R120).
    for (const p of ['packages/web/src/app/pages/privacy.page.ts', 'packages/web/src/app/pages/terms/developers.page.ts']) {
      // `@` is written as `&#64;` in an Angular template: a bare one starts a control-flow block.
      const text = read(p)!.replace(/&#64;/g, '@')
      expect(text, `${p} names the contact address`).toContain(SITE.CONTACT_EMAIL)
    }

    // Present only in the private tree; the build argument that bakes og:url into the image.
    const dockerfile = read('deploy/Dockerfile.web')
    if (dockerfile !== null) {
      expect(dockerfile, 'deploy/Dockerfile.web VITE_SITE_URL default').toContain(`VITE_SITE_URL=${SITE.ORIGIN}`)
    }
  })

  /**
   * The severe one on its own. `API_ORIGIN` is written into every fresh install's `config.json`,
   * there is deliberately no environment variable for it, and a running daemon cannot be repointed
   * without editing that file and restarting -- so this is the one value here that a mistake puts
   * on other people's disks.
   */
  it('points a fresh install at a subdomain of our own domain', () => {
    expect(new URL(SITE.API_ORIGIN).protocol, 'a fresh install must not default to plaintext').toBe('https:')
    expect(new URL(SITE.API_ORIGIN).hostname.endsWith(`.${SITE.DOMAIN}`)).toBe(true)
    expect(new URL(SITE.ORIGIN).hostname).toBe(SITE.DOMAIN)
    expect(SITE.CONTACT_EMAIL.endsWith(`@${SITE.DOMAIN}`)).toBe(true)

    // And the proxy has to serve that subdomain, which is a separate fact from naming it.
    // Present only in the private tree. Caddy answers an unmatched Host with 200 and an
    // empty body, so a missing site block is not an error anybody sees -- it is every fresh
    // install quietly receiving nothing from a request that succeeded.
    const caddyfile = read('deploy/Caddyfile.prod')
    if (caddyfile !== null) {
      const sub = new URL(SITE.API_ORIGIN).hostname.slice(0, -(SITE.DOMAIN.length + 1))
      expect(caddyfile, 'deploy/Caddyfile.prod has no site block for the API hostname').toContain(
        `${sub}.{$SITE_HOST}`,
      )
    }
  })
})
