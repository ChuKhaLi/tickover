import { answerNotice, isEarning, type ServedQuestion } from '@tickover/contract'
import { answeredAfterFrame } from './answered.js'

/** The sponsor limit, matching `pane-view.ts`. Not in RULES (which bounds only what a buyer may
 * submit), and it cannot be read from a constant inside renderQuestionHtml anyway -- see the
 * self-containment note on sanitizeField below -- so it is exported for the tests to assert on. */
export const SPONSOR_MAX = 60

/**
 * HTML-escapes the five characters that matter for breaking out of text content or a quoted
 * attribute. This is the ONE place in this file that turns untrusted server text into markup, so
 * it -- and renderQuestionHtml below -- are exported and unit tested directly with no DOM.
 *
 * Deliberately self-contained (no reference to any module-scope name): renderPage() below embeds
 * this function's own compiled source, via `.toString()`, into the page's inline <script>, so the
 * copy a test exercises here is byte-identical to what ships to the browser -- not a
 * reimplementation that could quietly drift from it.
 */
export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, function (ch) {
    switch (ch) {
      case '&': return '&amp;'
      case '<': return '&lt;'
      case '>': return '&gt;'
      case '"': return '&quot;'
      default: return '&#39;'
    }
  })
}

// Exported alongside escapeHtml/renderQuestionHtml purely so a test can address it by .name
// rather than a hardcoded 'money' literal -- see the embedding comment in renderPage() below.
//
// **Not the contract's `money`, and this is the one place in the product where that is right.**
// R371 took the other three copies out on the grounds that two identical formatters drift, and
// the daemon's pane view now imports it. This one cannot: renderPage() writes this function's
// *source text* into the served page with `${money.toString()}`, so it has to stay standalone --
// the moment the shared one referenced anything outside itself, the inlined copy would be broken
// JavaScript in the browser and nothing here would say so. The constraint is on the source, not
// on the value, which is why the identical body is not a duplicate to be removed.
export function money(c: number): string {
  return `$${(c / 100).toFixed(2)}`
}

/**
 * The page's copy of `@tickover/contract`'s `sanitizeText`. Escaping decides what the browser
 * EXECUTES; this decides what the developer READS, and until now the page was the only one of the
 * four surfaces without it (whole-branch review I2). A buyer could put a RIGHT-TO-LEFT OVERRIDE
 * in a question or an option and reverse what the developer sees on the single surface where they
 * click to earn -- escaping cannot touch that, because a bidi mark is not markup. Raw ESC and BEL
 * survived too, and nothing on this page truncated, against `ServedQuestion.text`/`.options`
 * being unbounded `z.string()` on the wire.
 *
 * A copy rather than an import, for the same reason escapeHtml is: renderPage() embeds this
 * function's own compiled source into the served page via `.toString()`, so it must reference no
 * module-scope name -- not the contract's regex constants, not its `truncateChars`, not even a
 * local `const` outside itself. A minifier renames module-scope bindings without renaming the
 * text inside an embedded `.toString()` body, which is precisely the ReferenceError this file's
 * `.name`-based declarations exist to prevent. The character classes and the truncation are
 * therefore inline, and a unit test asserts this function is output-identical to the contract's
 * `sanitizeText` over a table of hostile inputs, so the copy cannot silently drift.
 */
export function sanitizeField(input: string, maxChars: number): string {
  const cleaned = input
    .replace(/\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)/g, '') // OSC
    .replace(/(?:\u001b\[|\u009b)[0-?]*[ -/]*[@-~]/g, '') // CSI
    .replace(/\u001b[@-Z\\-_]/g, '') // single-character escapes
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/g, '') // C0 and C1 controls
    .replace(/[\u200b-\u200f\u2028-\u202e\u2060-\u2064\ufeff]/g, '') // zero-width, separators, bidi overrides
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/ {2,}/g, ' ')
    .trim()
  const chars = Array.from(cleaned)
  if (chars.length <= maxChars) return cleaned
  return chars.slice(0, Math.max(0, maxChars - 1)).join('') + '\u2026'
}


