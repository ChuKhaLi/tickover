/* @jsx h */
import type { Register } from 'claude-code'

// The Tickover band: the open question drawn above Claude Code's prompt, answered with a digit.
// Spec: docs/superpowers/specs/2026-09-15-claude-mods-band-design.md.
//
// Everything drawn here was composed by the daemon (R203). A hooks module cannot import
// @tickover/contract, so this file sanitises nothing, and must draw nothing that did not arrive
// from GET /v1/band. It hooks no prompt and reads no prompt text (R201); scripts/test-mod.mjs holds
// that. Module state is per process: a session moved to another process loads this file afresh,
// and the next poll rebuilds everything from the daemon (Spike E).
//
// Loader rules (Spike E): $ is spelled $.noun.verb(...) at every call site, and a helper that
// receives $ is declared at the top of this file -- the loader refuses the whole module otherwise.

const BAND_POLL_MS = 2_000
const BAND_POLL_MAX_MS = 10_000
// R202: a digit typed into an empty box just as a question appears is more likely the first key of a
// prompt than an answer, so the hotkeys arrive this long after the band first draws an assignment.
const BAND_ARM_MS = 1_500
// R219: how long the band may go unrendered before it stops claiming the question. Claude Code's own
// feedback survey takes the AbovePrompt slot by stopping this module's render hook from being
// dispatched at all, and nothing in the host's `ui.*` events reports a site being taken -- so the
// absence of a render is the only signal there is. Bounded at both ends, and neither bound is a
// preference:
//   - at or below one poll interval (2 000 ms), a single slow or folded frame releases a claim the
//     band is still drawing, and the question shows in the band and on the status line at once;
//   - above the daemon's BAND_FRESH_MS (6 000 ms, daemon src/sessions.ts), the daemon has already
//     expired the claim by itself and the release below never does anything -- dead code that reads
//     as a guarantee, which is how R204's cost arrives with every test green.
// Two poll intervals, so two consecutive polls must find no render between them. Held against both
// bounds by packages/daemon/test/unit/band-constants.test.ts, which reads this literal out of this
// file, and at 3 999 / 4 000 ms by the kit.
const BAND_RENDER_STALE_MS = 4_000
// R220: how recently the band must have been drawn for a digit to spend the answer. Deliberately not
// BAND_RENDER_STALE_MS. That window stays open for two whole polls while the band is dark, and a
// press is the one thing here that spends money it cannot take back: the branch review pressed 3 000
// ms into a render silence and got a real POST /v1/answer for a question nobody could see, with the
// claim still held -- which is the moment a survey has just taken the band and the developer is most
// likely typing. Bounded at both ends:
//   - above BAND_POLL_MS (2 000 ms): poll() asks for a redraw every interval while the band draws, so
//     a healthy drawing is up to one interval old, and a tighter window refuses a legitimate press on
//     a normally-rendering band -- the keystroke silently does nothing;
//   - below BAND_RENDER_STALE_MS: at or above it the press is allowed for exactly as long as the
//     claim is held, and splitting the two windows buys nothing.
// 2 500 ms is one poll interval plus a 500 ms allowance, and that allowance is CHOSEN, not derived.
// The quantity it stands in for is the host's invalidate-to-dispatch latency -- the gap between
// poll() asking for a redraw and the render arriving -- and that has never been measured. If it
// exceeds 500 ms on a real terminal a legitimate press is refused, with no toast, and the keystroke
// silently does nothing. What would settle it: time the gap between a forced invalidate and the
// render dispatch in a live session. The kit pins both sides (spent at 2 000 ms, refused at 2 500 ms,
// the claim still held at both) and band-constants.test.ts holds
// BAND_POLL_MS < this < BAND_RENDER_STALE_MS.
const BAND_PRESS_FRESH_MS = 2_500

