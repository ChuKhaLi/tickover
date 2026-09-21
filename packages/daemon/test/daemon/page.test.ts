import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { RULES, sanitizeText, isEarning, answerNotice } from '@tickover/contract'
import { startTestDaemon, type TestDaemon } from '../helpers/daemon.js'
import { servedQuestion } from '../helpers/fake-server.js'
import { escapeHtml, renderQuestionHtml, money, sanitizeField, SPONSOR_MAX } from '../../src/page.js'
import { answeredAfterFrame } from '../../src/answered.js'

async function hook(t: TestDaemon, event: string, session_id: string) {
  await fetch(`${t.base}/v1/hook`, { method: 'POST', headers: t.headers, body: JSON.stringify({ event, session_id, tool: 'claude-code', cwd: 'C:/proj' }) })
}
async function startTurn(t: TestDaemon, session = 's1') {
  await hook(t, 'SessionStart', session)
  t.clock.advanceMinutes(3)
  await hook(t, 'UserPromptSubmit', session)
  t.clock.advanceMs(9_000)
}

describe('localhost page', () => {
  let t: TestDaemon
  beforeAll(async () => { t = await startTestDaemon() })
  afterAll(async () => { await t.stop() })

  it('bootstraps the cookie from the token link, then serves the page only with the cookie', async () => {
    const boot = await fetch(`${t.base}/?t=${t.daemon.token}`, { redirect: 'manual' })
    expect(boot.status).toBe(302)
    expect(boot.headers.get('set-cookie')).toContain('mw_daemon=')
    expect(boot.headers.get('set-cookie')).toContain('HttpOnly')
    expect((await fetch(`${t.base}/`)).status).toBe(401)
    expect((await fetch(`${t.base}/?t=wrong`)).status).toBe(401)
    const page = await fetch(`${t.base}/`, { headers: { cookie: `mw_daemon=${t.daemon.token}` } })
    expect(page.status).toBe(200)
    const html = await page.text()
    expect(html).toContain('EventSource')
    expect(html).toContain('/v1/events')
    expect(html).toContain('/v1/answer')
    expect(html).not.toMatch(/https?:\/\//)
  })

  // The one test that matters most for this task: a buyer types the question text, an option, the
  // sponsor name, and the study context into a form on the marketplace side. All four arrive at
  // the daemon as plain server-controlled strings and are relayed unsanitized (question-loop.ts's
  // view() -- sanitizing at render time, not the data layer, is the same discipline pane-view.ts
  // follows for the terminal pane, R17). This page is HTML, not a terminal, so "render time" means
  // "on the way into the DOM" -- and unlike a terminal, a script that lands there runs as the
  // developer, with the install token in a SameSite=Strict cookie. escapeHtml/renderQuestionHtml
  // are the one seam in the whole page that turns that text into markup; everything else (the
  // balance line, the logged-out/waiting states, the answered message) is written via
  // textContent/createElement, which cannot be reinterpreted as a tag no matter what a buyer typed.
  describe('escaping a malicious question', () => {
    const malicious = servedQuestion({
      sponsor: `Acme<script>alert('sponsor')</script>`,
      text: `Pick one" onmouseover="alert('text')`,
      context: `ctx'<script>alert('context')</script>`,
      options: [`opt<script>alert('option')</script>`, 'Cached DB'],
    })

    it('escapeHtml neutralizes the html metacharacters a buyer could use to break out of text or a quoted attribute', () => {
      expect(escapeHtml(`<script>alert(1)</script>`)).toBe('&lt;script&gt;alert(1)&lt;/script&gt;')
      expect(escapeHtml(`"double" and 'single'`)).toBe('&quot;double&quot; and &#39;single&#39;')
      expect(escapeHtml('&')).toBe('&amp;')
    })

    it('escapes the sponsor, text, context, and every option before weaving them into markup', () => {
      const html = renderQuestionHtml(malicious)
      expect(html).not.toContain('<script>')
      expect(html).not.toContain('" onmouseover="')
      expect(html).toContain(escapeHtml(malicious.sponsor))
      expect(html).toContain(escapeHtml(malicious.text))
      expect(html).toContain(escapeHtml(malicious.context!))
      expect(html).toContain(escapeHtml(malicious.options[0]!))
      // The raw payloads must be genuinely gone, not merely present alongside an escaped copy.
      for (const raw of [malicious.sponsor, malicious.text, malicious.context!, malicious.options[0]!]) {
        expect(html).not.toContain(raw)
      }
    })

    it('ships the byte-identical escaping function in the served page, with exactly one innerHTML write -- the already-escaped one', async () => {
      const page = await fetch(`${t.base}/`, { headers: { cookie: `mw_daemon=${t.daemon.token}` } })
      const html = await page.text()
      // Not a hand-copied reimplementation that could quietly stop escaping: the page embeds this
      // exact function's compiled source.
      expect(html).toContain(escapeHtml.toString())
      expect(html).toContain(renderQuestionHtml.toString())
      const innerHtmlWrites = html.match(/\.innerHTML\s*=/g) ?? []
      expect(innerHtmlWrites).toHaveLength(1)
      expect(html).toContain(`card.innerHTML = ${renderQuestionHtml.name}(q);`)
    })

    // Round-2 review finding: the embedding above used to declare each function under a hardcoded
    // literal (e.g. a fixed 'escapeHtml' name) while the body came from .toString() -- fine
    // unminified, but a minifier renaming the real function would leave the declaration's name
    // stale while renderQuestionHtml's embedded body kept calling the mangled one, throwing a
    // ReferenceError on first render. The fix declares each one under its own `.name` instead.
    //
    // A first version of this test asserted against the SERVED HTML -- but fn.name equals the
    // literal source name in every environment this suite runs in (R7: no bundled/minified-
    // artifact test), so a reverted, hardcoded 'var escapeHtml = ...' in the SOURCE produces
    // byte-identical served HTML and that version of the test could not fail (round2 re-review).
    // The regression lives in page.ts's own source text, so this reads that file directly instead
    // -- still no DOM, no browser, still outside R7 -- and rejects the one shape that matters: the
    // function name appearing bare, immediately after `var `, rather than behind a `.name` lookup.
    it('declares each embedded helper in source under its own runtime .name, never a hardcoded literal', () => {
      const source = readFileSync(fileURLToPath(new URL('../../src/page.ts', import.meta.url)), 'utf8')
      expect(source).not.toMatch(/\bvar (?:escapeHtml|money|renderQuestionHtml|sanitizeField|answeredAfterFrame|isEarning|answerNotice)\s*=/)
      for (const fn of [money, escapeHtml, sanitizeField, renderQuestionHtml, answeredAfterFrame, isEarning, answerNotice] as const) {
        expect(source).toContain('var ${' + fn.name + '.name} = ')
      }
    })

    it('carries a malicious question through the real question loop unmodified, and the shipped renderer is inert against exactly that payload', async () => {
      await startTurn(t, 'escape-test')
      t.fake.nextQueue.push({ question: { ...malicious, expires_at: new Date(t.clock.now.getTime() + 10 * 60_000).toISOString() } })
      await t.daemon.loop.tick()

      const served = await (await fetch(`${t.base}/v1/question`, { headers: t.headers })).json()
      // The daemon does not sanitize server-controlled text at this layer -- this is genuinely
      // what a subscriber (this page's EventSource, or a plain GET) receives.
      expect(served.question.sponsor).toBe(malicious.sponsor)
      expect(served.question.text).toBe(malicious.text)
      expect(served.question.context).toBe(malicious.context)
      expect(served.question.options).toEqual(malicious.options)

      const rendered = renderQuestionHtml(served.question)
      expect(rendered).not.toContain('<script>')
      expect(rendered).not.toContain('" onmouseover="')
    })
  })

  // Whole-branch review I2. Escaping is about what the browser EXECUTES; sanitizing is about what
  // the developer READS. The page had the first and not the second -- the only one of the four
  // surfaces missing it -- so a buyer could put a RIGHT-TO-LEFT OVERRIDE or a terminal escape in
  // question or option text and change what the developer sees on the single surface where they
  // click to earn. It was also the only surface that never truncated, against unbounded
  // `ServedQuestion.text`/`.options`.
  describe('sanitizing what the developer reads', () => {
    // Built from code points, never pasted: a raw control or bidi character in source is
    // invisible in an editor and in a diff, and this branch has been fooled by exactly that twice.
    const ESC = String.fromCharCode(0x1b)
    const BEL = String.fromCharCode(0x07)
    const RLO = String.fromCharCode(0x202e) // RIGHT-TO-LEFT OVERRIDE
    const ZWSP = String.fromCharCode(0x200b)
    const BOM = String.fromCharCode(0xfeff)

    it('produces exactly what every other surface produces for the same field', () => {
      // page.ts carries its own copy because the embedded browser code cannot reference a module
      // -- so the copy has to be pinned against the shared implementation, not merely asserted to
      // do something. Any divergence in the character classes shows up here.
      for (const raw of [
        `${ESC}[31mred${ESC}[0m`,
        `bell${BEL}here`,
        `${RLO}drawrkcab`,
        `zero${ZWSP}width${BOM}marks`,
        `${ESC}]0;title${BEL}osc`,
        'lots    of     spaces  ',
        'tabs\tand\nnewlines',
        'x'.repeat(500),
        'plain text',
      ]) {
        expect(sanitizeField(raw, RULES.QUESTION_TEXT_MAX)).toBe(sanitizeText(raw, RULES.QUESTION_TEXT_MAX))
        expect(sanitizeField(raw, RULES.OPTION_TEXT_MAX)).toBe(sanitizeText(raw, RULES.OPTION_TEXT_MAX))
      }
    })

    it('strips bidi overrides and control bytes from every server-controlled field', () => {
      const html = renderQuestionHtml(servedQuestion({
        sponsor: `Acme${RLO}`,
        text: `Approve the ${RLO}tnemyap${ESC}[2J`,
        context: `ctx${BEL}`,
        options: [`Yes${RLO}`, `No${ESC}[31m`],
      }))
      for (const bad of [RLO, ESC, BEL]) expect(html).not.toContain(bad)
      expect(html).toContain('Approve the tnemyap')
    })

    it('truncates each field to the same limit the pane uses, so no field is unbounded', () => {
      // Distinct filler per field: a shared filler would let a shorter truncation match as a
      // suffix of a longer one and the assertions would stop discriminating.
      const html = renderQuestionHtml(servedQuestion({
        sponsor: 'd'.repeat(500),
        text: 'a'.repeat(500),
        context: 'b'.repeat(500),
        options: ['c'.repeat(500), 'ok'],
      }))
      expect(html).toContain(escapeHtml(sanitizeText('a'.repeat(500), RULES.QUESTION_TEXT_MAX)))
      expect(html).toContain(escapeHtml(sanitizeText('b'.repeat(500), RULES.CONTEXT_MAX)))
      expect(html).toContain(escapeHtml(sanitizeText('c'.repeat(500), RULES.OPTION_TEXT_MAX)))
      expect(html).toContain(escapeHtml(sanitizeText('d'.repeat(500), SPONSOR_MAX)))
      for (const ch of ['a', 'b', 'c', 'd']) expect(html).not.toContain(ch.repeat(500))
    })

    it('ships the sanitizer into the browser, byte-identical, and uses it before escaping', async () => {
      const page = await fetch(`${t.base}/`, { headers: { cookie: `mw_daemon=${t.daemon.token}` } })
      const html = await page.text()
      expect(html).toContain(sanitizeField.toString())
      // Escaping alone would leave the payload readable-but-inert; the ordering matters because
      // sanitizeField's control-character classes do not survive being run over `&#39;` escapes.
      expect(renderQuestionHtml.toString()).toMatch(new RegExp(`${escapeHtml.name}\\(\\s*${sanitizeField.name}\\(`))
    })
  })

  // Whole-branch review I5, page half. The daemon signals the answered-TTL expiry as a `question`
  // frame carrying `question: null`; the page's listener only reset `answered` when the frame
  // carried a question, and its `status` listener never reset it at all -- so a stale `✓ +$0.50`
  // sat in the balance line for hours.
  describe('clearing the answered confirmation', () => {
    it('ships the shared frame rule into the browser and calls it from both listeners', async () => {
      const page = await fetch(`${t.base}/`, { headers: { cookie: `mw_daemon=${t.daemon.token}` } })
      const html = await page.text()
      expect(html).toContain(answeredAfterFrame.toString())
      // Both listeners, not just one: the whole defect was that the two disagreed.
      const calls = html.match(new RegExp(`state\\.answered = ${answeredAfterFrame.name}\\(`, 'g')) ?? []
      expect(calls).toHaveLength(2)
      // And the old, broken shape must be gone from the page entirely.
      expect(html).not.toContain('if (state.view.question) state.answered = null')
    })
  })
})
