/**
 * The static half of the deployment, run locally so the Playwright suite drives the
 * artifact that actually ships — and, since it is also `pnpm preview`, so does
 * anyone checking a production build by hand.
 *
 * It implements exactly what `packages/server/README.md`'s Caddyfile declares —
 * `try_files {path} {path}/index.html /shell.html` over `dist/analog/public` — so
 * the deployment note is executable rather than prose.
 *
 * **Both directions are pinned, by two tests, and it took a review round to get the
 * second one.** Changing this file turns the smoke suite red. Changing the *document*
 * used to turn nothing red — measured: reverting only the README's two `try_files`
 * lines to the brief's broken form left Playwright, the web suite and the server
 * suite all green — and the document is the half that gets copied into a Caddyfile.
 * `test/unit/static-server.spec.ts` now parses those lines out of the README and
 * drives each declared step through `resolveFile`.
 *
 * Why not `vite preview`, which the task brief specified: it serves `dist/client`,
 * a directory nothing deploys, and its SPA fallback runs *before* any directory
 * lookup. Measured on this branch: `/developers` came back 200 carrying the landing
 * page's `<title>` and `og:url`, from both `dist/client` (which has no per-route
 * files at all) and `dist/analog/public` (which does). Only `/developers/` reached
 * the right one. `og:url` names the spelling without the slash, so a proxy behaving
 * that way posts the landing preview under every Phase 0 URL.
 *
 * That is why `package.json`'s `preview` script runs this file rather than
 * `vite preview`. `preview` is the command someone runs to see what production will
 * look like; pointed at the wrong tree with a fallback that hides the defect, it
 * hands a confident wrong answer to exactly the person doing the checking.
 * `test/unit/static-server.spec.ts` pins the script so it cannot drift back.
 *
 * Not hardened for the public internet. It binds loopback, serves one directory
 * read-only, and its security guard is the traversal check below. Task 8 added a
 * second guard with a different job: `/assets/*` never falls back to the shell, so a
 * stale page asking for a chunk a deploy removed gets a 404 rather than the shell
 * under a year-long immutable header (Review Focus 2, `cacheControlFor` below).
 */
import { createReadStream, existsSync, statSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import { extname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createGzip } from 'node:zlib'

/**
 * The deployable output (R34), measured rather than assumed — and re-confirmed
 * after a clean rebuild, because the brief named `dist/client`. Only this directory
 * carries the prerendered `buyers/`, `data/` and `developers/` folders with their
 * own heads. `scripts/postbuild.ts` exports the same constant and
 * `test/unit/static-server.spec.ts` holds the two together.
 */
export const PUBLIC_DIR = 'dist/analog/public'

/** Where the Playwright suite serves from. Not 8787 (the server, and `test/dev-proxy.spec.ts`) and not 5173 (`pnpm dev`). */
export const PORT = 4173

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
}

/**
 * A type for every extension the build emits. Guessing from the bytes would be
 * worse than the fallback: Chromium refuses to execute a module script that is not
 * served as JavaScript, and the page then renders as an empty `<mw-root>` with one
 * console line — indistinguishable from the app being broken.
 */
export function contentTypeFor(file: string): string {
  return TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream'
}

/** Text types worth gzipping. Images, fonts and maps are already compressed or small enough not to matter. */
const GZIPPABLE = new Set(['.html', '.js', '.css', '.json', '.svg', '.txt', '.xml'])

/**
 * Paths that 404 when the file is missing instead of falling back to the shell. `/assets/` because
 * a missing hashed chunk must not be answered with the shell under an immutable header, and
 * `/.well-known/` because a well-known URI is a machine-read contract, never a client route (R415).
 * Both Caddyfiles hold the same two blocks, and `test/unit/static-server.spec.ts` checks that.
 */
export const NO_FALLBACK_PREFIXES = ['/assets/', '/.well-known/'] as const

/** Vite content-hashes everything under /assets/, so a name never changes meaning. Everything else can. */
export function cacheControlFor(urlPath: string): string {
  return urlPath.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache'
}

/**
 * No Content-Security-Policy here, not even report-only (R406). Under ssr:true Analog injects an
 * inline `ng-event-dispatch-contract` script into every document, and event replay adds another.
 * A `script-src 'self'` policy flags both on every page. Measured in review: Lighthouse 13.5 Best
 * Practices 0.96, one CSP issue logged at console level `info`, which the e2e console checks cannot
 * see. A policy needs build-time hashes of those scripts, which is its own piece of work.
 */
export const SECURITY_HEADERS: Record<string, string> = {
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'strict-origin-when-cross-origin',
}

function isFile(path: string): boolean {
  return existsSync(path) && statSync(path).isFile()
}

/**
 * The three-step lookup, in order, or `null` for a path that tries to leave the
 * root.
 *
 * Refusing a `..` segment rather than normalising it away is deliberate: a
 * normalised path is served like any other and leaves nothing behind to say the
 * request was made. A browser never sends one — it resolves the URL first — so
 * anything that arrives here came from something else.
 */