type BandView =
  | { state: 'none' }
  | { state: 'question'; assignment_id: string; header: string; text: string; options: string[]; min_columns: number }
  | { state: 'answered'; text: string }

let daemon: { port: number; token: string } | null = null
let view: BandView = { state: 'none' }
let viewJson = JSON.stringify(view)
// The assignment the most recent render drew, or null when it passed through. Sent as `drawn` on
// every poll, so the daemon's claim stays fresh exactly as long as the band really shows it (R204).
let drawing: string | null = null
// The clock at the last dispatch of the render hook, whether it drew or passed through: evidence
// that the hook is being called at all. Read only while `drawing` is set, and `drawing` is only ever
// set by a dispatch that has just written this, so a live claim can never be measured against the
// initial zero (R219).
let lastRenderAt = 0
// The clock at the moment the band last *finished drawing* `drawing` above: written beside it and
// never apart from it, so the two are always a consistent pair -- which assignment the band last
// finished drawing, and when it finished.
// Deliberately not `lastRenderAt`, which answers a different question -- "is this hook being called at
// all", including dispatches that pass through -- and which R219's claim release needs in that wider
// form. Reading the press guard against `lastRenderAt` paired a *fresh* timestamp with a *stale*
// assignment for the whole of a drawing render, because that render writes `lastRenderAt` at its top
// and `drawing` only after two awaits (R220, fix round 4). And taking the value FROM `lastRenderAt`
// was the same error one step in: it dated the drawing from when the dispatch began, charging the
// render's own duration against the press window (fix round 5).
let drawnAt = 0
// The assignment whose arming timer has been started, and the one whose hotkeys are live. Two
// values rather than two Sets: only one assignment is ever drawn at a time, and a Set per process
// grew for the life of the process with nothing ever taken out of it. `sessionEpoch` rises on every
// session.start, which is what tells a timer started before /clear from one started after it.
let arming: string | null = null
let armedFor: string | null = null
let sessionEpoch = 0
let polling = false
let delay = BAND_POLL_MS
let nextPollAt = 0

async function readDaemon($: any): Promise<{ port: number; token: string } | null> {
  // The same rule as notify.mjs: TICKOVER_HOME, else HOME or USERPROFILE joined with .tickover.
  const explicit = await $.env.get('TICKOVER_HOME')
  const base = (await $.env.get('HOME')) ?? (await $.env.get('USERPROFILE'))
  const home = explicit ?? (base ? `${base}/.tickover` : null)
  if (!home) return null
  const raw: string | null = await $.fs.read(`${home}/daemon.json`).catch(() => null)
  if (!raw) return null
  try {
    const info = JSON.parse(raw)
    return typeof info?.port === 'number' && typeof info?.token === 'string' ? { port: info.port, token: info.token } : null
  } catch {
    return null
  }
}

async function request($: any, path: string, method = 'GET', body?: string): Promise<{ status: number; text: string } | null> {
  daemon ??= await readDaemon($)
  if (!daemon) return null
  try {
    const r = await $.http.fetch(`http://127.0.0.1:${daemon.port}${path}`, {
      method,
      headers: { 'x-tickover-token': daemon.token, 'content-type': 'application/json' },
      body,
    })
    // A restarted daemon has a new token and maybe a new port, and whatever answers on the cached
    // port may not be the daemon at all: on a failed request, read daemon.json again next time
    // (design, "Discovery": "re-reads them after any failed request"). The 401 this used to name alone is
    // the commonest case, not the only one -- with only that branch, anything else failing on the
    // cached port left the band dead, silently, for the whole life of the process.
    // Failed means "any status but the two the daemon itself answers with". 204 is excluded because a
    // successful skip is answered **204** (daemon src/http.ts:219, `res.writeHead(ok ? 204 : 404)`),
    // and counting that as a failure threw away a good port and token on every skip (R213). `>= 400`
    // was the wrong repair for it: it also excused every status from 200 to 399, and a squatter on
    // the daemon's old ephemeral port after a restart answers a **redirect**, not an error -- the
    // exact case this branch exists for. `poll()` below has always counted any non-200 as a failure,
    // and anything wider than this leaves the two halves of one module disagreeing about it (R217).
    if (r.status !== 200 && r.status !== 204) daemon = null
    return { status: r.status, text: r.text }
  } catch {
    daemon = null
    return null
  }
}

