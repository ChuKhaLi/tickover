// `tk-pane`, and the one assertion the component exists for.
//
// The pane is the product. Everything else on the landing page is an argument for
// looking at it. So the defect worth testing is not that it renders -- that is
// visible -- but that what it renders is what the client would print. A replica that
// drifts is a false product claim on the page that makes the claim.
import { Component, signal, type Type } from '@angular/core'
import { TestBed } from '@angular/core/testing'
import { describe, it, expect } from 'vitest'
import { COLS_MAX, COLS_MIN, RULES, formatStatusLine, resolveColumns } from '@tickover/contract'
import { Pane } from './pane'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

function mount<T>(type: Type<T>) {
  TestBed.resetTestingModule()
  const fixture = TestBed.createComponent(type)
  fixture.detectChanges()
  return { fixture, el: fixture.nativeElement as HTMLElement }
}

@Component({
  imports: [Pane],
  template: `
    <tk-pane
      [cols]="cols()"
      [sponsor]="sponsor()"
      [payoutCents]="50"
      [question]="question()"
      [options]="['Postgres', 'SQLite', 'MySQL']"
      [todayPaid]="3"
      [pendingCents]="250"
      [availableCents]="1000"
    />`,
})
class PaneHost {
  cols = signal(120)
  sponsor = signal('Acme Analytics')
  question = signal('Which database do you reach for on a new side project?')
}

/**
 * A caller that fills the session slot, which is what the landing hero does (R318).
 * Its content deliberately paints two of the colours the composer also paints, and
 * says the word the composer also says, because that is how a slot leaks into an
 * assertion about the row.
 */
@Component({
  imports: [Pane],
  template: `
    <tk-pane [cols]="120" sponsor="Acme Analytics" [payoutCents]="50" question="Which database?" [options]="['Postgres']" scene="A terminal. " [todayPaid]="3" [pendingCents]="250" [availableCents]="1000">
      <div class="text-ink-400"><p>~/projects/acme &#183; tickover</p></div>
      <div class="text-white">a prompt someone typed &#183; $9.99</div>
    </tk-pane>`,
})
class SessionHost {}

const surface = (el: HTMLElement) => el.querySelector('[style]') as HTMLElement
/**
 * The composed row, and not the surface that holds it. The surface can also hold a
 * session above the line -- the landing hero puts one there -- and reading the whole
 * surface would let that content into every assertion about what the composer
 * returned, silently, on the day someone projects one.
 */
const row = (el: HTMLElement) => surface(el).querySelector('[data-line]') as HTMLElement
const shown = (el: HTMLElement) => row(el).textContent ?? ''

