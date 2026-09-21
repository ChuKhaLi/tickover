/**
 * Spec §5.5 -- "the consent screen lists exactly these lists. The developer web page
 * mirrors them" -- as data, so the four surfaces that carry it can be built from one
 * list rather than checked against each other by eye.
 *
 * The four are the public /developers page, the /privacy page, the "Your data"
 * section of /dev/settings, and the plugin's consent screen. The first three import
 * this module. The fourth cannot -- it is prose in `skills/setup/SKILL.md`, shown by
 * the agent before anything is sent -- so `packages/plugin`'s `consent.spec.ts`
 * reads these items and demands the paragraph contain every `phrase`.
 *
 * That is why an item is a *phrase* and not a sentence. The consent screen writes
 * "your GitHub id (from login)" and "counts of file extensions in your project
 * directory (for example "typescript: 40")", which the pages do not; both still
 * contain the canonical phrase verbatim, so containment is the check that works
 * across all four without flattening the wording of any of them.
 *
 * Nothing here is a schema and nothing validates: this is copy under test, which is
 * what a privacy disclosure is.
 */
export interface DisclosureItem {
  /** Stable across rewording, so a failure can name the item rather than quote it. */
  readonly key: string
  /** The exact words every surface has to contain for this item. */
  readonly phrase: string
}

export const DISCLOSURE: {
  readonly sent: readonly DisclosureItem[]
  readonly derived: readonly DisclosureItem[]
  readonly never: readonly DisclosureItem[]
} = {
  /**
   * Leaves the machine. `answers` carries its own parenthetical because the source
   * is the field spec §5.5 lists and the consent screen omitted for a whole branch:
   * naming it "your answers" alone lets the surface that drops "where you answered
   * them" still pass.
   */
  sent: [
    { key: 'github_id', phrase: 'GitHub id' },
    { key: 'os', phrase: 'operating system' },
    { key: 'tool_version', phrase: 'Claude Code version' },
    { key: 'turn_times', phrase: 'when each turn starts and stops' },
    { key: 'language_mix', phrase: 'counts of file extensions in your project directory' },
    { key: 'answers', phrase: 'your answers with how long you took and where you answered them (terminal pane, local page, VS Code, or inside Claude Code)' },
  ],

  /**
   * Never sent by the plugin, and buyers target on both -- which is why leaving them
   * off the consent screen was the worse of the two omissions the branch found: a
   * developer agreed to a list that did not mention what they were being selected
   * on. The thresholds are spelled out because "an activity tier" alone discloses a
   * label, not a fact about them.
   */
  derived: [
    { key: 'country', phrase: 'your country, from the IP address of the request' },
    { key: 'activity_tier', phrase: 'an activity tier from how many turns you run a week (light under 5, regular 5 to 20, heavy over 20)' },
  ],

  /** The promise, and the only list here whose items are single nouns. */
  never: [
    { key: 'prompts', phrase: 'prompts' },
    { key: 'file_contents', phrase: 'file contents' },
    { key: 'file_paths', phrase: 'file paths' },
    { key: 'repo_names', phrase: 'repository names' },
    { key: 'repo_owners', phrase: 'repository owners' },
    { key: 'transcripts', phrase: 'transcripts' },
  ],
}

/**
 * The list as one printable clause: `a, b, and c` for three or more, `a and b` for
 * two, `a` for one.
 *
 * The comma before the conjunction is not a style choice. The sent list's last item
 * contains "and" of its own, so without it the sentence reads as though the answers
 * and their timing were one field; and `derived` -- only two items -- still takes the
 * comma, because its first phrase already contains one and "the request and an
 * activity tier" reads as a single item. So the rule is *serial comma unless the
 * whole list is short and unambiguous*, which is what the shipped copy already says.
 */
export function disclosureSentence(items: readonly DisclosureItem[], conjunction: 'and' | 'or'): string {
  const phrases = items.map((i) => i.phrase)
  if (phrases.length <= 1) return phrases[0] ?? ''
  const last = phrases[phrases.length - 1]!
  const head = phrases.slice(0, -1)
  const serial = phrases.length > 2 || phrases.some((p) => p.includes(','))
  return serial ? `${head.join(', ')}, ${conjunction} ${last}` : `${head[0]} ${conjunction} ${last}`
}