function show($: any, next: BandView): void {
  const json = JSON.stringify(next)
  if (json === viewJson) return
  view = next
  viewJson = json
  $.ui.invalidate('ui.render')
}

// Whether the band is drawing `assignmentId` *now*: it is the assignment the most recent render drew,
// and that render is recent enough that the band is still on the screen. Both halves are needed --
// the host's press handle stays valid for the life of the drawing, and `drawing` says which
// assignment was drawn but not when, because nothing clears it when rendering stops: it survives
// until poll() releases it, up to BAND_RENDER_STALE_MS later. Testing it alone left the guard open
// for those four seconds (R220).
// Both module reads live in `drawnFresh`, which is synchronous, so no await can fall between them.
// That alone was not enough, and the claim that it was is worth keeping as a warning. A check that
// straddles an await pairs a stale assignment with a fresh timestamp and lets a press through for a
// band the very same render has just handed back to the status line -- both orderings of that race
// posted a real answer while all 23 tests of the day stayed green, because every one of them decided
// the guard between dispatches rather than across one (R220, fix round 2). Making the reads
// synchronous fixed the straddle and left a second pairing untouched: `lastRenderAt` is written at the
// top of a render and `drawing` only after two awaits, so for the whole of a render that draws a
// *different* assignment, the pair read (previous assignment, fresh timestamp) -- atomic, and
// atomically wrong. Reading `drawnAt` instead is what closes it, because `drawnAt` and `drawing` are
// written beside each other and are therefore always the same drawing (R220, fix round 4).
// So the guarantee here is exactly two things and no more: the reads cannot be separated by an await,
// and the two values they read always describe one drawing. Neither says the band is on the screen --
// nothing can, and BAND_PRESS_FRESH_MS is the proxy that stands in for it.
// band-constants.test.ts holds the shape: `drawnFresh` declared without `async`, called from
// `drawnNow` rather than orphaned, and `drawnAt` read in exactly one place.
// Both call sites `await` drawnNow, and only the tests hold that they do: `if (promise)` raises
// TS2801, but `if (!promise)` -- the form used at both -- raises nothing at all. A dropped `await`
// negates a Promise, is therefore always false, and disables the guard entirely with the typecheck,
// `validate` and the bundle all green.
// Whether a keystroke can actually reach a live Button while Claude Code's own survey holds the slot
// is **unverified**: four attempted runs failed on ordering rather than on the question, and no
// `ui.*` event reports a site being taken, so neither this file nor the kit can settle it. What would
// settle it: a session with a question open and the survey showing, a digit pressed, and the daemon
// log read for a POST /v1/answer the band never drew. The guard does not depend on that answer -- it
// refuses a press for a band that has not been drawn lately however the press arrived -- and an
// answer is paid and once-only, so one spent on a question the developer could not see is not
// something they can take back (R219, R220).
function drawnFresh(now: number, assignmentId: string): boolean {
  return drawing === assignmentId && now - drawnAt < BAND_PRESS_FRESH_MS
}

async function drawnNow($: any, assignmentId: string): Promise<boolean> {
  return drawnFresh(await $.clock.now(), assignmentId)
}