describe('tk-pane', () => {
  /**
   * The assertion the whole component exists for, and the one it shipped without.
   *
   * `formatStatusLine` moving into the contract stopped the web from growing a second
   * composer. It did not stop the web from *calling* the shared one differently, and
   * that is what happened: the daemon resolves a terminal width into a budget with
   * `resolveColumns` -- clamped, and six characters short, because Claude Code chops
   * the line at `COLUMNS-4` -- and this component passed the width straight through.
   * Every guard was green, the browser test passed, and 36 of the landing slider's 61
   * positions drew a line the client does not print (R358).
   *
   * So the comparison is against the daemon's whole path, not just the composer's.
   * The widths are chosen to include ones where the two answers differ: at 74 the
   * unmargined budget still fits the options and the real one does not.
   */
  it.each([68, 71, 72, 74, 80, 120])('composes at the width the client composes at, not the one it was given (%i)', (cols) => {
    const host = mount(PaneHost)
    host.fixture.componentInstance.cols.set(cols)
    host.fixture.detectChanges()

    const asTheClientWould = formatStatusLine({
      loggedIn: true,
      question: {
        assignment_id: '00000000-0000-4000-8000-000000000000',
        kind: 'choice',
        text: 'Which database do you reach for on a new side project?',
        options: ['Postgres', 'SQLite', 'MySQL'],
        context: null,
        sponsor: 'Acme Analytics',
        price_cents: 50,
        served_at: '2026-01-01T00:00:00.000Z',
        expires_at: '2026-01-01T00:05:00.000Z',
      },
      answered: null,
      todayPaid: 3,
      pendingCents: 250,
      availableCents: 1000,
      maxColumns: resolveColumns({ detected: cols }),
    })
    expect(shown(host.el), 'the replica is composing at a budget the client never uses').toBe(asTheClientWould)
  })

  /**
   * The same claim stated as the thing a visitor actually sees, because the equality
   * above would still pass if `resolveColumns` and the pane were wrong together.
   * Below the floor a real terminal shows the idle line; the page must not offer a
   * paid question there. The floor is read from the composer rather than written
   * down -- a literal here is the constant this defect was made of.
   */
  it('suppresses the question at the width the client suppresses it', () => {
    const host = mount(PaneHost)
    const at = (cols: number) => {
      host.fixture.componentInstance.cols.set(cols)
      host.fixture.detectChanges()
      return shown(host.el)
    }
    // From 30, not from 0: `resolveColumns` reads a non-positive width as "unknown"
    // and falls back to the 80-column default, so a search from zero finds a floor
    // that is really the default in disguise. That is M3 of the review seen from the
    // other side -- the component does not validate `cols`, and only the range input
    // upstream keeps it sane.
    const widths = Array.from({ length: 91 }, (_, i) => i + 30)
    const floor = widths.find((c) => at(c).includes('Acme Analytics'))!

    expect(at(floor - 1), 'a paid question is offered at a width the client shows nothing at').not.toContain('Acme Analytics')
    // Below the floor the client says a question is waiting, without its sponsor or text
    // (it showed the idle line until 2026-09-29, which told a narrow terminal nothing).
    expect(at(floor - 1)).toContain('question waiting')
    expect(at(floor)).toContain('Acme Analytics')
    // The floor is a fact about the composer, not about this component: it has to be
    // the width at which the *client* starts showing the question.
    expect(floor, 'the pane and the client disagree about where the question fits').toBe(
      widths.find((c) =>
        formatStatusLine({
          loggedIn: true,
          question: {
            assignment_id: '00000000-0000-4000-8000-000000000000', kind: 'choice',
            text: 'Which database do you reach for on a new side project?',
            options: ['Postgres', 'SQLite', 'MySQL'], context: null,
            sponsor: 'Acme Analytics', price_cents: 50,
            served_at: '2026-01-01T00:00:00.000Z', expires_at: '2026-01-01T00:05:00.000Z',
          },
          answered: null, todayPaid: 3, pendingCents: 250, availableCents: 1000,
          maxColumns: resolveColumns({ detected: c }),
        }).includes('Acme Analytics'),
      ),
    )
  })

  /**
   * The whole reason `formatStatusLine` was moved into `@tickover/contract`. The
   * pieces are coloured separately, so the risk is that colouring quietly changes
   * the text -- a dropped separator, a trimmed field, a doubled space. Compared
   * against the composer's own output for the same input, not against a literal:
   * a literal here would be a second composer, which is the thing being prevented.
   */
  it('renders exactly what the composer returns, character for character', () => {
    const { el } = mount(PaneHost)
    const expected = formatStatusLine({
      loggedIn: true,
      question: {
        assignment_id: '00000000-0000-4000-8000-000000000000',
        kind: 'choice',
        text: 'Which database do you reach for on a new side project?',
        options: ['Postgres', 'SQLite', 'MySQL'],
        context: null,
        sponsor: 'Acme Analytics',
        price_cents: 50,
        served_at: '2026-01-01T00:00:00.000Z',
        expires_at: '2026-01-01T00:05:00.000Z',
      },
      answered: null,
      todayPaid: 3,
      pendingCents: 250,
      availableCents: 1000,
      // Resolved, not raw. This read `maxColumns: 120` and so compared the pane
      // against the same mistake the pane was making -- it asserted the replica
      // matched a composer call the page makes, never one the client makes (R358).
      maxColumns: resolveColumns({ detected: 120 }),
    })
    expect(shown(el)).toBe(expected)
    expect(shown(el), 'the sponsor and the payout are spec 4.7 and unconditional').toContain('Acme Analytics')
    expect(shown(el)).toContain('$0.50')
  })

  /**
   * True to width means the rung is the arithmetic's, not the page's. At 60 columns
   * this question cannot keep its options whole, and the line the component shows has
   * to be the one the composer reaches — which is why `rung` is not a prop, although
   * design system 6.1 listed one.
   */
  it('falls to whatever rung the width forces, and the page cannot ask for another', () => {
    const { fixture, el } = mount(PaneHost)
    const wide = shown(el)
    fixture.componentInstance.cols.set(60)
    fixture.detectChanges()
    const narrow = shown(el)
    expect(narrow).not.toBe(wide)
    expect(narrow.length, 'a narrower budget composes a shorter line').toBeLessThan(wide.length)
    // Whatever it dropped, it did not drop the disclosure: spec 4.7 is unconditional,
    // and rung 5 suppresses the question rather than the sponsor.
    expect(narrow).toContain('tickover')
  })

  it('colours the sponsor, the payout and the separators, and nothing else', () => {
    const { el } = mount(PaneHost)
    const sponsor = row(el).querySelector('.text-signal-200')
    expect(sponsor?.textContent).toBe('Acme Analytics')
    const money = Array.from(row(el).querySelectorAll('.text-white'), (n) => n.textContent)
    expect(money, 'the payout figure, at weight 600').toEqual(['$0.50'])
    const seps = Array.from(row(el).querySelectorAll('.text-ink-400'), (n) => n.textContent)
    expect(seps.length, 'every separator, and each one is the mark spec 5.4 asks for').toBeGreaterThan(0)
    expect(new Set(seps)).toEqual(new Set([' · ']))
  })

  it('renders the idle line when there is no question', () => {
    const { fixture, el } = mount(PaneHost)
    fixture.componentInstance.question.set('')
    fixture.detectChanges()
    // The ceiling comes from RULES, not typed in (R49): it is configuration, and a
    // literal here would go on asserting the old one after it changes.
    expect(shown(el)).toBe(`tickover · today 3/${RULES.MAX_PAID_PER_DAY} · balance $12.50`)
    // No sponsor to colour, and the balance is still a payout figure.
    expect(row(el).querySelector('.text-signal-200')).toBeNull()
    expect(row(el).querySelector('.text-white')).toBeNull()
  })

  /**
   * Announced as one object in prose. A screen reader reading the visible line would
   * say "middle dot" between every field, which is punctuation a listener cannot use;
   * `role="img"` with a label is how a picture of a terminal is described.
   */
  it('describes itself in prose rather than reading out the punctuation', () => {
    const { el } = mount(PaneHost)
    const host = el.querySelector('tk-pane') as HTMLElement
    expect(host.getAttribute('role')).toBe('img')
    const label = host.getAttribute('aria-label') ?? ''
    expect(label).toContain('120 columns')
    expect(label).toContain('Acme Analytics')
    expect(label, 'the separator is not read out').not.toContain('·')
  })

  /**
   * The slot above the line cannot become the line.
   *
   * A component whose entire doctrine is that the page supplies inputs and the
   * composer supplies the row has just grown a hole a page can paint through, and
   * the boundary is worth an assertion rather than a comment: the row is byte-exact
   * against the composer with a session projected, and the pieces the colour walk
   * finds are the composer's pieces and not the session's, although the session
   * paints the same two classes.
   */
  it('keeps the composed row exactly what the composer returned, with a session above it', () => {
    const { el } = mount(SessionHost)
    expect(shown(el)).toBe(
      formatStatusLine({
        loggedIn: true,
        question: {
          assignment_id: '00000000-0000-4000-8000-000000000000',
          kind: 'choice',
          text: 'Which database?',
          options: ['Postgres'],
          context: null,
          sponsor: 'Acme Analytics',
          price_cents: 50,
          served_at: '2026-01-01T00:00:00.000Z',
          expires_at: '2026-01-01T00:05:00.000Z',
        },
        answered: null,
        todayPaid: 3,
        pendingCents: 250,
        availableCents: 1000,
        maxColumns: resolveColumns({ detected: 120 }),
      }),
    )
    expect(
      Array.from(row(el).querySelectorAll('.text-white'), (n) => n.textContent),
      'the session paints text-white too, and it is not a payout figure',
    ).toEqual(['$0.50'])
    expect(surface(el).textContent, 'the session is on the surface all the same').toContain('a prompt someone typed')
    // role=img replaces the subtree, so the label has to name the whole picture.
    const label = (el.querySelector('tk-pane') as HTMLElement).getAttribute('aria-label') ?? ''
    expect(label.startsWith('A terminal. '), 'the scene prose leads the label').toBe(true)
    expect(label).toContain('120 columns')
  })

  /**
   * The surface is exactly as wide as the budget, in character widths, so the replica
   * is the size the terminal would be rather than the size the layout happens to
   * leave. Below that the frame scrolls; design system 5 says the page never does.
   */
  it('is as wide as its column budget and scrolls in its own frame', () => {
    const { el } = mount(PaneHost)
    // 120 columns at the face's own advance ratio, which `ch` is not: see ADVANCE_EM.
    expect(surface(el).style.width).toBe('72.000em')
    // On the row, which is what must not wrap. The surface around it may hold a
    // session, and a terminal wraps that the way any terminal does.
    expect(row(el).className, 'and never wraps').toContain('whitespace-pre')
    expect((el.querySelector('tk-pane > div') as HTMLElement).className).toContain('overflow-x-auto')
  })

  /**
   * `cols` is an input, and an input is whatever the caller hands it.
   *
   * The composer has always defended itself -- `resolveColumns` bounds the width to
   * 20..400 before composing anything -- and the surface around it did not: it
   * multiplied the raw number by the advance, so 5000 drew a 3000em terminal holding
   * a 394-character row, and 1 drew a terminal six tenths of an em wide. The comment
   * over `budget()` already told a reader the bound was there, which is what made
   * this worth fixing rather than documenting.
   *
   * The resolved width is the budget with the margin added back, not a second bound
   * written here: two of them are two things to keep in step, and every defect this
   * component has had has been the two halves of one arithmetic drifting apart
   * (R358). So these assertions are relational -- what 5000 draws is what the
   * ceiling draws -- and the advance is read back out of the component at a width
   * that needs no resolving, so this file names no number either.
   */
  it('draws the terminal at the width the client would resolve, not the one it was handed', () => {
    const host = mount(PaneHost)
    const at = (cols: number) => {
      host.fixture.componentInstance.cols.set(cols)
      host.fixture.detectChanges()
      const pane = host.el.querySelector('tk-pane') as HTMLElement
      return { em: parseFloat(surface(host.el).style.width), label: pane.getAttribute('aria-label') ?? '' }
    }

    expect(at(5000).em, 'a 5000-column terminal is not a terminal').toBe(at(COLS_MAX).em)
    expect(at(1).em, 'and neither is a one-column one').toBe(at(COLS_MIN).em)
    // Unknown rather than narrow: `resolveColumns` reads a width of zero as "nothing
    // was detected" and falls back to the 80-column default, so the surface does too.
    expect(at(0).em).toBe(at(RULES.STATUS_LINE_MAX_COLUMNS).em)

    // The property underneath all three, stated as the visitor meets it: the surface
    // is wide enough for the row it was composed for. 80 resolves to itself, so the
    // advance comes back out of the component rather than being written down again.
    const advance = at(80).em / 80
    for (const cols of [1, 0, 80, 5000]) {
      const em = at(cols).em
      expect(em / advance, `${cols} columns holds its own row`).toBeGreaterThanOrEqual(shown(host.el).length)
    }

    // The same claim spoken. `role="img"` replaces the subtree, so this label is the
    // only width a screen reader is given, and it said 5000 too.
    expect(at(5000).label).toContain(`${COLS_MAX} columns`)
    expect(at(1).label).toContain(`${COLS_MIN} columns`)
  })
})