export function resolveFile(root: string, urlPath: string): string | null {
  const base = resolve(root)
  const withoutSuffix = urlPath.split('#')[0]?.split('?')[0] ?? '/'
  let decoded: string
  try {
    decoded = decodeURIComponent(withoutSuffix)
  } catch {
    // `%zz` is not a path, it is a malformed request.
    return null
  }
  // A backslash is a path separator to `join` on Windows and nothing at all in a
  // URL, so it has to be refused before the segments are read: `a\..\..\x` is one
  // segment to `split('/')` and a traversal to the filesystem.
  if (decoded.includes('\\') || decoded.includes('\0')) return null
  // `.` is not refused, only `..`: a `.` segment cannot leave the root, and `join`
  // collapses it, so refusing it would be an untestable branch guarding nothing.
  const segments = decoded.split('/').filter((s) => s.length > 0)
  if (segments.includes('..')) return null

  const target = join(base, ...segments)
  if (isFile(target)) return target
  const indexInDir = join(target, 'index.html')
  if (isFile(indexInDir)) return indexInDir
  // The SPA fallback, which is what makes `/app/**`, `/dev/**` and `/admin/**`
  // deep-linkable at all: none of them is prerendered. It is `shell.html`, the
  // unrendered document marked noindex, and no longer the root `index.html`: R400
  // made that the rendered landing page, which would hand every deep link the
  // landing markup and canonical (R401).
  return join(base, 'shell.html')
}

export function createStaticServer(root: string): Server {
  const base = resolve(root)
  return createServer((req, res) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { allow: 'GET, HEAD', ...SECURITY_HEADERS }).end('method not allowed')
      return
    }
    const url = req.url ?? '/'
    const file = resolveFile(root, url)
    if (!file) {
      res.writeHead(403, { 'content-type': 'text/plain; charset=utf-8', ...SECURITY_HEADERS }).end('forbidden')
      return
    }
    // The path a browser asked for, ignoring the query string and fragment `resolveFile`
    // already strips internally -- needed here only to decide whether this was an
    // `/assets/*` request, not to walk the filesystem again.
    const pathname = url.split(/[?#]/)[0] ?? '/'
    // Review Focus 2: `resolveFile` falls back to `shell.html` for anything it cannot
    // find, which is right for `/app/**` but wrong for a hashed asset -- a stale page
    // asking for a chunk a deploy removed must 404, never receive the shell under the
    // year-long immutable header below. A resolved file that did not land inside the
    // prefix's own directory means `resolveFile` fell through to that fallback.
    // R415: the same for `/.well-known/`, whose readers are machines that take a 200 at
    // its word -- Lighthouse 13.5 parsed the shell as an ARD catalog and failed it.
    const prefix = NO_FALLBACK_PREFIXES.find((p) => pathname.startsWith(p))
    if (prefix && !file.startsWith(join(base, prefix))) {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8', ...SECURITY_HEADERS }).end(`not found: ${pathname}`)
      return
    }
    if (!isFile(file)) {
      // Only reachable when the root has no `shell.html`, i.e. nothing was built.
      // Saying so beats an empty 200 that looks like a blank page.
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8', ...SECURITY_HEADERS }).end(`not found: ${file}`)
      return
    }
    const headers: Record<string, string> = {
      'content-type': contentTypeFor(file),
      'cache-control': cacheControlFor(pathname),
      ...SECURITY_HEADERS,
    }
    const gzip = GZIPPABLE.has(extname(file).toLowerCase()) && /gzip/i.test(req.headers['accept-encoding'] ?? '')
    if (gzip) {
      headers['content-encoding'] = 'gzip'
      headers['vary'] = 'Accept-Encoding'
    }
    res.writeHead(200, headers)
    if (req.method === 'HEAD') {
      res.end()
      return
    }
    if (gzip) {
      createReadStream(file).pipe(createGzip()).pipe(res)
      return
    }
    createReadStream(file).pipe(res)
  })
}

/** Resolves with the port actually bound, so a test can ask for an ephemeral one. */
export function listen(server: Server, port: number): Promise<number> {
  return new Promise((ok, fail) => {
    server.once('error', fail)
    server.listen(port, '127.0.0.1', () => {
      const address = server.address()
      if (address === null || typeof address === 'string') {
        fail(new Error('static-server: listening on a pipe, not a port'))
        return
      }
      ok(address.port)
    })
  })
}

const entry = process.argv[1]
if (entry && resolve(entry) === resolve(fileURLToPath(import.meta.url))) {
  const root = resolve(process.argv[2] ?? PUBLIC_DIR)
  // Both, because they are two different documents now (R401): a tree with the
  // landing page and no shell answers every app URL with a 404.
  for (const doc of ['index.html', 'shell.html']) {
    if (!existsSync(join(root, doc))) {
      // The failure this replaces is a suite of browser tests that all report an
      // empty page, which reads as an application defect rather than a missing build.
      console.error(`static-server: ${join(root, doc)} is not there. Run \`pnpm --filter @tickover/web build\` first.`)
      process.exit(1)
    }
  }
  const port = Number(process.argv[3] ?? PORT)
  void listen(createStaticServer(root), port).then((bound) => {
    console.log(`static-server: ${root} on http://127.0.0.1:${bound}/`)
  })
}
