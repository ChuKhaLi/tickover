export const EXT_TO_LANGUAGE: Record<string, string> = {
  ts: 'typescript', tsx: 'typescript', mts: 'typescript', cts: 'typescript',
  js: 'javascript', jsx: 'javascript', mjs: 'javascript', cjs: 'javascript',
  py: 'python', go: 'go', rs: 'rust', java: 'java', kt: 'kotlin', kts: 'kotlin',
  cs: 'csharp', rb: 'ruby', php: 'php', swift: 'swift', dart: 'dart', scala: 'scala',
  c: 'c', h: 'c', cpp: 'cpp', cc: 'cpp', hpp: 'cpp', ex: 'elixir', exs: 'elixir',
  sql: 'sql', sh: 'shell', bash: 'shell', ps1: 'powershell', vue: 'vue', svelte: 'svelte',
  html: 'html', css: 'css', scss: 'css',
}

export const LANGUAGES = Array.from(new Set(Object.values(EXT_TO_LANGUAGE))).sort()

/**
 * Extensions worth reporting that EXT_TO_LANGUAGE does not (yet) map to a language:
 * documentation, configuration and data files that every repository has and that identify
 * nothing about who the developer works for. Kept separate from EXT_TO_LANGUAGE because the
 * server drops anything it can't map -- these are here so the wire field keeps meaning what its
 * name and the consent screen both say ("counts of file extensions in your project directory"),
 * and so a later server release can start recognising one of them without a client update.
 */
export const COMMON_EXTENSIONS = [
  'md', 'mdx', 'txt', 'json', 'yaml', 'yml', 'toml', 'xml', 'csv', 'lock', 'ini', 'cfg', 'conf',
] as const

/**
 * The complete set of extension keys a client may put in `HeartbeatRequest.extension_counts`.
 *
 * This is an ALLOWLIST rather than a shape check on purpose (whole-branch review C1). The keys
 * come from `path.extname`, which returns everything after the last dot -- not a language suffix
 * -- so `deploy.northwind` yields `northwind`, which any "short lowercase alphanumeric" rule
 * would happily pass. Only naming the permitted values keeps a customer or project name off the
 * wire. The cost is that a client stops reporting an extension the server learns about until the
 * client updates, which loses signal but never sends anything unpromised.
 */
export const TELEMETRY_EXTENSIONS: ReadonlySet<string> = new Set<string>([
  ...Object.keys(EXT_TO_LANGUAGE),
  ...COMMON_EXTENSIONS,
])

/**
 * The shape any extension key must have on the wire, independent of the allowlist above. The
 * schema states this rather than the allowlist so a client that is ahead of (or behind) the
 * server's extension table is not rejected outright -- but a filename tail like
 * `customer-northwind-2026` or a 120-character suffix can never be one.
 */
export const EXTENSION_KEY_PATTERN = /^[a-z0-9]{1,12}$/

/**
 * Cardinality cap on `extension_counts`, enforced on the wire and applied by the client, which
 * keeps its highest counts and drops the rest. Set below `TELEMETRY_EXTENSIONS.size` so the cap
 * is a live bound rather than decoration: a repository touching more than this many distinct
 * recognised extensions loses only its smallest, least informative counts.
 */
export const MAX_EXTENSION_KEYS = 32

export function languageMixFromExtensions(ext: Record<string, number>): Record<string, number> {
  const out: Record<string, number> = {}
  for (const [e, n] of Object.entries(ext)) {
    const lang = EXT_TO_LANGUAGE[e.toLowerCase().replace(/^\./, '')]
    if (!lang || !Number.isFinite(n) || n <= 0) continue
    out[lang] = (out[lang] ?? 0) + Math.floor(n)
  }
  return out
}

/** What a buyer reads on a language chip. `labels.test.ts` holds it to `LANGUAGES`, key for key. */
export const LANGUAGE_LABELS: Readonly<Record<string, string>> = Object.freeze({
  c: 'C', cpp: 'C++', csharp: 'C#', css: 'CSS', dart: 'Dart', elixir: 'Elixir', go: 'Go', html: 'HTML',
  java: 'Java', javascript: 'JavaScript', kotlin: 'Kotlin', php: 'PHP', powershell: 'PowerShell',
  python: 'Python', ruby: 'Ruby', rust: 'Rust', scala: 'Scala', shell: 'Shell', sql: 'SQL',
  svelte: 'Svelte', swift: 'Swift', typescript: 'TypeScript', vue: 'Vue',
})
