import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { DISCLOSURE } from '@tickover/contract'

const readme = () => readFileSync(resolve(__dirname, '../../README.md'), 'utf8')

/**
 * `packages/daemon/README.md` is the **fifth** surface carrying spec §5.5's lists, and until the
 * branch review nobody had noticed it was one. `disclosure.ts` names four -- /developers, /privacy,
 * /dev/settings and the plugin's consent screen -- and the first three import `DISCLOSURE` while
 * `consent.spec.ts` holds the fourth to it. This file was outside that chain entirely, so its
 * hand-written prose could say anything.
 *
 * It did. Measured against `DISCLOSURE` it dropped the **whole derived list** -- country from IP
 * and the activity tier -- dropped "where you answered them", dropped "repository owners" from the
 * never list, and wrote "paths" where the promise is "file paths". Replacing the entire paragraph
 * with "Nothing at all leaves your machine, ever." left the plugin suite at 29 and the contract
 * suite at 68, both green.
 *
 * Why it matters more than an ordinary doc drift: this file is in the npm `files` array, so it is
 * the disclosure every `tickover-cli` installer reads -- and the setup skill sends them there,
 * `npm install -g tickover-cli`, immediately after showing them the *correct* consent paragraph.
 * The two texts a developer meets during a single install disagreed, and only one was tested.
 *
 * The derived list is the omission the plan-2 review called the worse of the two, because it is
 * what buyers select on: a developer who reads only this file agrees to a list that never mentions
 * what they are being targeted by.
 *
 * Containment per item, following `consent.spec.ts`: this README phrases things in its own voice
 * ("GitHub id (from login)"), and the canonical phrase has to sit inside that verbatim.
 */
describe('the daemon README carries spec 5.5 in full', () => {
  it('contains every phrase that leaves the machine, and every derived one', () => {
    const text = readme()
    for (const item of [...DISCLOSURE.sent, ...DISCLOSURE.derived]) {
      expect(text, `README omits DISCLOSURE.${item.key}: "${item.phrase}"`).toContain(item.phrase)
    }
  })

  it('contains every phrase in the never list', () => {
    const text = readme()
    for (const item of DISCLOSURE.never) {
      expect(text, `README omits the promise DISCLOSURE.never.${item.key}: "${item.phrase}"`).toContain(item.phrase)
    }
  })

  /**
   * Without this the two tests above pass on a file that says everything and then takes it back,
   * which is the failure mode a containment check cannot otherwise see. "paths" for "file paths"
   * was exactly that shape: the narrower promise contained the wider word.
   */
  it('does not also claim nothing is sent', () => {
    expect(readme()).not.toMatch(/nothing (at all )?(ever )?leaves your machine/i)
  })
})