@Component({
  imports: [Pane],
  template: `
    <tk-pane [cols]="120" sponsor="Acme Analytics" [payoutCents]="50" question=""
      [answeredCents]="answered()" [flash]="flash()" [todayPaid]="4" [pendingCents]="300" [availableCents]="1000" />`,
})
class FlashHost {
  flash = signal<'none' | 'row' | 'money'>('none')
  answered = signal<number | null>(50)
}

describe('tk-pane flash (R384)', () => {
  it('washes the row, and only the row, when asked', () => {
    const { fixture, el } = mount(FlashHost)
    const row = el.querySelector('[data-line]') as HTMLElement
    expect(row.classList.contains('tk-wash')).toBe(false)
    fixture.componentInstance.flash.set('row')
    fixture.detectChanges()
    expect(row.classList.contains('tk-wash')).toBe(true)
    expect(el.querySelector('.tk-flash')).toBeNull()
  })

  it('flashes the money piece when asked, and no other piece', () => {
    const { fixture, el } = mount(FlashHost)
    fixture.componentInstance.flash.set('money')
    fixture.detectChanges()
    const flashed = [...el.querySelectorAll('.tk-flash')]
    expect(flashed).toHaveLength(1)
    expect(flashed[0]!.textContent).toBe('+$0.50')
  })

  it('never changes the text of the row', () => {
    const { fixture, el } = mount(FlashHost)
    const before = shown(el)
    for (const f of ['row', 'money', 'none'] as const) {
      fixture.componentInstance.flash.set(f)
      fixture.detectChanges()
      expect(shown(el)).toBe(before)
    }
  })
})

// The signature primitive takes its inputs; it does not reach into the one page that happens to
// animate it (final review M6). `flash`'s own type used to be imported from the landing sequence's
// data file, so the component every page may render depended on that page's content.
describe('tk-pane dependencies', () => {
  it('imports nothing from the landing hero', () => {
    const source = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), 'pane.ts'), 'utf8')
    const imports = source.match(/^import .* from '[^']+'/gm) ?? []
    expect(imports.length, 'no imports found, so this proved nothing').toBeGreaterThan(0)
    expect(imports.filter((i) => /from '\.\.\/lib\/hero-/.test(i))).toEqual([])
  })
})