async function poll($: any): Promise<void> {
  const now: number = await $.clock.now()
  if (now < nextPollAt) return
  // R219: while we believe we are drawing, ask for a redraw on every poll, so that a render which
  // does not arrive becomes evidence rather than ambiguity -- `show()`'s change-only invalidate
  // cannot tell "nothing changed" from "we are not being rendered at all", and a steady question
  // never changes. Measured silences of 98 s and 67 s under a survey, claiming the question through
  // both, with the status line showing the balance line: the question was on neither surface.
  // The fold rate is the host's own, from `claude-code.d.ts`, `$.ui.invalidate`: "at most ten a
  // second, thirty for the shown pane and the band (calls sooner fold)". One every two seconds is
  // ~0.5/s, sixty times under that threshold, and a silence produces at most two of them before the
  // release stops them.
  // Nothing is asked for once the claim is released: while the band draws nothing, dispatches arrive
  // on their own (a running turn changes these props constantly), and that is what brings the band
  // back when the survey leaves.
  if (drawing !== null) {
    if (now - lastRenderAt >= BAND_RENDER_STALE_MS) drawing = null
    else $.ui.invalidate('ui.render')
  }
  const session: string = await $.session.id()
  const claim = drawing ? `&drawn=${encodeURIComponent(drawing)}` : ''
  const r = await request($, `/v1/band?session_id=${encodeURIComponent(session)}${claim}`)
  if (!r || r.status !== 200) {
    delay = Math.min(delay * 2, BAND_POLL_MAX_MS)
    nextPollAt = now + delay
    show($, { state: 'none' })
    return
  }
  delay = BAND_POLL_MS
  nextPollAt = 0
  show($, JSON.parse(r.text) as BandView)
}

async function answer($: any, assignmentId: string, optionIndex: number): Promise<void> {
  // The press guard, here rather than in the `onPress` closure so that it covers every caller of
  // answer() rather than the one that exists today (R220).
  if (!(await drawnNow($, assignmentId))) return
  const r = await request($, '/v1/answer', 'POST', JSON.stringify({ assignment_id: assignmentId, option_index: optionIndex, source: 'claude' }))
  if (!r) {
    $.ui.toast('tickover: answer not sent — daemon off')
  } else {
    let outcome: { accepted?: boolean; reason?: string } | null = null
    try { outcome = r.status === 200 ? JSON.parse(r.text) : null } catch { outcome = null }
    if (outcome?.reason === 'not_current') $.ui.toast('tickover: that question already closed')
    else if (!outcome?.accepted) $.ui.toast('tickover: answer not recorded')
  }
  nextPollAt = 0
  await poll($)
}

async function skip($: any, assignmentId: string): Promise<void> {
  // The same guard as answer(): a phantom skip takes the question away and counts against the
  // skip-pause rule, for a developer who pressed nothing they could see (R220).
  if (!(await drawnNow($, assignmentId))) return
  const r = await request($, '/v1/skip', 'POST', JSON.stringify({ assignment_id: assignmentId }))
  if (!r) $.ui.toast('tickover: skip not sent — daemon off')
  nextPollAt = 0
  await poll($)
}

