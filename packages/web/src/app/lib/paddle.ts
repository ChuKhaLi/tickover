/**
 * Paddle.js, kept behind this module so nothing else in the app knows there is a
 * global on `window` or a third-party script tag in the document.
 *
 * Only the parts this app uses are declared. The real object is much larger; a
 * narrow interface is also what lets a test drive a fake instead of fetching a
 * script from a CDN.
 */
export interface PaddleLike {
  Environment: { set(env: 'sandbox' | 'production'): void }
  Initialize(o: { token: string; eventCallback?: (e: { name: string }) => void }): void
  Checkout: { open(o: { items: Array<{ priceId: string; quantity: number }>; customData: Record<string, string>; customer?: { email: string }; settings?: { displayMode: 'overlay'; theme?: 'light' | 'dark' } }): void }
}

export interface PaddleConfig {
  token: string
  environment: 'sandbox' | 'production'
}

export const PADDLE_SCRIPT = 'https://cdn.paddle.com/paddle/v2/paddle.js'

/**
 * How long to wait for the CDN before giving up on it.
 *
 * The case this exists for is the one with no event at all: an extension or a
 * corporate proxy can drop the request so that neither `onload` nor `onerror`
 * ever fires. Without a deadline the promise never settles, and the page is left
 * with a disabled button and nothing on screen to say why.
 *
 * (Wording is load-bearing here for a second reason: Tailwind scans this file and
 * mints a utility from any word that is one. The word this comment used to use
 * shipped a rule and 1.5 kB of custom properties with it -- see R47.)
 */
export const PADDLE_LOAD_TIMEOUT_MS = 15_000

/**
 * A pure reader over an environment bag, so both branches can be tested without
 * touching the process environment. Neither variable is set in this repo yet
 * (Task 10 adds the example file), so an empty token is the shipping default and
 * the page has to treat it as "cannot take payment" rather than trying anyway.
 */
export function readPaddleConfig(env: Record<string, string | undefined>): PaddleConfig {
  return {
    token: env['VITE_PADDLE_TOKEN'] ?? '',
    // Anything that is not exactly `production` is the sandbox: an environment
    // this cannot read is one where real cards must not be charged.
    environment: env['VITE_PADDLE_ENV'] === 'production' ? 'production' : 'sandbox',
  }
}

export const PADDLE_CONFIG: PaddleConfig = readPaddleConfig(
  (import.meta as unknown as { env?: Record<string, string | undefined> }).env ?? {},
)

/**
 * One script per document, so a buyer who visits this page twice does not get two
 * copies of Paddle.js and two sets of event callbacks. Cleared on failure, so a
 * retry after a network blip actually retries.
 */
let loaded: Promise<PaddleLike> | null = null

/**
 * Where Paddle's events actually go, and the reason `Initialize` is not handed a
 * caller's function directly.
 *
 * `Initialize` runs **once** per document and keeps whatever `eventCallback` it
 * was given. A component is destroyed and recreated on every navigation into its
 * route, so closing over the first caller's callback sends every later event to a
 * destroyed instance. Measured: visit, click, leave, come back, click, complete a
 * payment — the second page's text was byte-identical before and after, with no
 * poll issued. A real charge, and a screen indistinguishable from one where the
 * buyer never clicked.
 *
 * So the cached instance dispatches through this, and every `loadPaddle` call
 * takes it over. Last caller wins, which is the page that is on screen.
 */
let listener: (name: string) => void = () => {}

/**
 * Hands the events back when a page goes away, so a destroyed component is not
 * left as the standing recipient for the life of the document.
 *
 * It releases **only if the caller still owns the events**. A page that has
 * already been superseded must not silence the one that replaced it — under
 * today's router the old component is destroyed before the new one is built, but
 * an arrangement that overlapped them would otherwise turn the teardown of the
 * old page into C1 again, with the events going nowhere at all.
 */
export function releasePaddleListener(onEvent: (name: string) => void): void {
  if (listener === onEvent) listener = () => {}
}

export function loadPaddle(
  doc: Document,
  win: Window & { Paddle?: PaddleLike },
  opts: PaddleConfig & { onEvent: (name: string) => void; timeoutMs?: number },
): Promise<PaddleLike> {
  // Before the cache check, not after: a caller that gets the cached instance is
  // exactly the caller whose events would otherwise be lost.
  listener = opts.onEvent
  if (loaded) return loaded
  loaded = new Promise<PaddleLike>((resolve, reject) => {
    let settled = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const fail = (why: string) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      reject(new Error(why))
    }
    const finish = () => {
      if (settled) return
      const p = win.Paddle
      // A script that loaded and registered nothing is a failure like any other.
      // Resolving with `undefined` here would hand the page an object it would
      // dereference on the next click.
      if (!p) { fail('Paddle loaded but registered nothing'); return }
      settled = true
      clearTimeout(timer)
      p.Environment.set(opts.environment)
      p.Initialize({ token: opts.token, eventCallback: (e) => listener(e.name) })
      resolve(p)
    }
    // Armed before any branch below, including the synchronous one: a deadline
    // set after a synchronous `finish()` would be a timer nothing clears.
    timer = setTimeout(() => fail('Paddle did not load in time'), opts.timeoutMs ?? PADDLE_LOAD_TIMEOUT_MS)
    if (win.Paddle) { finish(); return }
    const existing = doc.querySelector(`script[src="${PADDLE_SCRIPT}"]`)
    if (existing) {
      existing.addEventListener('load', finish)
      existing.addEventListener('error', () => fail('Paddle failed to load'))
      return
    }
    const s = doc.createElement('script')
    s.src = PADDLE_SCRIPT
    s.async = true
    s.onload = finish
    s.onerror = () => fail('Paddle failed to load')
    doc.head.appendChild(s)
  })
  loaded.catch(() => { loaded = null })
  return loaded
}

export function openCheckout(paddle: PaddleLike, input: { priceId: string; buyerId: string; email: string }): void {
  paddle.Checkout.open({
    // The browser names a price, never an amount. What the buyer is charged is
    // whatever Paddle has stored against that price id, and the webhook credits
    // the account from the server's own price map -- so nothing here decides money.
    items: [{ priceId: input.priceId, quantity: 1 }],
    // The only thing tying a payment to an account: `webhooks.controller.ts`
    // credits `custom_data.buyer_id` and nothing else.
    customData: { buyer_id: input.buyerId },
    customer: { email: input.email },
    settings: { displayMode: 'overlay' },
  })
}
