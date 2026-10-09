import { COUNTRY_ALIASES, COUNTRY_CODES } from '@tickover/contract'

const names = new Intl.DisplayNames(['en'], { type: 'region' })
export function countryName(code: string): string { return names.of(code) ?? code }

const fold = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().trim()
const BY_NAME = [...COUNTRY_CODES].sort((a, b) => countryName(a).localeCompare(countryName(b), 'en'))
const FOLDED = new Map(BY_NAME.map((c) => [c, fold(countryName(c))]))

/**
 * Codes for a search, best first. Only ever members of COUNTRY_CODES: the picker
 * can offer nothing else, which is what keeps UK out of a study (spec 3).
 */
export function filterCountries(query: string): string[] {
  const q = fold(query)
  if (!q) return BY_NAME
  const out = new Set<string>()
  const upper = q.toUpperCase()
  if (FOLDED.has(upper)) out.add(upper)
  for (const [alias, code] of Object.entries(COUNTRY_ALIASES)) if (alias === q) out.add(code)
  for (const [alias, code] of Object.entries(COUNTRY_ALIASES)) if (alias.startsWith(q)) out.add(code)
  for (const c of BY_NAME) if (FOLDED.get(c)!.split(/[\s,()-]+/).some((w) => w.startsWith(q)) || FOLDED.get(c)!.startsWith(q)) out.add(c)
  for (const c of BY_NAME) if (FOLDED.get(c)!.includes(q)) out.add(c)
  return [...out]
}
