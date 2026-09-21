import { describe, expect, test, tier } from 'claude-code/testing'
import { ANSWERED, DAEMON_BASE, DAEMON_FILE, QUESTION, SESSION, above, world } from './fixtures/world.js'
import { buttonIn, textOf } from './fixtures/tree.js'

tier('user')

describe('band', () => {
  test('draws the question the daemon composed, above what is beneath', async ($, on) => {
    const w = world(on)
    await $.session.start(SESSION)
    await w.clock.settle()
    const text = textOf(await $.ui.render(above()))
    expect(text).toContain('tickover · Acme DB · $0.50 · Which tagline?')
    expect(text).toContain('Postgres, faster')
    expect(text).toContain('Cached DB')
    expect(text).toContain('(the band beneath)')
    expect(w.bandPolls()[0]?.url).toBe(`${DAEMON_BASE}/v1/band?session_id=session-1`)
    expect(w.bandPolls()[0]?.headers['x-tickover-token']).toBe('tok')
  })

  // R202. The unarmed render is asserted, not only the armed one: a module that draws pressable rows
  // from the first frame passes an "armed after 1.5 s" check on its own. The unarmed row holds the
  // same characters as the armed one, which is what keeps the band from reflowing under the reader.
  test('draws the options as dim text until the hotkeys arm 1.5 s later, then as pressable rows', async ($, on) => {
    const w = world(on)
    await $.session.start(SESSION)
    await w.clock.settle()
    const first = await $.ui.render(above())
    expect(textOf(first)).toContain('1: Postgres, faster   2: Cached DB   0: Skip')
    expect(buttonIn(first, 'option-1')).toBeUndefined()
    await w.clock.advance(1_499)
    expect(buttonIn(await $.ui.render(above()), 'option-1')).toBeUndefined()
    await w.clock.advance(1)
    const armed = await $.ui.render(above())
    expect(buttonIn(armed, 'option-1')).toMatchObject({ label: 'Postgres, faster', hotkey: '1', plain: true })
    expect(buttonIn(armed, 'option-2')?.hotkey).toBe('2')
    expect(buttonIn(armed, 'skip')).toMatchObject({ label: 'Skip', hotkey: '0' })
  })

  // R202 at the one moment it was being lost. session.start fires again inside one process on
  // /clear and /resume, and only `polling` was guarded against that: the arming state survived, so
  // the hotkeys of the session just cleared were live on the very first frame of the new one, and a
  // digit typed into that fresh empty box answered a paid question. Both halves are asserted --
  // disarmed on re-entry, and armed again 1.5 s later -- because clearing the arming state without
  // letting it restart would pass the first half and leave the band unanswerable for good.
  test('a second session.start disarms the hotkeys and arms them again 1.5 s later', async ($, on) => {
    const w = world(on)
    await $.session.start(SESSION)
    await w.clock.settle()
    await $.ui.render(above())
    await w.clock.advance(1_500)
    expect(buttonIn(await $.ui.render(above()), 'option-1')?.hotkey).toBe('1')

    await $.session.start(SESSION)
    await w.clock.settle()
    expect(buttonIn(await $.ui.render(above()), 'option-1')).toBeUndefined()
    await w.clock.advance(1_499)
    expect(buttonIn(await $.ui.render(above()), 'option-1')).toBeUndefined()
    await w.clock.advance(1)
    expect(buttonIn(await $.ui.render(above()), 'option-1')?.hotkey).toBe('1')
  })

  // The other half of the same defect, and the one a plain "reset it on re-entry" fix leaves behind:
  // the arming timer already in flight when /clear arrives belongs to the session that is gone. Let
  // it land and it arms the new session 1.0 s in rather than 1.5 s -- the same keystroke R202 is
  // there to protect, lost in a way no one would think to look for.
  test('an arming timer left in flight by the cleared session does not arm the new one early', async ($, on) => {
    const w = world(on)
    await $.session.start(SESSION)
    await w.clock.settle()
    await $.ui.render(above())
    await w.clock.advance(1_000)
    await $.session.start(SESSION)
    await w.clock.settle()
    await $.ui.render(above())
    // t = 2 000: the first session's timer has come due, 1 s into the second session.
    await w.clock.advance(1_000)
    expect(buttonIn(await $.ui.render(above()), 'option-1')).toBeUndefined()
    await w.clock.advance(500)
    expect(buttonIn(await $.ui.render(above()), 'option-1')?.hotkey).toBe('1')
  })

  test('a press posts the answer with source claude', async ($, on) => {
    const w = world(on)
    await $.session.start(SESSION)
    await w.clock.settle()
    await $.ui.render(above())
    await w.clock.advance(1_500)
    await $.ui.render(above())
    await $.ui.press({ plugin: 'tickover', key: 'option-2' })
    await w.clock.settle()
    const posted = w.requests.find((r) => r.url.endsWith('/v1/answer'))
    expect(posted).toMatchObject({ method: 'POST' })
    expect(posted?.headers['x-tickover-token']).toBe('tok')
    expect(JSON.parse(posted!.body!)).toEqual({ assignment_id: QUESTION.assignment_id, option_index: 1, source: 'claude' })
    expect(w.toasts).toEqual([])
  })

  test('a skip posts the assignment to /v1/skip', async ($, on) => {
    const w = world(on)
    await $.session.start(SESSION)
    await w.clock.settle()
    await $.ui.render(above())
    await w.clock.advance(1_500)
    await $.ui.render(above())
    await $.ui.press({ plugin: 'tickover', key: 'skip' })
    await w.clock.settle()
    const posted = w.requests.find((r) => r.url.endsWith('/v1/skip'))
    expect(JSON.parse(posted!.body!)).toEqual({ assignment_id: QUESTION.assignment_id })
  })

  // R204, on the channel the daemon reads: the query string of the next poll.
  //
  // The render between the two advances is R219's doing, and this test asserted its absence before
  // it: two polls' worth of silence used to keep the claim, which is the defect itself written as an
  // expectation -- a band that is not being rendered went on claiming a question it could not draw.
  // A claim now lasts only as long as the drawing does, so a test that means to watch a *live* band
  // claim has to keep rendering one.
  test('claims the question on every poll while it draws it, and stops when it yields', async ($, on) => {
    const w = world(on)
    await $.session.start(SESSION)
    await w.clock.settle()
    await $.ui.render(above())
    await w.clock.advance(2_000)
    expect(w.bandPolls().at(-1)?.url).toContain(`&drawn=${QUESTION.assignment_id}`)
    await $.ui.render(above())
    await w.clock.advance(2_000)
    expect(w.bandPolls().at(-1)?.url).toContain(`&drawn=${QUESTION.assignment_id}`)

    expect(textOf(await $.ui.render(above({ hasSurvey: true })))).toBe('(the band beneath)')
    await w.clock.advance(2_000)
    expect(w.bandPolls().at(-1)?.url).not.toContain('drawn=')

    await $.ui.render(above())
    expect(textOf(await $.ui.render(above({ bodyColumns: 27 })))).toBe('(the band beneath)')
    await w.clock.advance(2_000)
    expect(w.bandPolls().at(-1)?.url).not.toContain('drawn=')
  })

  // R219. Claude Code's own feedback survey takes the AbovePrompt slot by stopping the render hook
  // from being dispatched at all -- measured silences of 98 s and 67 s in the §23 operator run, with
  // `&drawn=` still going out on every poll through both. The daemon therefore kept the question off
  // the status line for a band that could not draw it, and it was on neither surface until it
  // expired. Nothing in the host's `ui.*` events reports a render site being taken, so the absence of
  // a render is the only signal there is -- and that absence is written here as what it really is:
  // the test stops rendering. The channel is the one the daemon reads, the next poll's query string.
  test('releases the claim when the render hook stops being dispatched, and not before', async ($, on) => {
    const w = world(on)
    await $.session.start(SESSION)
    await w.clock.settle()
    await $.ui.render(above()) // t = 0, the last render there will be.

    // One whole poll into the silence the claim is still the band's. BAND_RENDER_STALE_MS is longer
    // than one poll interval on purpose: at or below it, a single slow or folded frame releases a
    // claim the band is still drawing, and the question shows in the band and on the status line at
    // once -- R204's cost, arriving from the fix for R219.
    await w.clock.advance(2_000)
    expect(w.bandPolls().at(-1)?.url).toContain(`&drawn=${QUESTION.assignment_id}`)

    // 3 999 ms of silence, still inside the window. A second `session.start` is how a poll is forced
    // off the 2-second rhythm; it resets the arming state and touches nothing this test reads.
    await w.clock.advance(1_999)
    await $.session.start(SESSION)
    await w.clock.settle()
    expect(w.bandPolls().at(-1)?.url).toContain(`&drawn=${QUESTION.assignment_id}`)

    // 4 000 ms: the poll that finds no render since the one before it drops the claim on that same
    // poll, not the next. It has to happen below the daemon's BAND_FRESH_MS (6 000 ms), or the daemon
    // has already expired the claim by itself and this release is dead code that reads as a guarantee.
    await w.clock.advance(1)
    expect(w.bandPolls().at(-1)?.url).not.toContain('drawn=')

    // And it stops asking for redraws once it has let the question go. The request exists to find out
    // whether the module is being drawn, not to fight the survey for the slot: two more polls ask for
    // nothing. The band returns on the host's own next dispatch, which the props of a running turn
    // produce constantly.
    const asked = w.invalidates.length
    await w.clock.advance(4_000)
    expect(w.invalidates).toHaveLength(asked)
  })

  // The direction the release must not take, watched as well as the failing one (R99, plan 2): a band
  // that is still being rendered keeps its claim for as long as it draws, however long that is. It is
  // the half a staleness rule breaks silently -- a released live claim costs no error, just the
  // question appearing on the status line beneath a band that is still showing it.
  test('keeps the claim for as long as the renders keep arriving, asking for each one', async ($, on) => {
    const w = world(on)
    await $.session.start(SESSION)
    await w.clock.settle()
    await $.ui.render(above())
    // The arming invalidate (R202) fires at 1 500 ms; taken before the loop so that every redraw
    // counted below is one the poll asked for and nothing else.
    await w.clock.advance(1_500)
    for (let i = 0; i < 6; i += 1) {
      await $.ui.render(above())
      const asked = w.invalidates.length
      await w.clock.advance(2_000)
      expect(w.bandPolls().at(-1)?.url).toContain(`&drawn=${QUESTION.assignment_id}`)
      // The renders keep arriving because the module keeps asking: exactly one redraw per poll while
      // it draws. That request is what makes a missing render mean anything -- a steady question
      // never changes, so `show()` alone would leave an idle terminal looking exactly like a survey
      // holding the band, and the claim would lapse under a band that is still drawing it.
      expect(w.invalidates).toHaveLength(asked + 1)
    }
    // 13.5 s of drawing, more than twice the daemon's claim window, with no gap the release could
    // read as silence.
    expect(w.clock.now()).toBe(13_500)
    expect([...new Set(w.invalidates)]).toEqual(['ui.render'])
  })

  // R219's other half, and the weakest of the press tests: its refusal happens only AFTER the claim
  // has been released, so it passes on `drawing === null` alone and says nothing about freshness --
  // R220 records exactly that. It is kept because the released-claim path is real and worth holding,
  // but the guard's guarantee is asserted where the guard is actually exercised: the freshness test
  // below and the two cross-window ones. The strongest claim in this file used to sit here, on the
  // test least able to support it.
  // Both directions are here, because a guard that refuses everything passes the first half alone.
  test('a press for an assignment it is no longer drawing spends nothing, and the next one does', async ($, on) => {
    const w = world(on)
    await $.session.start(SESSION)
    await w.clock.settle()
    await $.ui.render(above())
    await w.clock.advance(1_500)
    await $.ui.render(above()) // t = 1 500, armed, and the last render for the next 4 500 ms.
    await w.clock.advance(4_500)
    expect(w.bandPolls().at(-1)?.url).not.toContain('drawn=')

    await $.ui.press({ plugin: 'tickover', key: 'option-1' })
    await w.clock.settle()
    expect(w.requests.find((r) => r.url.endsWith('/v1/answer'))).toBeUndefined()
    expect(w.toasts).toEqual([])

    // The skip key is guarded on the same state and asserted separately, or the guard on it is a
    // second copy that nothing can turn red. A phantom skip costs as much as a phantom answer: the
    // question goes, and the skip-pause rule counts it against the developer who never pressed it.
    await $.ui.press({ plugin: 'tickover', key: 'skip' })
    await w.clock.settle()
    expect(w.requests.find((r) => r.url.endsWith('/v1/skip'))).toBeUndefined()

    // The same handle, one render later: the band is back on the site and the key spends the answer
    // it was always meant to.
    await $.ui.render(above())
    await $.ui.press({ plugin: 'tickover', key: 'option-1' })
    await w.clock.settle()
    expect(JSON.parse(w.requests.find((r) => r.url.endsWith('/v1/answer'))!.body!))
      .toEqual({ assignment_id: QUESTION.assignment_id, option_index: 0, source: 'claude' })
  })

  // R220, the hole the test above could not see. Its refusal happens after the claim has been
  // released, so it passes on `drawing === null` alone -- and `drawing` is not cleared when rendering
  // stops, it survives until poll() releases it up to BAND_RENDER_STALE_MS later. So the guard was
  // open for the first four seconds of a render silence: the branch review pressed at 3 000 ms and
  // got a real POST /v1/answer for a question nobody could see. That is the moment a survey has just
  // taken the band and the developer is most likely typing.
  //
  // Both bounds are watched here, and both presses happen while the claim is still held -- asserted
  // on `&drawn=` at the refusal, which is what tells this window apart from a released claim and
  // stops the test passing for the earlier test's reason.
  //
  // What the guard holds, stated where it is exercised: a press is refused unless the band finished
  // drawing that assignment within BAND_PRESS_FRESH_MS. It does NOT hold that the band is on the
  // screen -- nothing can, and the window is a proxy for it -- nor that the assignment is still the
  // current one, which the daemon settles by answering `not_current` with no money moved. Whether a
  // keystroke can reach a live Button while Claude Code's own survey holds the slot is **unverified**;
  // `drawnNow` in band.tsx carries what would settle it (R220).
  test('a press spends the answer one poll after the last render, and no longer at BAND_PRESS_FRESH_MS', async ($, on) => {
    const w = world(on)
    await $.session.start(SESSION)
    await w.clock.settle()
    await $.ui.render(above())
    await w.clock.advance(1_500)
    await $.ui.render(above()) // t = 1 500: armed, and drawn.

    // poll() asks for a redraw every 2 000 ms while the band draws, so a healthy drawing is never
    // more than one poll interval old. A press exactly that far from the last render is legitimate
    // and must spend the answer, or the window is too tight to survive the module's own rhythm and a
    // developer's keystroke silently does nothing.
    await w.clock.advance(2_000)
    await $.ui.press({ plugin: 'tickover', key: 'option-1' })
    await w.clock.settle()
    expect(w.requests.filter((r) => r.url.endsWith('/v1/answer'))).toHaveLength(1)

    await $.ui.render(above()) // t = 3 500: the last render there will be.
    await w.clock.advance(2_500)
    // Still claimed -- 2 500 ms is inside BAND_RENDER_STALE_MS, so what refuses the presses below is
    // the press window and not the claim having lapsed.
    expect(w.bandPolls().at(-1)?.url).toContain(`&drawn=${QUESTION.assignment_id}`)
    await $.ui.press({ plugin: 'tickover', key: 'option-2' })
    await $.ui.press({ plugin: 'tickover', key: 'skip' })
    await w.clock.settle()
    expect(w.requests.filter((r) => r.url.endsWith('/v1/answer'))).toHaveLength(1)
    expect(w.requests.find((r) => r.url.endsWith('/v1/skip'))).toBeUndefined()
  })

  // R220, fix round 2 -- the guard read its two facts at different times. `drawnNow` tested
  // `drawing` *before* awaiting the clock and read `lastRenderAt` *after* it, while the render hook
  // writes `lastRenderAt` at its top and clears `drawing` a few statements later with no await
  // between them. A render landing while a press sat on the clock therefore handed the guard a fresh
  // `lastRenderAt` paired with a stale `drawing`, and it returned true: the concurrent render had
  // just handed the question back to the status line, and the press bought the answer anyway.
  //
  // Nothing in the kit could tell the two orderings apart. The press test above guards the freshness
  // *clause*; these two guard the *sequence*, and that all 23 tests stayed green under the repair is
  // the finding rather than a reassurance. The interleaving is expressed with the kit's own
  // `settle()` -- "the step between starting a dispatch unawaited and looking at what it did" --
  // rather than with a hack, so what is asserted is the module's real ordering and not the test's.
  //
  // The press is 2 700 ms stale in both, past BAND_PRESS_FRESH_MS, so it is refused on its own
  // merits: the only thing that can buy an answer here is the torn read.
  test('a stale press buys nothing when a yielding render lands while it waits on the clock', async ($, on) => {
    const w = world(on)
    await $.session.start(SESSION)
    await w.clock.settle()
    await $.ui.render(above())
    await w.clock.advance(1_500)
    await $.ui.render(above()) // t = 1 500: armed and drawn.
    await w.clock.advance(2_700)

    // The press goes first and is left in flight -- it reads `drawing`, then waits on the clock.
    const press = $.ui.press({ plugin: 'tickover', key: 'option-1' })
    // The survey takes the band while it waits: this render refreshes `lastRenderAt` and clears
    // `drawing`, the exact pairing the torn read could not see.
    const render = $.ui.render(above({ hasSurvey: true }))
    await w.clock.settle()
    await press
    await render

    expect(w.requests.find((r) => r.url.endsWith('/v1/answer'))).toBeUndefined()
  })

  // The same two events in the other order: the render is dispatched first and the press is raised
  // while it is in flight. Both orderings are kept because a repair that happens to order one of
  // them correctly is not a repair -- the guard must not be able to straddle the write pair at all.
  test('a stale press buys nothing when it is raised while a yielding render is in flight', async ($, on) => {
    const w = world(on)
    await $.session.start(SESSION)
    await w.clock.settle()
    await $.ui.render(above())
    await w.clock.advance(1_500)
    await $.ui.render(above())
    await w.clock.advance(2_700)

    const render = $.ui.render(above({ hasSurvey: true }))
    const press = $.ui.press({ plugin: 'tickover', key: 'option-1' })
    await w.clock.settle()
    await render
    await press

    expect(w.requests.find((r) => r.url.endsWith('/v1/answer'))).toBeUndefined()
  })

  // The third ordering. This assertion was the OPPOSITE one round ago, and the reversal is
  // deliberate: it said a stale press whose concurrent render draws the same assignment does buy the
  // answer, on the reasoning that "by the time the press is decided the band is on screen showing that
  // assignment". That reasoning was wrong. The render is still in flight, so the frame on the screen
  // is the one drawn 2 700 ms ago -- which is exactly what BAND_PRESS_FRESH_MS calls too old to
  // trust. The old behaviour only looked right because `lastRenderAt` was refreshed at the top of the
  // render, before it had drawn anything (R220, fix round 4).
  //
  // Recorded rather than quietly flipped, for the reason the round-5 report gives: flipping an
  // assertion a round after writing it is how a suite drifts into agreeing with whatever the code
  // does. What makes this one legitimate is that it is the SAME rule applied consistently -- a press
  // is measured from the last completed drawing of that assignment, whatever else is in flight -- and
  // it removes a special case rather than adding one.
  test('a stale press buys nothing even when the concurrent render draws the same assignment again', async ($, on) => {
    const w = world(on)
    await $.session.start(SESSION)
    await w.clock.settle()
    await $.ui.render(above())
    await w.clock.advance(1_500)
    await $.ui.render(above())
    await w.clock.advance(2_700)

    const press = $.ui.press({ plugin: 'tickover', key: 'option-1' })
    const render = $.ui.render(above())
    await w.clock.settle()
    await press
    await render

    expect(w.requests.filter((r) => r.url.endsWith('/v1/answer'))).toHaveLength(0)

    // And the passing direction from the same state, so this is not a test that refuses everything:
    // once that render has finished drawing, the pair is current and the same key spends the answer.
    await $.ui.render(above())
    await $.ui.press({ plugin: 'tickover', key: 'option-1' })
    await w.clock.settle()
    expect(JSON.parse(w.requests.find((r) => r.url.endsWith('/v1/answer'))!.body!))
      .toEqual({ assignment_id: QUESTION.assignment_id, option_index: 0, source: 'claude' })
  })

  // R220, fix round 5. `drawnAt` was written from `lastRenderAt`, which the hook reads at its TOP --
  // before `await $.ui.resolve(e)` and `await next(e)`. So the press window was measured from when the
  // dispatch BEGAN, not from when the band finished drawing, and the render's own duration was being
  // charged against it: the effective window is BAND_PRESS_FRESH_MS minus however long the render
  // took. With 2 500 against a 2 000 poll interval, the 500 ms of slack that R220 records as standing
  // in for invalidate-to-dispatch latency had to absorb the whole beneath chain as well -- every other
  // plugin's AbovePrompt hook, against a host budget the spec puts at 10 s. Any chain slower than
  // 500 ms silently refuses a legitimate keystroke at the end of a poll cycle, with no toast, and the
  // daemon guard `pressMs > pollMs` that exists to prevent exactly that cannot see it.
  //
  // EVERY ADVANCE BELOW IS DERIVED FROM `slow`, and that is the whole design of the test. The first
  // version hard-coded them, so at zero delay the gaps remained and the press was refused anyway --
  // under the fix AND under the defect. Its comment claimed it caught a slow render; it actually
  // caught instants I had counted out by hand, and a mutation setting the delay to zero is what
  // exposed it. That is R222's own shape, written into the round that added R222. Derived from `slow`,
  // the control is real: at zero delay the test passes under both, so a failure can only come from
  // duration being charged against the window.
  // The criterion, because it is easy to lose: a control that passes only under the fix is not a
  // control, it is a second test of the fix. It has to pass under the DEFECT too -- that is what
  // proves the assertion turns on the delay rather than on where the advances put the instants.
  test('a press one poll after a slow render still spends the answer', async ($, on) => {
    const w = world(on)
    const slow = 600 // longer than the 500 ms of slack BAND_PRESS_FRESH_MS leaves over one poll.
    w.state.beneathDelayMs = slow
    await $.session.start(SESSION)
    await w.clock.settle()

    const first = $.ui.render(above())
    await w.clock.advance(slow)
    await first
    await w.clock.advance(1_500) // the hotkeys arm.
    const second = $.ui.render(above())
    await w.clock.advance(slow)
    await second
    const finished = w.clock.now() // observed, not computed: when the band actually finished drawing.

    // One poll interval after the drawing FINISHED -- the healthy worst case the window exists to
    // allow, pinned at zero delay by `a press spends the answer one poll after the last render`.
    // Dated from the dispatch start instead, the age here is 2 000 + `slow`, and a press is refused
    // for a render that was merely slow.
    await w.clock.advance(2_000)
    expect(w.clock.now() - finished).toBe(2_000)
    await $.ui.press({ plugin: 'tickover', key: 'option-1' })
    await w.clock.settle()
    expect(w.requests.filter((r) => r.url.endsWith('/v1/answer'))).toHaveLength(1)
  })

  // R220, fix round 6. Dating `drawnAt` from the completion removed an ACCIDENTAL protection, in the
  // spending direction, on the money path. A render slower than BAND_RENDER_STALE_MS outlives the
  // claim release: poll() measures from `lastRenderAt` (the dispatch start) and drops `drawing`
  // mid-render, handing the question back to the status line. The render then completes, re-sets
  // `drawing`, and -- because `drawnAt` is now the completion -- writes a FRESH timestamp. The press
  // window re-opens for a full 2 500 ms at the very moment the module has concluded it is not being
  // rendered.
  //
  // The old code refused this by accident, measuring from the dispatch start, so the age was the whole
  // render duration. That makes this a regression this range introduced rather than behaviour we are
  // declining to fix -- which is what decides it, because a paid answer spent on something the
  // developer could not see is unrecoverable by them while a refused press recovers on the next poll.
  //
  // The mid-render poll carrying no `&drawn=` is asserted, not assumed: it is what proves the claim
  // had genuinely lapsed, so the press below is refused by the gate rather than by a claim that never
  // went away.
  test('a render outliving the claim release does not re-open the press window', async ($, on) => {
    const w = world(on)
    const slower = 5_000 // longer than BAND_RENDER_STALE_MS, so the claim lapses mid-render.
    w.state.beneathDelayMs = slower
    await $.session.start(SESSION)
    await w.clock.settle()

    const first = $.ui.render(above())
    await w.clock.advance(slower)
    await first
    await w.clock.advance(1_500) // the hotkeys arm.

    const second = $.ui.render(above()) // dispatched now; it will not complete for `slower` ms.
    await w.clock.advance(slower)
    await second

    // The claim lapsed while that render was in flight -- poll() measures from the dispatch start.
    expect(w.bandPolls().at(-1)?.url).not.toContain('drawn=')

    await $.ui.press({ plugin: 'tickover', key: 'option-1' })
    await w.clock.settle()
    expect(w.requests.filter((r) => r.url.endsWith('/v1/answer'))).toHaveLength(0)
  })

  // The other half of the gate, written after a false conclusion deleted the CLAIM it holds. Not
  // "restored": no such test was ever committed -- verified, no commit in this file's history removes
  // one, and the test count never falls -- so round 10 discarded scratch work rather than coverage.
  // An earlier version of this line said "restored after being deleted", which a reader would search
  // history for and never find. Clearing `drawing` and skipping the two writes DO diverge -- but only
  // when dispatches overlap, which is why three constructions that each used one render at a time all
  // measured them identical.
  //
  // The mechanism is the whole of it. The gate keys on the render's OWN duration, a local. poll()'s
  // release keys on `now - lastRenderAt`, which is module-global and refreshed by any newer dispatch.
  // With a second render in flight the release never fires, so the gate runs against a LIVE claim and
  // the two arms part; with one render at a time the release always fires first and they coincide.
  // That single case is the one all three constructions happened to build, and the instrument answered
  // the question it was built rather than the question being asked.
  //
  // The window is NARROW, and the first version of this test failed differently from the three earlier
  // constructions: it reached the overlapping case and then read the wrong row. It advanced to the end
  // and asserted on the last poll -- by which time poll()'s release had fired and set `drawing` to null
  // under BOTH arms, 30 pass / 0 fail. The release reaches the same state from the other side, so any
  // construction that measures past it reports "identical" whatever the gate does. The window runs from
  // the gate firing to the first poll that sees `now - lastRenderAt` stale, and the assertion has to
  // land inside it: on the original timing the arms differ at t = 6 000 and converge at t = 8 000 where
  // the release fires, so `at(3)` alone separates them -- measured. The remedy was the assertion point,
  // not the clock. That difference at t = 6 000 is also the positive control for the null at t = 8 000:
  // without one, a null cannot tell "measured past the window" from "no difference exists", which is
  // the trap round 10's identical prints fell into.
  //
  // Whether the host ever overlaps AbovePrompt dispatches in production is **unknown** -- band.tsx
  // never consults `next.signal` -- so this pins the module's behaviour under overlap. It does not
  // assert that overlap occurs, and the comment at the gate must not either.
  test('with dispatches overlapping, clearing the claim is what stops a stale assignment being sent', async ($, on) => {
    const w = world(on)
    w.state.beneathDelayMs = 0
    await $.session.start(SESSION)
    await w.clock.settle()
    await $.ui.render(above()) // fast: `drawing` becomes A.

    // The daemon moves on, so a stale claim here would name A while the band draws B.
    w.state.band = { ...QUESTION, assignment_id: '3c1d5a77-0000-4000-8000-000000000004' }
    await w.clock.advance(1_000)

    w.state.beneathDelayMs = 5_000
    const first = $.ui.render(above()) // t = 1 000 -> completes 6 000, own duration 5 000: the gate fires.
    await w.clock.advance(4_000)
    const second = $.ui.render(above()) // t = 5 000: refreshes lastRenderAt, holding the release off.
    await w.clock.advance(3_000)
    await first

    // t = 8 000, inside the window: the first render's gate has fired on its own 5 000 ms duration,
    // and poll()'s release has not, because 8 000 - 5 000 = 3 000 is still fresh. Clearing sends
    // nothing here; skipping the two writes sends `&drawn=A` for a question the band is not drawing.
    expect(w.bandPolls().at(-1)?.url).not.toContain('drawn=')

    await w.clock.advance(5_000)
    await second
  })

  // The gate's boundary, which nothing pinned: `>=` mutated to `>` was kit 29 / 0 and the daemon
  // guards 12 / 12, so the one comparison deciding whether a render re-claims was free to move.
  // Observed through the PRESS rather than through a poll, deliberately: the else branch writes
  // `drawnAt` as well as `drawing`, and poll()'s release would erase a claim difference before any
  // poll could report it -- the same erasure that made three constructions of the test above read
  // "identical". The press window has no such second path to the same state.
  test('a render whose own duration is exactly BAND_RENDER_STALE_MS releases instead of re-claiming', async ($, on) => {
    const w = world(on)
    await $.session.start(SESSION)
    await w.clock.settle()
    await $.ui.render(above())
    await w.clock.advance(1_500) // the hotkeys arm.

    w.state.beneathDelayMs = 4_000 // exactly BAND_RENDER_STALE_MS: `>=` clears, `>` would re-claim.
    const slow = $.ui.render(above())
    await w.clock.advance(4_000)
    await slow

    await $.ui.press({ plugin: 'tickover', key: 'option-1' })
    await w.clock.settle()
    expect(w.requests.filter((r) => r.url.endsWith('/v1/answer'))).toHaveLength(0)
  })

  // The control for it, and it must pass under the fix AND under `>`: one millisecond below the
  // window, both comparisons take the else branch and the press spends. Without this, the refusal
  // above would be evidence only that presses can be refused, not that the boundary is where.
  test('a render one millisecond short of the window still re-claims, and the press spends', async ($, on) => {
    const w = world(on)
    await $.session.start(SESSION)
    await w.clock.settle()
    await $.ui.render(above())
    await w.clock.advance(1_500)

    w.state.beneathDelayMs = 3_999
    const slow = $.ui.render(above())
    await w.clock.advance(3_999)
    await slow

    await $.ui.press({ plugin: 'tickover', key: 'option-1' })
    await w.clock.settle()
    expect(w.requests.filter((r) => r.url.endsWith('/v1/answer'))).toHaveLength(1)
  })

  // R220, fix round 4: the same tear class, on the pairing nobody enumerated. The extraction made the
  // two reads atomic -- but atomically WRONG on the drawing path. The render hook writes
  // `lastRenderAt` at its top and sets `drawing` only after two awaits (`$.ui.resolve`, `next(e)`), so
  // while a render for a NEW assignment is in flight the pair reads (previous assignment, fresh
  // timestamp), and a stale press for the previous assignment passes on a timestamp that belongs to
  // the next one.
  //
  // The case was dismissed in round 5 as P3 -- the render that draws the SAME assignment, where
  // allowing is correct. A render that draws a DIFFERENT one is not that case, and it was never
  // enumerated. No money moves: the daemon answers `not_current` with `earned_cents: 0` before it
  // enqueues (question-loop.ts, at `cur.question.assignment_id !== input.assignmentId`). What it costs
  // is a press spent and a developer told that a question they never saw has closed.
  test('a stale press for the previous assignment buys nothing while a render for the next is in flight', async ($, on) => {
    const w = world(on)
    await $.session.start(SESSION)
    await w.clock.settle()
    await $.ui.render(above())
    await w.clock.advance(1_500)
    await $.ui.render(above()) // t = 1 500: A is armed, drawn, and claimed.

    // The daemon moves on. The next poll makes `view` the new assignment while `drawing` still says A,
    // because no render has completed since.
    w.state.band = { ...QUESTION, assignment_id: '3c1d5a77-0000-4000-8000-000000000002' }
    await w.clock.advance(2_700) // t = 4 200: the press below is 2 700 ms past its last drawing.

    // The claim is still A's and still fresh, exactly as in the branch review's probe -- so what must
    // refuse the press is the press window, not a lapsed claim.
    expect(w.bandPolls().at(-1)?.url).toContain(`&drawn=${QUESTION.assignment_id}`)

    const press = $.ui.press({ plugin: 'tickover', key: 'option-1' })
    const render = $.ui.render(above()) // draws the NEW assignment, refreshing the timestamp on its way.
    await w.clock.settle()
    await press
    await render

    expect(w.requests.filter((r) => r.url.endsWith('/v1/answer'))).toHaveLength(0)
  })

  // The boundary min_columns exists to hold, which nothing rendered at 120 or 27 can see. The kit
  // renders a tree, not a terminal frame, so no test here can watch a row wrap; what it can watch is
  // the promise that makes wrapping impossible -- at the narrowest width the module agrees to draw,
  // the bullet, the header and the amount all fit on row 1. Counted in code points, which equals
  // display columns for this header (every character in it is one column wide); the CJK case, where
  // that stops being true, is pinned against string-width in packages/daemon/test/unit/band.test.ts.
  test('at exactly min_columns it draws, with the bullet, sponsor and amount all on the first row', async ($, on) => {
    const w = world(on)
    await $.session.start(SESSION)
    await w.clock.settle()
    const text = textOf(await $.ui.render(above({ bodyColumns: QUESTION.min_columns })))
    expect(text).toContain(`● ${QUESTION.header} · ${QUESTION.text}`)
    expect([...`● ${QUESTION.header}`].length).toBeLessThanOrEqual(QUESTION.min_columns)
  })

  test('one column below min_columns it yields the question to the status line', async ($, on) => {
    const w = world(on)
    await $.session.start(SESSION)
    await w.clock.settle()
    expect(textOf(await $.ui.render(above({ bodyColumns: QUESTION.min_columns - 1 })))).toBe('(the band beneath)')
  })

  test('draws nothing on a surface other than the terminal', async ($, on) => {
    const w = world(on)
    await $.session.start(SESSION)
    await w.clock.settle()
    expect(textOf(await $.ui.render(above({}, 'desktop')))).toBe('(the band beneath)')
  })

  test('the answered view is one row, with no buttons', async ($, on) => {
    const w = world(on, ANSWERED)
    await $.session.start(SESSION)
    await w.clock.settle()
    const tree = await $.ui.render(above())
    expect(textOf(tree)).toContain('✓ +$0.50')
    expect(buttonIn(tree, 'option-1')).toBeUndefined()
  })

  test('a daemon that is down draws nothing, says nothing, and is polled less often', async ($, on) => {
    const w = world(on)
    w.state.down = true
    await $.session.start(SESSION)
    await w.clock.settle()
    expect(textOf(await $.ui.render(above()))).toBe('(the band beneath)')
    await w.clock.advance(10_000)
    // 0 s fails -> next at 4 s; 4 s fails -> next at 12 s. Without backoff this would be 6.
    expect(w.bandPolls()).toHaveLength(2)
    expect(w.toasts).toEqual([])
  })

  // The design, "Discovery": the module "re-reads them after any failed request". It cleared the cached
  // port and token on a 401 and on a thrown fetch, and on nothing else -- so anything that answered
  // on the cached port with some other status (a daemon that restarted into an error, another
  // process that took the port) left the band dead for the whole life of the process, silently.
  // Counted on the channel that carries the re-read: the second read of daemon.json.
  test('re-reads daemon.json after a failed request that is not a 401', async ($, on) => {
    const w = world(on)
    w.state.bandStatus = 503
    await $.session.start(SESSION)
    await w.clock.settle()
    expect(w.reads).toHaveLength(1)
    // 0 s fails -> the backoff puts the next poll at 4 s, and that one must read the file again.
    await w.clock.advance(4_000)
    expect(w.reads).toHaveLength(2)
  })

  // The middle of the range, which neither of the two cases around it reaches: the 503 above sits on
  // one side of `>= 400` and the 204 below on the other, so a module that re-read the file on 4xx and
  // 5xx alone stayed green while every status between 200 and 399 kept a cache it should have thrown
  // away. It is reachable in shipped code: the daemon binds an ephemeral port, restarts onto another,
  // and some other local process takes the old one -- a squatter answering a redirect is the common
  // local case, and it is not an error, so nothing else in the module would ever notice. `poll()` has
  // always treated any non-200 as a failure; this is the half of the module that disagreed with it.
  // Counted on the same channel as the 503 above: the second read of daemon.json.
  test('re-reads daemon.json after a redirect from whatever now holds the port', async ($, on) => {
    const w = world(on)
    w.state.bandStatus = 302
    await $.session.start(SESSION)
    await w.clock.settle()
    expect(w.reads).toHaveLength(1)
    // 0 s fails -> the backoff puts the next poll at 4 s, and that one must read the file again.
    await w.clock.advance(4_000)
    expect(w.reads).toHaveLength(2)
  })

  // The other side of the same line, and the case `r.status !== 200` got wrong: the daemon answers a
  // successful skip with **204** (packages/daemon/src/http.ts:219, `res.writeHead(ok ? 204 : 404)`).
  // 204 is not a failed request, and the design's "Discovery" section says the module re-reads the
  // port and token "after any failed request" -- so every skip was throwing away a perfectly good
  // cache and going back to disk (measured: reads 1 before a skip, 2 after).
  test('a skip answered 204 keeps the cached port and token rather than re-reading daemon.json', async ($, on) => {
    const w = world(on)
    await $.session.start(SESSION)
    await w.clock.settle()
    await $.ui.render(above())
    await w.clock.advance(1_500)
    await $.ui.render(above())
    expect(w.reads).toHaveLength(1)
    await $.ui.press({ plugin: 'tickover', key: 'skip' })
    await w.clock.settle()
    expect(w.requests.find((r) => r.url.endsWith('/v1/skip'))).toBeDefined()
    expect(w.reads).toHaveLength(1)
  })

  test('an answer that cannot be sent says so', async ($, on) => {
    const w = world(on)
    await $.session.start(SESSION)
    await w.clock.settle()
    await $.ui.render(above())
    await w.clock.advance(1_500)
    await $.ui.render(above())
    w.state.down = true
    await $.ui.press({ plugin: 'tickover', key: 'option-1' })
    await w.clock.settle()
    expect(w.toasts).toEqual(['tickover: answer not sent — daemon off'])
  })

  // Spec 5.5's central promise (DISCLOSURE.never): no file contents, no file paths, no prompts and
  // no transcripts leave the machine. scripts/test-mod.mjs cannot hold that one. A read of another
  // path, or a POST to another host, added *inside* readDaemon or request adds no new call site, so
  // validate's `calls:` inventory line is byte-identical with the leak in place. These are the
  // channels that do move, and each is asserted whole rather than collapsed to a label: the path of
  // every read, every URL in full -- port, path and query string -- every header, and every body.
  test('reads only daemon.json, reaches only the daemon URLs, and sends nothing it was not given', async ($, on) => {
    const w = world(on)
    await $.session.start(SESSION)
    await w.clock.settle()
    await $.ui.render(above())
    await w.clock.advance(1_500)
    await $.ui.render(above())
    await w.clock.advance(2_000)
    await $.ui.press({ plugin: 'tickover', key: 'option-1' })
    await w.clock.settle()
    await $.ui.render(above())
    await $.ui.press({ plugin: 'tickover', key: 'skip' })
    await w.clock.settle()

    // The daemon's own file collapses to one label, so any other path survives into the failure
    // verbatim and names itself. The empty array fails this too: a run that read nothing would prove
    // nothing. The pattern is anchored at the drive and at the root (see its definition): a tail
    // match would have accepted `/evil/home/dev/.tickover/daemon.json`.
    const READ = '/home/dev/.tickover/daemon.json'
    const paths = w.reads.map((p) => p.replace(/\\/g, '/')).map((p) => (DAEMON_FILE.test(p) ? READ : p))
    expect([...new Set(paths)]).toEqual([READ])

    // Whole URLs, not a label. Collapsing every matching URL to one string threw away the port, the
    // path and the query string -- and the query string is where a GET's payload rides: a leak
    // appended to the genuine /v1/band URL was 18 pass / 0 fail, as was a fetch of another loopback
    // port. These four are every URL the module may reach, in full, so a fifth names itself here.
    expect([...new Set(w.requests.map((r) => r.url))].sort()).toEqual([
      `${DAEMON_BASE}/v1/answer`,
      `${DAEMON_BASE}/v1/band?session_id=session-1`,
      `${DAEMON_BASE}/v1/band?session_id=session-1&drawn=${QUESTION.assignment_id}`,
      `${DAEMON_BASE}/v1/skip`,
    ])

    // A header is a channel too, and only `x-tickover-token` was being recorded. The module may
    // send exactly what it was given -- that token, read from daemon.json, and the content type of
    // the bodies below -- and no third header: one was 18 pass / 0 fail. Not vacuous, because the
    // four URLs above are already required, so there are requests to iterate over.
    const GIVEN = { 'x-tickover-token': 'tok', 'content-type': 'application/json' }
    for (const r of w.requests) expect(r.headers).toEqual(GIVEN)

    // The body is where a path or a prompt would actually travel, so it is asserted as a whitelist of
    // everything the module may send, not as a search for the bad strings we happened to think of.
    expect(w.requests.map((r) => r.body).filter((b) => b !== undefined)).toEqual([
      JSON.stringify({ assignment_id: QUESTION.assignment_id, option_index: 0, source: 'claude' }),
      JSON.stringify({ assignment_id: QUESTION.assignment_id }),
    ])
  })

  test('an answer the daemon no longer holds says the question closed', async ($, on) => {
    const w = world(on)
    w.state.answer = { status: 200, text: JSON.stringify({ accepted: false, reason: 'not_current', earned_cents: 0 }) }
    await $.session.start(SESSION)
    await w.clock.settle()
    await $.ui.render(above())
    await w.clock.advance(1_500)
    await $.ui.render(above())
    await $.ui.press({ plugin: 'tickover', key: 'option-1' })
    await w.clock.settle()
    expect(w.toasts).toEqual(['tickover: that question already closed'])
  })

  // band.tsx's `ui.render` catch block, opening "A second dispatch beneath is harmless", which no
  // test drove until this one -- and which
  // world()'s privacy seal is justified by: a leak on a path no test exercises leaves no record for
  // any one test to read back, so the invariant has to live in the hooks. The module casts the
  // daemon's JSON to a BandView without validating it (a hooks module cannot import the contract),
  // so a view whose `options` is not an array is what something answering on the daemon's port
  // really would produce: `v.options.map` throws mid-render, after `drawing` has been set. Both
  // halves are asserted, because the catch does two things -- the prompt keeps what is beneath it,
  // and the claim is released rather than held for a question the band is not drawing (R204).
  test('a view the daemon could not have composed leaves the prompt alone and releases the claim', async ($, on) => {
    const w = world(on, { ...QUESTION, options: 'Postgres, faster' })
    await $.session.start(SESSION)
    await w.clock.settle()
    expect(textOf(await $.ui.render(above()))).toBe('(the band beneath)')
    await w.clock.advance(2_000)
    expect(w.bandPolls().at(-1)?.url).not.toContain('drawn=')
    // Driving the block is not the same as watching it. Both assertions above are *absence*
    // assertions -- the prompt keeps what is beneath it, and no claim is sent -- and a sealed world
    // makes both of them more likely to pass, so this is the one test in the kit that a seal cannot
    // redden: every other test goes on needing a working daemon, and this one, by design, does not.
    // Measured: a swallowed `$.http.fetch('http://127.0.0.1:9/v1/leak?p=catch')` inside the catch
    // block was 19 pass / 0 fail without the line below, and so was `$.fs.read('/etc/passwd')`. The
    // violation was recorded by world() and read back by nobody. This line reads it back, and it is
    // what makes the seal's justification true for the path it names (R215).
    expect(w.violations).toEqual([])
  })
})
