import { describe, it, expect } from 'vitest'
import { DISCLOSURE, disclosureSentence } from '../src/disclosure.js'

/**
 * Spec §5.5 is one list carried by four surfaces: the public /developers page, the
 * /privacy page, the developer's own /dev/settings data section, and the plugin's
 * consent screen. Until this file existed they agreed by inspection -- and the
 * measurement that closed the plan-2 branch found the consent screen could be
 * narrowed on its own, with `SKILL.md` and its own test constant edited together,
 * while every suite stayed green.
 *
 * This module is the source those four now read. What it owns is the *items*: the
 * consent screen phrases them with its own articles and examples ("your GitHub id
 * (from login)"), so an item is the words every surface has to contain, not a whole
 * sentence any one of them prints.
 *
 * The assertions below are literals on purpose. A test that rebuilt the expected
 * sentence with `disclosureSentence` would compare a constant to itself and pass on
 * an empty list -- the exact idiom the branch review flagged at
 * `settings.page.spec.ts:303`.
 */
describe('the spec 5.5 disclosure lists', () => {
  it('names every field that leaves the machine', () => {
    expect(DISCLOSURE.sent.map((i) => i.key)).toEqual([
      'github_id', 'os', 'tool_version', 'turn_times', 'language_mix', 'answers',
    ])
  })

  it('names both fields derived on the server', () => {
    expect(DISCLOSURE.derived.map((i) => i.key)).toEqual(['country', 'activity_tier'])
  })

  it('names everything that is never collected', () => {
    expect(DISCLOSURE.never.map((i) => i.key)).toEqual([
      'prompts', 'file_contents', 'file_paths', 'repo_names', 'repo_owners', 'transcripts',
    ])
  })

  // The three strings the pages print, written out rather than rebuilt. These are
  // the same literals `settings.page.spec.ts` and `landing.spec.ts` pin against the
  // rendered DOM, so a change here that the pages follow silently still has to be
  // made in three files that do not import one another.
  it('joins the sent list into the sentence the pages print', () => {
    expect(disclosureSentence(DISCLOSURE.sent, 'and')).toBe(
      'GitHub id, operating system, Claude Code version, when each turn starts and stops, counts of file extensions in your project directory, and your answers with how long you took and where you answered them (terminal pane, local page, VS Code, or inside Claude Code)',
    )
  })

  it('joins the derived list into the sentence the pages print', () => {
    expect(disclosureSentence(DISCLOSURE.derived, 'and')).toBe(
      'your country, from the IP address of the request, and an activity tier from how many turns you run a week (light under 5, regular 5 to 20, heavy over 20)',
    )
  })

  it('joins the never list with "or", because it is what is not done', () => {
    expect(disclosureSentence(DISCLOSURE.never, 'or')).toBe(
      'prompts, file contents, file paths, repository names, repository owners, or transcripts',
    )
  })

  // Every consumer reads `phrase` and asserts containment, so an empty or blank
  // phrase is a hole that passes: `'anything'.includes('')` is true. One list with
  // one blank phrase would let that surface drop the item entirely.
  it('gives every item a non-blank phrase', () => {
    const all = [...DISCLOSURE.sent, ...DISCLOSURE.derived, ...DISCLOSURE.never]
    expect(all.length).toBe(14)
    for (const item of all) expect(item.phrase.trim(), `${item.key} has a blank phrase`).not.toBe('')
  })

  // The join is the only piece of logic here, and a one- or two-item list is where a
  // hand-rolled Oxford comma goes wrong. Neither shape occurs in the three lists
  // above except `derived`, so nothing else in the suite would notice.
  it('joins short lists without a stray comma', () => {
    const item = (key: string, phrase: string) => ({ key, phrase })
    expect(disclosureSentence([], 'and')).toBe('')
    expect(disclosureSentence([item('a', 'one')], 'and')).toBe('one')
    expect(disclosureSentence([item('a', 'one'), item('b', 'two')], 'and')).toBe('one and two')
    expect(disclosureSentence([item('a', 'one'), item('b', 'two'), item('c', 'three')], 'or')).toBe('one, two, or three')
  })

  // Why `derived` reads "...of the request, and an activity tier..." rather than
  // "...of the request and an activity tier...": its first phrase already contains a
  // comma, so without one before the conjunction the two items read as one. This is
  // the rule that produces the shipped sentence, and it is the only reason a
  // two-item join is not always comma-free.
  it('keeps the comma before the conjunction when an item contains one', () => {
    const item = (key: string, phrase: string) => ({ key, phrase })
    expect(disclosureSentence([item('a', 'one, first'), item('b', 'two')], 'and')).toBe('one, first, and two')
    expect(disclosureSentence([item('a', 'one'), item('b', 'two, second')], 'or')).toBe('one, or two, second')
  })
})