/**
 * Builds the card's inner markup for a served question. Pure function, no DOM -- mirrors
 * pane-view.ts's renderPane in shape (state in, display string out) and, like it, treats each
 * server-controlled field (sponsor, text, context, each option) individually, before it is woven
 * into the composed string (R17).
 *
 * Two passes per field, in this order and never over the composed string:
 *  1. sanitizeField -- what the developer READS. Strips terminal escapes, control bytes and bidi
 *     overrides, collapses whitespace, and truncates to the same limit the pane uses. Must run
 *     first: after escaping, `'` is already `&#39;` and the control classes no longer line up.
 *  2. escapeHtml -- what the browser EXECUTES, since this output is markup rather than a
 *     terminal line.
 *
 * This is the only place in the shipped page that builds markup via string concatenation; every
 * other update in the client script below goes through textContent instead, which does not need
 * escaping at all -- though it does still need the reading pass, which is why the balance line's
 * numbers are the only untouched server values on the page.
 *
 * The 120/200/40/60 limits are literals rather than RULES/SPONSOR_MAX references because this
 * function's compiled source is embedded into the page and may not name anything at module scope
 * (see sanitizeField). page.test.ts asserts the rendered output equals the shared
 * `sanitizeText(field, RULES.<LIMIT>)`, so the literals cannot drift from the other surfaces
 * without a test going red.
 */
export function renderQuestionHtml(q: ServedQuestion): string {
  const head = q.kind === 'profile'
    ? 'Tickover panel profile · unpaid'
    : `${escapeHtml(sanitizeField(q.sponsor, 60))} asks · ${money(q.price_cents)}`
  const context = q.context ? `<div class="context">${escapeHtml(sanitizeField(q.context, 200))}</div>` : ''
  const options = q.options
    .map((o, i) => `<button class="opt" data-i="${i}"><b>${i + 1}</b><span>${escapeHtml(sanitizeField(o, 40))}</span></button>`)
    .join('')
  return `<div class="sponsor">${head}</div><h1>${escapeHtml(sanitizeField(q.text, 120))}</h1>${context}${options}` +
    `<button class="opt" data-skip="1"><b>0</b><span>Skip</span></button>`
}

/**
 * The line under the card. It used to say "Keys: 1–5 answer" under any question and under none;
 * it names only the keys the current question takes. Shipped into the page by .name like the
 * helpers above, so the browser and this unit-tested export are the same function.
 */
export function pageKeysHint(optionCount: number | null): string {
  return optionCount
    ? 'Keys: 1–' + optionCount + ' answer · 0 skip. Keep this tab open next to your terminal.'
    : 'Keep this tab open next to your terminal: questions appear here while Claude works.'
}