function armLater($: any, assignmentId: string): void {
  if (arming === assignmentId) return
  arming = assignmentId
  const epoch = sessionEpoch
  $.clock.after(BAND_ARM_MS, () => {
    // A timer started by a session that has since been cleared comes due part-way into the new one,
    // and arming on it would cost exactly the keystroke R202 protects.
    if (epoch !== sessionEpoch) return
    armedFor = assignmentId
    $.ui.invalidate('ui.render')
  })
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const r = await next(e)
    try {
      // session.start can fire again in one process (/clear, /resume). One poll timer is enough, but
      // the arming state has to start over: R202's delay exists because a digit typed into an empty
      // box is more likely the first key of a prompt than an answer, and an empty box is exactly
      // what /clear opens. Carried over, the previous session's arming made the first keystroke of
      // the new one answer a paid question.
      arming = null
      armedFor = null
      sessionEpoch += 1
      if (!polling) {
        polling = true
        $.clock.every(BAND_POLL_MS, () => { void poll($).catch(() => undefined) })
      }
      void poll($).catch(() => undefined)
    } catch {
      // Never cost the session its start on the band's account.
    }
    return r
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    try {
      // R219: proof of life for the claim, recorded for every dispatch, drawing or passing through.
      // What `poll()` has to know is whether this hook is being called at all.
      const startedAt: number = await $.clock.now()
      lastRenderAt = startedAt
      const v = view
      const narrow = v.state === 'question' && (e.props.bodyColumns ?? 0) < v.min_columns
      // Yield: another surface, Claude Code's own survey, nothing to show, or no room for the whole
      // header (section 4.7). Clearing `drawing` is what hands the question back to the status line.
      if (e.surface !== 'terminal' || e.props.hasSurvey || v.state === 'none' || narrow) {
        drawing = null
        return next(e)
      }
      const { Box, Text, Button } = await $.ui.resolve(e)
      const beneath = await next(e)
      if (v.state === 'answered') {
        drawing = null
        return (
          <Box flexDirection="column">
            <Text dimColor>{v.text}</Text>
            {beneath}
          </Box>
        )
      }
      // The clock is read HERE rather than reused from `lastRenderAt`, because the two answer
      // different questions: `lastRenderAt` is when this dispatch began, and the press window needs
      // when the band finished drawing. Everything that can yield -- `$.ui.resolve` and `next(e)`,
      // which runs every other plugin's AbovePrompt hook against a 10 s host budget -- has already run
      // by this point, so measuring from the top charged the render's own duration against the press
      // window: the effective window was BAND_PRESS_FRESH_MS minus however long the render took, and
      // any beneath chain slower than the 500 ms of slack silently refused a legitimate keystroke at
      // the end of a poll cycle (R220, fix round 5).
      // The await is before both writes and nothing separates them, so the pairing guarantee is
      // untouched: no press can read one of these two without the other.
      // And a render that outlived the claim window must not re-open the press window (R220, fix
      // round 6). poll() measures staleness from the dispatch start, so a render slower than
      // BAND_RENDER_STALE_MS has already had `drawing` dropped underneath it and the question handed
      // back to the status line. Completing then would re-claim with a FRESH `drawnAt`, opening the
      // press window for a full BAND_PRESS_FRESH_MS at the exact moment the module concluded it was
      // not being rendered. The old code refused that by accident, measuring from the dispatch start
      // so the age was the whole render duration; dating from the completion removed the accident, in
      // the spending direction, on the money path.
      // `startedAt` rather than `lastRenderAt`, and the three things that says are kept apart because
      // only the first is established. (1) The local cannot be overwritten by another dispatch, so it
      // is what this render took; that is true by construction and strictly the more conservative
      // read. (2) Whether the host ever dispatches AbovePrompt concurrently is **unknown** — this file
      // never consults `next.signal`, so nothing here can observe it, and the earlier comment asserting
      // that a newer dispatch "may have overwritten" the variable was claiming exactly that unknown as
      // its reason. (3) The kit DOES reach the case, and this clause used to deny it. Substituting
      // `lastRenderAt` here reddens `with dispatches overlapping, clearing the claim is what stops a
      // stale assignment being sent` -- the test added by the very commit that wrote "no test in the
      // kit reaches the case". The clause asserted its own precondition false while its own change
      // removed it. Corrected rather than deleted: the choice is now guarded, which is a stronger
      // position than the bare preference this sentence originally recorded.
      // What would settle (2): a live session with `--debug-file`, read for two
      // `ui.render … key=above-prompt` dispatches open at once.
      // The cost of the gate is R204's, and it is the direction this arc has consistently judged
      // cheaper: a gated render draws the band without claiming it, so the question shows in both
      // places until a render completes inside the stale window. Not "within one poll" -- if renders
      // persistently exceed it, every one is gated and both surfaces keep the question with no upper
      // bound, and because the claim is released poll() also stops asking for redraws (R219).
      // `drawing = null` rather than skipping the two writes, and the two are NOT interchangeable --
      // but telling them apart needs a case the kit reached only on the fifth attempt. Skipping leaves
      // `drawing` naming the PREVIOUS assignment, so the next poll sends `&drawn=` for a question the
      // band is not drawing; clearing sends nothing. That is observable only while dispatches OVERLAP:
      // the gate keys on this render's own duration, a local, while poll()'s release keys on
      // module-global `lastRenderAt`, which a newer dispatch refreshes -- so a second render in flight
      // holds the release off and leaves the gate acting on a live claim. With one render at a time the
      // release reaches `null` from the other side first and the two arms are byte-identical.
      // Measured: skipping reddens exactly one test, `with dispatches overlapping, clearing the claim
      // is what stops a stale assignment being sent`. Named rather than counted -- the tally that stood
      // here was stale within one commit, twice, because a count is a status claim about a suite that
      // grows while a test name is not (R221). Note that this same single test is the sole guard for
      // BOTH decisions on this line, the `startedAt` choice in (3) above and clear-vs-skip here; that
      // reads as redundancy until someone deletes it.
      // Four earlier constructions found nothing -- three built to disprove this, one built to prove
      // it -- because each used a single dispatch, or advanced past the end of the window where the
      // release has already erased the difference. An earlier version of this comment read that green
      // as identity and deleted the claim; the claim was true and the instrument was not. An instrument
      // answers the question it was built, not the question being asked.
      // Clearing is correct regardless, and is the conservative arm.
      const finishedAt: number = await $.clock.now()
      if (finishedAt - startedAt >= BAND_RENDER_STALE_MS) {
        drawing = null
      } else {
        drawnAt = finishedAt
        drawing = v.assignment_id
      }
      armLater($, v.assignment_id)
      const isArmed = armedFor === v.assignment_id
      const id = v.assignment_id
      // The row reads as Claude Code's own session survey does -- "1: Bad   2: Fine   0: Dismiss" --
      // because `plain` draws the hotkey in the accent colour, a colon, then the label. Before the
      // hotkeys arm (R202) the same characters are drawn as dim text, so the row does not reflow
      // when they arrive; the sponsor and amount on the row above keep it from reading as Claude's.
      const waiting = `${v.options.map((label, i) => `${i + 1}: ${label}`).join('   ')}   0: Skip`
      return (
        <Box flexDirection="column">
          <Text wrap="wrap">{`● ${v.header} · ${v.text}`}</Text>
          {isArmed ? (
            <Box flexDirection="row" flexWrap="wrap" columnGap={3} marginLeft={2}>
              {v.options.map((label, i) => (
                <Button key={`option-${i + 1}`} label={label} plain hotkey={String(i + 1)}
                  onPress={() => { void answer($, id, i).catch(() => undefined) }} />
              ))}
              <Button key="skip" label="Skip" plain hotkey="0"
                onPress={() => { void skip($, id).catch(() => undefined) }} />
            </Box>
          ) : (
            <Text dimColor>{`  ${waiting}`}</Text>
          )}
          {beneath}
        </Box>
      )
    } catch {
      // A second dispatch beneath is harmless for a drawing. "A broken band must never blank the
      // prompt" is why this returns `next(e)` -- but nothing written here is what holds it. The kit
      // refuses `return undefined` at the typecheck (TS2345 against `Register`'s
      // `RenderElement | Promise<RenderElement>`), and forced past that with a cast the engine
      // treats it as a pass-through: still 19 pass / 0 fail. The one shape that is both well-typed
      // and wrong -- returning an empty `Text` element -- is caught, 18 / 1. So the type holds one
      // half and the engine the other, and if the engine ever renders `undefined` as empty this line
      // becomes the whole guarantee, silently. `drawing = null` below is the half this block does
      // hold on its own (R204, R215).
      drawing = null
      return next(e)
    }
  })
}
