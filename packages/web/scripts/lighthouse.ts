// The gate for spec 2026-09-25 (R403). Local mode builds, serves dist/analog/public through the same
// static server Playwright uses, and audits every PAGE_META route. `--url` audits a deployed origin
// instead, which is how before/after is proven on production. The MCP server is for diagnosis; this
// is the pass/fail.
import { execSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { createServer, type RequestListener } from 'node:http'
import { join, resolve } from 'node:path'
import { PAGE_META } from '../src/app/lib/page-meta'
import { PUBLIC_DIR, createStaticServer, listen } from '../e2e/static-server'
import { AGGREGATES_FIXTURE } from '../e2e/fixtures/aggregates'
import { THRESHOLDS, evaluate, median, nodeSupportsLighthouse, type LhrLike } from './lighthouse-thresholds'

// Lighthouse 13 declares node >=22.19, while this package allows >=20. Say so rather than failing
// somewhere inside Lighthouse. Neither `lighthouse` nor `chrome-launcher` is imported at the top
// of this file: a static `import` is hoisted and its target module evaluated before this guard's
// own code runs, so on an unsupported runtime the crash would come from inside those packages
// rather than from this message. They are loaded with `await import(...)` inside `main()` instead,
// which cannot run until this check has already passed (`nodeSupportsLighthouse` is pulled out of
// `lighthouse-thresholds.ts` precisely so this comparison itself is unit-tested — see there).
if (!nodeSupportsLighthouse(process.versions.node)) {
  console.error(`lighthouse: needs Node >= 22.19 (Lighthouse 13), this is ${process.versions.node}`)
  process.exit(1)
}

/**
 * The static tree has no API, so /data would always be audited in its failure state. The 0.604 CLS
 * was measured with data arriving, so the local run answers the one call the public pages make with
 * the same five-question fixture the e2e suite uses.
 */
function withAggregates(files: ReturnType<typeof createStaticServer>) {
  const serveFile = files.listeners('request')[0] as RequestListener
  return createServer((req, res) => {
    if (req.url?.split('?')[0] === '/api/public/aggregates') {
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
      res.end(JSON.stringify(AGGREGATES_FIXTURE))
      return
    }
    serveFile(req, res)
  })
}

const args = process.argv.slice(2)
const flag = (name: string) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined }
const runs = Number(flag('--runs') ?? 3)
const remote = flag('--url')?.replace(/\/+$/, '')
const outDir = resolve('lighthouse-results')

async function main(): Promise<number> {
  // Dynamic, not static: see the comment above the version guard. By the time this line runs, the
  // guard has already exited on an unsupported Node, so these packages are never asked to load.
  const { default: lighthouse } = await import('lighthouse')
  const chromeLauncher = await import('chrome-launcher')
  let origin = remote
  let close = () => {}
  if (!origin) {
    if (!args.includes('--no-build')) execSync('pnpm run build', { stdio: 'inherit' })
    const server = withAggregates(createStaticServer(resolve(PUBLIC_DIR)))
    const port = await listen(server, 0)
    origin = `http://127.0.0.1:${port}`
    close = () => server.close()
  }
  mkdirSync(outDir, { recursive: true })
  const chrome = await chromeLauncher.launch({ chromeFlags: ['--headless=new'] })
  let failed = 0
  try {
    for (const route of Object.keys(PAGE_META)) {
      const reports: LhrLike[] = []
      for (let i = 0; i < runs; i++) {
        const result = await lighthouse(`${origin}${route}`, { port: chrome.port, output: 'json', logLevel: 'error' })
        if (!result) throw new Error(`lighthouse returned nothing for ${route}`)
        reports.push(result.lhr as unknown as LhrLike)
        writeFileSync(join(outDir, `${route === '/' ? 'home' : route.slice(1).replace(/\//g, '-')}-${i}.json`), result.report as string)
      }
      const m = median(reports, (r) => r.categories['performance']?.score ?? 0)
      const failures = evaluate(m, THRESHOLDS)
      const s = (id: string) => Math.round((m.categories[id]?.score ?? 0) * 100)
      const a = (id: string) => m.audits[id]?.numericValue ?? NaN
      console.log(`${failures.length ? 'FAIL' : 'ok  '} ${route.padEnd(18)} perf ${s('performance')} a11y ${s('accessibility')} bp ${s('best-practices')} seo ${s('seo')} | LCP ${Math.round(a('largest-contentful-paint'))}ms CLS ${a('cumulative-layout-shift').toFixed(3)} TBT ${Math.round(a('total-blocking-time'))}ms`)
      for (const f of failures) console.log(`       ${f}`)
      if (failures.length) failed++
    }
  } finally {
    await chrome.kill()
    close()
  }
  console.log(failed ? `lighthouse: ${failed} route(s) missed the targets` : 'lighthouse: every route met the targets')
  return failed ? 1 : 0
}

main().then((code) => process.exit(code), (e) => { console.error(e); process.exit(1) })