export function renderPage(): string {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Tickover</title>
<link rel="icon" href="data:,">
<style>
  :root { color-scheme: light dark; --fg: #111; --bg: #fafafa; --muted: #666; --card: #fff; --line: #ddd; --accent: #2563eb; }
  @media (prefers-color-scheme: dark) { :root { --fg: #eee; --bg: #111; --muted: #aaa; --card: #1b1b1b; --line: #333; --accent: #60a5fa; } }
  body { margin: 0; font: 16px/1.5 system-ui, sans-serif; color: var(--fg); background: var(--bg); }
  main { max-width: 40rem; margin: 0 auto; padding: 2rem 1rem; }
  header { display: flex; justify-content: space-between; color: var(--muted); font-size: .9rem; }
  /* ServedQuestion's text/options/context are plain z.string(), unbounded -- the 120/40/200 char
     limits live on QuestionInput upstream, not on the shape this page actually receives -- so a
     pathological single unbroken token must not be able to blow out the 40rem card. */
  .card { background: var(--card); border: 1px solid var(--line); border-radius: .75rem; padding: 1.25rem; margin-top: 1rem; overflow-wrap: anywhere; }
  .sponsor { color: var(--muted); font-size: .9rem; }
  h1 { font-size: 1.35rem; margin: .25rem 0 .5rem; }
  .context { color: var(--muted); margin-bottom: .75rem; }
  button.opt { display: flex; gap: .75rem; align-items: baseline; width: 100%; text-align: left; font: inherit; font-size: 1.05rem; padding: .9rem 1rem; margin: .5rem 0; border: 1px solid var(--line); border-radius: .5rem; background: transparent; color: inherit; cursor: pointer; }
  button.opt:hover, button.opt:focus { border-color: var(--accent); outline: none; }
  button.opt b { color: var(--accent); min-width: 1.2rem; }
  .hint { color: var(--muted); font-size: .85rem; margin-top: 1rem; }
  code { background: var(--line); border-radius: .25rem; padding: .1rem .3rem; }
</style></head>
<body><main>
  <header><span>tickover</span><span id="bal"></span></header>
  <div class="card" id="card">Connecting…</div>
  <p class="hint" id="hint">${pageKeysHint(null)}</p>
</main>
<script>
(function () {
  // Declared under each function's own runtime name (.name), never a fixed name string -- so this
  // stays correct if a minifier ever renames them. renderQuestionHtml's embedded body below calls
  // escapeHtml/money by whatever identifier they actually have at build time; .name always
  // reflects that same identifier, so the declaration and every call site (both inside the
  // embedded bodies and in this hand-written script) move together. A fixed name here would
  // silently stop matching a mangled call site and throw a ReferenceError on first render, with no
  // test able to catch it (startTestDaemon imports the TypeScript source directly, never the
  // built, potentially-minified bundle).
  var ${money.name} = ${money.toString()};
  var ${escapeHtml.name} = ${escapeHtml.toString()};
  var ${sanitizeField.name} = ${sanitizeField.toString()};
  var ${answeredAfterFrame.name} = ${answeredAfterFrame.toString()};
  var ${isEarning.name} = ${isEarning.toString()};
  var ${answerNotice.name} = ${answerNotice.toString()};
  var ${renderQuestionHtml.name} = ${renderQuestionHtml.toString()};
  var ${pageKeysHint.name} = ${pageKeysHint.toString()};
  var state = { view: null, answered: null, message: null };
  var card = document.getElementById('card'), bal = document.getElementById('bal'), hint = document.getElementById('hint');

  function clearCard() { while (card.firstChild) card.removeChild(card.firstChild); }

  function render() {
    var v = state.view;
    if (!v) { card.textContent = 'Connecting…'; return; }
    hint.textContent = ${pageKeysHint.name}(v.logged_in && v.question ? v.question.options.length : null);
    bal.textContent = v.logged_in
      ? (state.answered !== null ? '✓ +' + ${money.name}(state.answered) + ' · ' : '') + 'today ' + v.today_paid_answers + '/10 · balance ' + ${money.name}(v.balance_pending_cents + v.balance_available_cents)
      : 'not logged in';
    if (!v.logged_in) {
      clearCard();
      var p = document.createElement('p');
      p.appendChild(document.createTextNode('Not logged in. Run '));
      var code = document.createElement('code');
      code.textContent = 'tickover login';
      p.appendChild(code);
      p.appendChild(document.createTextNode(' in a terminal.'));
      card.appendChild(p);
      return;
    }
    var q = v.question;
    if (!q) {
      clearCard();
      var waiting = document.createElement('p');
      waiting.textContent = 'Waiting for the next question…';
      card.appendChild(waiting);
      if (state.message) {
        var msg = document.createElement('p');
        msg.className = 'context';
        msg.textContent = state.message;
        card.appendChild(msg);
      }
      return;
    }
    // The one place the DOM is built from an HTML string rather than textContent -- safe because
    // renderQuestionHtml (embedded above, byte-identical to the unit-tested export in page.ts)
    // escapes every server-controlled field before weaving it into that string.
    card.innerHTML = ${renderQuestionHtml.name}(q);
  }

  function post(path, body) {
    return fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  }
  function answer(i) {
    var q = state.view && state.view.question;
    if (!q || i < 0 || i >= q.options.length) return;
    post('/v1/answer', { assignment_id: q.assignment_id, option_index: i, source: 'page' });
  }
  function skip() {
    var q = state.view && state.view.question;
    if (!q) return;
    post('/v1/skip', { assignment_id: q.assignment_id });
  }
  card.addEventListener('click', function (e) {
    var b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.skip) skip(); else answer(Number(b.dataset.i));
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === '0') skip(); else if (/^[1-5]$/.test(e.key)) answer(Number(e.key) - 1);
  });
  var es = new EventSource('/v1/events');
  // Both listeners run the same shared rule the terminal pane runs (I5). A question frame with
  // no question is the daemon's answered-TTL expiry signal and is the ONLY way the checkmark ever
  // clears on its own; a question-less status frame is hook traffic and must leave it alone.
  es.addEventListener('status', function (e) { state.view = JSON.parse(e.data); state.answered = ${answeredAfterFrame.name}(state.answered, 'status', state.view); render(); });
  es.addEventListener('question', function (e) { state.view = JSON.parse(e.data); state.answered = ${answeredAfterFrame.name}(state.answered, 'question', state.view); render(); });
  es.addEventListener('answered', function (e) {
    var o = JSON.parse(e.data);
    // isEarning/answerNotice, not the bare accepted flag (I6): duplicate comes back accepted:true
    // with zero cents, which rendered as a checkmark and $0.00.
    state.answered = ${isEarning.name}(o) ? o.earned_cents : null;
    state.message = ${answerNotice.name}(o);
    render();
  });
  es.onerror = function () { card.textContent = 'Disconnected from the daemon. Reload when it is back.'; };
})();
</script></body></html>`
}
