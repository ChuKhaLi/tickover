import { DISCLOSURE, disclosureSentence } from '@tickover/contract'

/**
 * Spec §5.5's three lists as the sentences the pages print. Four surfaces carry
 * them -- /developers, /privacy, the "Your data" section of /dev/settings, and the
 * plugin's consent screen -- and until `@tickover/contract`'s `disclosure.ts`
 * existed all four were separate copies that agreed by inspection.
 *
 * The three pages in this package read these constants. The consent screen cannot
 * (it is markdown in another package) and is held to the same items by
 * `packages/plugin/test/consent.spec.ts`.
 *
 * The page specs still assert the sentences as *literals*. That is deliberate: a
 * spec that rebuilt them from the contract would compare a constant to itself, and
 * would follow a narrowed list straight down. The literals are what make a change
 * here fail somewhere.
 */
export const SENT_LIST = disclosureSentence(DISCLOSURE.sent, 'and')
export const DERIVED_LIST = disclosureSentence(DISCLOSURE.derived, 'and')
export const NEVER_LIST = disclosureSentence(DISCLOSURE.never, 'or')
