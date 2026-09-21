import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { DISCLOSURE, disclosureSentence } from '@tickover/contract'

const root = resolve(__dirname, '..')

/**
 * Spec §5.5: "The consent screen lists exactly these lists. The developer web page
 * mirrors them." Four surfaces carry those lists -- this skill, /developers,
 * /privacy and /dev/settings -- and this is the only one where the developer is
 * asked to agree before anything is sent. An omission here is worse than an omission
 * on any of the pages: they describe what is collected, this is what is consented to.
 *
 * It had two omissions, both measured against the web pages: the answer source, and
 * the whole derived-fields sentence -- so a developer agreed to a list that never
 * mentioned the country or the activity tier that buyers target on. Fixing those left
 * the four surfaces agreeing *by inspection*: the plan-2 branch review then measured
 * that this screen could still be narrowed on its own, editing SKILL.md and the
 * hand-copied constants that used to sit here, with all 745 tests green.
 *
 * So the lists are no longer written here. They come from `@tickover/contract`'s
 * `DISCLOSURE`, which the three web pages render, and this file asserts the consent
 * paragraph contains every item of it. Nothing in `packages/web` can read a markdown
 * file in this package; the shared constant is the link that replaces that gap.
 *
 * Containment, not equality, is the check that works here: this screen phrases the
 * items with its own articles and examples ("your GitHub id (from login)", 'counts of
 * file extensions in your project directory (for example "typescript: 40")'), and the
 * canonical phrase sits inside each of those verbatim.
 */

/**
 * The paragraph the developer is actually shown, not the file. Read as "the first
 * non-empty line after the step that says to show it", so moving the disclosure
 * anywhere else in this skill fails here rather than passing a whole-file grep --
 * a list further down the page is documentation, not consent.
 */
function consentText(): string {
  const lines = readFileSync(join(root, 'skills/setup/SKILL.md'), 'utf8').split(/\r?\n/)
  const step = lines.findIndex((l) => l.includes('Show this consent text verbatim'))
  expect(step, 'no step tells the agent to show the consent text').toBeGreaterThan(-1)
  return (lines.slice(step + 1).find((l) => l.trim() !== '') ?? '').trim()
}

describe('setup skill consent text', () => {
  it('is the paragraph the developer is asked to agree to', () => {
    expect(consentText().startsWith('Tickover will send to its server:')).toBe(true)
  })

  // The counts are the guard that makes the three loops below able to fail. A list
  // emptied in the contract would otherwise let every loop pass by finding nothing,
  // and this file would report that a consent screen disclosing nothing was correct.
  it('is checked against a disclosure that still has all three lists in it', () => {
    expect(DISCLOSURE.sent.length).toBe(6)
    expect(DISCLOSURE.derived.length).toBe(2)
    expect(DISCLOSURE.never.length).toBe(6)
  })

  it('lists every field that leaves the machine, including where each answer was given', () => {
    const text = consentText()
    for (const { key, phrase } of DISCLOSURE.sent) {
      expect(text, `the consent text does not disclose ${key}: ${phrase}`).toContain(phrase)
    }
  })

  it('discloses the two fields derived on the server', () => {
    const text = consentText()
    for (const { key, phrase } of DISCLOSURE.derived) {
      expect(text, `consent is given without being told about ${key}`).toContain(phrase)
    }
    // The pages print this one as a single clause and so does this screen, so the
    // whole sentence is pinned as well as its parts: it is the one place a reordering
    // could leave both items present and the meaning changed.
    expect(text).toContain(disclosureSentence(DISCLOSURE.derived, 'and'))
  })

  it('states what is never sent', () => {
    const text = consentText()
    for (const { key, phrase } of DISCLOSURE.never) {
      expect(text, `the consent text does not promise to withhold ${key}`).toContain(phrase)
    }
    // Single nouns are weak on their own -- "prompts" would be satisfied by any other
    // mention -- so the joined clause is what this list is actually held to.
    expect(text).toContain(disclosureSentence(DISCLOSURE.never, 'or'))
  })

  // The privacy page is the same three lists in a form a developer can read before
  // installing anything, and spec §7 requires it to mirror this screen. A consent
  // screen that never names it leaves that page reachable only by guessing the URL.
  it('points at the privacy page that mirrors it', () => {
    expect(consentText()).toContain('https://tickover.dev/privacy')
  })
})
