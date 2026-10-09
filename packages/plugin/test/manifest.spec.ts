import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { join, resolve } from 'node:path'

const root = resolve(__dirname, '..')
const repo = resolve(root, '../..')

const SKILLS = ['setup', 'uninstall'] as const

describe('plugin manifest', () => {
  it('declares hooks and skills that exist', () => {
    const m = JSON.parse(readFileSync(join(root, '.claude-plugin/plugin.json'), 'utf8'))
    expect(m.name).toBe('tickover')
    // Claude Code loads `hooks/hooks.json` by itself, so naming it here too is a duplicate the engine
    // refuses: "Duplicate hooks file detected: ./hooks/hooks.json resolves to already-loaded file ...
    // The standard hooks/hooks.json is loaded automatically, so manifest.hooks should only reference
    // additional hook files." It then marks the plugin `hook-load-failed`. Captured nine times in one
    // session during the §23 operator run (2026-09-16) while `plugin validate --strict` and every
    // suite here stayed green -- and this assertion used to require the key, so it held the defect in
    // place instead of catching it. The plugin has no additional hook files, so the key stays absent
    // (R218).
    expect(m.hooks).toBeUndefined()
    expect(existsSync(join(root, 'hooks/hooks.json'))).toBe(true)
    expect(existsSync(join(root, 'skills/setup/SKILL.md'))).toBe(true)
    expect(existsSync(join(root, 'skills/uninstall/SKILL.md'))).toBe(true)
    const hooks = JSON.parse(readFileSync(join(root, 'hooks/hooks.json'), 'utf8')).hooks
    for (const ev of ['SessionStart', 'UserPromptSubmit', 'Stop', 'SessionEnd']) {
      const cmd = hooks[ev][0].hooks[0]
      expect(cmd.type).toBe('command')
      expect(cmd.command).toContain('${CLAUDE_PLUGIN_ROOT}/hooks/notify.mjs')
      expect(cmd.timeout).toBe(2)
    }

    // R200: the band's hooks module. Loaded only where Claude Code's function hooks are on; Spike E
    // captured 2.1.272 ignoring the key, command hooks intact, where they are off.
    const modules = JSON.parse(readFileSync(join(root, 'hooks/hooks.json'), 'utf8')).modules
    expect(modules).toEqual(['./band.tsx'])
    expect(existsSync(join(root, 'hooks/band.tsx'))).toBe(true)
  })

  /**
   * Both skills shipped with frontmatter YAML cannot parse, so both load with **empty
   * metadata** -- name and description silently dropped -- and nothing in this package
   * noticed. `claude plugin validate . --strict` says so in as many words; `pnpm test`
   * did not, and validate is a separate script that no suite runs.
   *
   * The cause is one character sequence: an unquoted YAML scalar may not contain ": ",
   * and both descriptions read "Set up Tickover: install the daemon...". YAML takes
   * "Set up Tickover" as a key and fails on the rest of the line.
   *
   * Parsed here rather than pattern-matched, and with no YAML dependency: this package
   * has none, and adding one to a plugin whose claim is that it ships nothing would be
   * the wrong trade. What is checked is exactly the property that broke -- every
   * frontmatter line splits into a key and a value, and a value containing ": " is
   * quoted.
   */
  it('gives every skill frontmatter that actually parses', () => {
    for (const skill of SKILLS) {
      const lines = readFileSync(join(root, `skills/${skill}/SKILL.md`), 'utf8').split(/\r?\n/)
      expect(lines[0], `${skill}: no frontmatter fence`).toBe('---')
      const end = lines.indexOf('---', 1)
      expect(end, `${skill}: frontmatter is never closed`).toBeGreaterThan(0)

      const fields = new Map<string, string>()
      for (const line of lines.slice(1, end)) {
        const at = line.indexOf(':')
        expect(at, `${skill}: frontmatter line is not "key: value": ${line}`).toBeGreaterThan(0)
        const key = line.slice(0, at)
        const raw = line.slice(at + 1).trim()
        expect(key, `${skill}: frontmatter key carries whitespace: ${key}`).toBe(key.trim())
        // The defect. An unquoted scalar containing ": " makes YAML read the text before
        // it as a second key, and the whole document fails to parse.
        const quoted = raw.length > 1 && (raw.startsWith('"') ? raw.endsWith('"') : raw.startsWith("'") && raw.endsWith("'"))
        expect(
          raw.includes(': ') && !quoted,
          `${skill}: ${key} contains ": " and is not quoted, so the frontmatter does not parse and the skill loads with no metadata at all`,
        ).toBe(false)
        fields.set(key, quoted ? raw.slice(1, -1) : raw)
      }

      // Without these two the loop above passes on an empty frontmatter block.
      expect(fields.get('name'), `${skill}: name is not the directory the loader finds it in`).toBe(skill)
      expect((fields.get('description') ?? '').length, `${skill}: no description`).toBeGreaterThan(20)
    }
  })

  // Found running the real /tickover:uninstall on 2026-09-30: an edit that deleted a sentence also ate
  // a newline, so step 2 sat at the end of step 1's line ("...login token.2. Drain..."). A model can
  // still read that; the next edit to either step is likelier to break it. Every numbered step of
  // both skills starts a line, and the numbers run in order from where they start.
  it('keeps each numbered skill step on a line of its own', () => {
    for (const skill of SKILLS) {
      const text = readFileSync(join(root, `skills/${skill}/SKILL.md`), 'utf8')
      const starts = [...text.matchAll(/^(\d+)\. /gm)].map((m) => Number(m[1]))
      expect(starts.length, skill).toBeGreaterThan(3)
      expect(starts, skill).toEqual(starts.map((_, i) => starts[0]! + i))
      expect(text, `${skill}: a step number runs on from the previous sentence`).not.toMatch(/[.)`]\d+\. [A-Z]/)
    }
  })

  it('is listed in the repo marketplace with a relative source', () => {
    const mk = JSON.parse(readFileSync(join(repo, '.claude-plugin/marketplace.json'), 'utf8'))
    const entry = mk.plugins.find((p: { name: string }) => p.name === 'tickover')
    expect(entry.source).toBe('./packages/plugin')
    expect(entry.version).toBe(JSON.parse(readFileSync(join(root, '.claude-plugin/plugin.json'), 'utf8')).version)
  })
})

/**
 * The install command is one string that has to agree in four files, and nothing checked
 * it: the manifest test above deliberately ignores the owner, and `task-11-report.md`
 * flagged the `OWNER` placeholder as "still needs the real GitHub owner before publishing"
 * three rounds ago. A placeholder that survives to a release does not fail loudly -- the
 * marketplace add resolves to a repository that does not exist, and the product is simply
 * uninstallable for everybody.
 *
 * Checked as the thing rather than as a count (R115): the owner is read out of one file
 * and the other three are held to it, so a partial edit that fixes two of four turns red
 * naming the file it missed.
 */
describe('published identity', () => {
  /**
   * `scripts/mirror/README.md` is the fifth surface and the most-read one: the mirror script
   * copies it to the public repository's `README.md`, so its install command is the first
   * thing a developer sees. R123 said four files carry the command; five do. The branch review
   * proved the gap by reverting this one alone to the placeholder -- the plugin suite stayed
   * 29/29 green, the mirror's own `--check` exited 0, and `--out` published
   * `claude plugin marketplace add OWNER/tickover` to the front page.
   *
   * It lives outside `packages/`, which is exactly why nothing had reached it: every other
   * guard in this package resolves paths under `root` or under a sibling package.
   */
  /**
   * The public README lives in two places depending on which tree this is running in: it is
   * `scripts/mirror/README.md` here, and the mirror script copies it to `README.md` at the root of
   * the published repository, where `scripts/` does not exist at all.
   *
   * Naming only the private path put R124 straight back -- the mirror published this test, the test
   * read a withheld file, and the mirror's own plugin suite failed 1 of 30 while `--check` stayed
   * green. Resolving to whichever exists keeps one assertion true in both trees, which is what the
   * claim actually is: the public front page names the owner.
   */
  const publicReadme = () => {
    const inRepo = resolve(repo, 'scripts/mirror/README.md')
    return existsSync(inRepo) ? inRepo : resolve(repo, 'README.md')
  }

  const readmes = [
    ['packages/plugin/README.md', join(root, 'README.md')],
    ['packages/daemon/README.md', resolve(repo, 'packages/daemon/README.md')],
    ['the public README', publicReadme()],
  ] as const

  it('names a real GitHub owner everywhere the install command appears', () => {
    const plugin = JSON.parse(readFileSync(join(root, '.claude-plugin/plugin.json'), 'utf8'))

    const repoUrl: string = plugin.repository
    const owner = repoUrl.replace(/^https:\/\/github\.com\//, '').split('/')[0]

    expect(owner, 'plugin.json repository is still the OWNER placeholder').not.toBe('OWNER')
    // GitHub's own grammar: alphanumeric, single internal hyphens, 39 characters at most.
    expect(owner, `plugin.json repository owner is not a GitHub handle: ${owner}`).toMatch(
      /^[A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9])){0,38}$/,
    )

    expect(repoUrl).toBe(`https://github.com/${owner}/tickover`)
    expect(plugin.author.url, 'plugin.json author.url disagrees with repository').toBe(
      `https://github.com/${owner}/tickover`,
    )

    const mk = JSON.parse(readFileSync(join(repo, '.claude-plugin/marketplace.json'), 'utf8'))
    expect(mk.owner.url, 'marketplace.json owner.url disagrees with plugin.json').toBe(
      `https://github.com/${owner}`,
    )
    expect(mk.owner.name, 'marketplace.json owner.name is still the placeholder').not.toBe('OWNER')

    for (const [label, path] of readmes) {
      const text = readFileSync(path, 'utf8')
      expect(text, `${label}: install command does not name ${owner}`).toContain(
        `claude plugin marketplace add ${owner}/tickover`,
      )
      expect(text, `${label}: an OWNER placeholder survives`).not.toContain('OWNER/tickover')
    }
  })

  /**
   * The artefact a developer installs is not this repository, it is the npm tarball and the
   * marketplace listing, and neither carried a licence or a link back. `npm pack --dry-run` in
   * `packages/daemon` listed exactly four files -- README, the bundle, its map, the manifest --
   * with no LICENSE, while `package.json` declared `"license": "MIT"`. MIT asks for the notice to
   * travel with the copy, and a package claiming to be open source with nowhere to go is the same
   * gap as the placeholder: the claim is on the page and the route is missing.
   *
   * `packages/vscode/.vscodeignore` had already un-ignored `LICENSE`, which is the tell -- somebody
   * meant to ship it and the file was never created, so the un-ignore matched nothing and said
   * nothing.
   */
  const published = [
    ['packages/daemon', resolve(repo, 'packages/daemon')],
    ['packages/vscode', resolve(repo, 'packages/vscode')],
  ] as const

  it('ships the licence and a route back to the source in every published package', () => {
    const plugin = JSON.parse(readFileSync(join(root, '.claude-plugin/plugin.json'), 'utf8'))
    const owner = plugin.repository.replace(/^https:\/\/github\.com\//, '').split('/')[0]
    const canonical = readFileSync(resolve(repo, 'LICENSE'), 'utf8')

    for (const [label, dir] of published) {
      const manifest = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'))

      // Asserted present before asserted correct: `toContain` on undefined reports that the
      // arguments to the matcher are the wrong type, which names the test rather than the defect.
      expect(typeof manifest.repository?.url, `${label}: no repository field, so the listing links nowhere`).toBe(
        'string',
      )
      /**
       * Exact, not `toContain`. Containment was satisfied by
       * `github.com/ChuKhaLi/tickover-monorepo` -- the **private** repository's real name from
       * R119, so it is the one wrong value most likely to be typed here, and the only one that
       * defeats the whole point of the field by linking to something nobody can open.
       */
      expect(manifest.repository.url, `${label}: repository is not the public mirror`).toBe(
        `git+https://github.com/${owner}/tickover.git`,
      )
      // npm renders the link as <url>/tree/HEAD/<directory>, so a stale directory is a 404 on the
      // package page. Checked against the path this package actually occupies.
      expect(manifest.repository.directory, `${label}: repository.directory does not name this package`).toBe(label)
      expect(existsSync(resolve(repo, manifest.repository.directory)), `${label}: repository.directory does not exist`).toBe(
        true,
      )
      // Byte-identical, not merely present: a stale copy of a licence is a licence dispute.
      expect(readFileSync(join(dir, 'LICENSE'), 'utf8'), `${label}: LICENSE differs from the root one`).toBe(canonical)
      expect(manifest.license, `${label}: declares a licence it does not ship`).toBe('MIT')
    }

    // The daemon is the only one of the two published through npm, where `files` decides the
    // tarball. Declaring the licence and then excluding it from the package is the failure.
    const daemon = JSON.parse(readFileSync(resolve(repo, 'packages/daemon/package.json'), 'utf8'))
    expect(daemon.files, 'packages/daemon: LICENSE is not in the npm files array').toContain('LICENSE')
  })

  /**
   * The npm install command is the developer's second action, and it named a package that had
   * never been published. `@tickover/cli` 404s on the registry: the npm account `tickover`
   * exists, has published nothing, and owns the scope by owning the username, so nobody else can
   * publish under it (R136). The published name is now `tickover-cli`, unscoped, and five
   * surfaces repeat it.
   *
   * The version pin is the half that breaks next. The setup skill pins `@0.1.0` so a developer
   * installs the build its instructions were written against, and nothing held that pin to the
   * package: the first `npm version` bump would have sent every new developer to a stale release
   * with the whole suite green. That is the OWNER placeholder above wearing different clothes,
   * and this package has now shipped that shape twice.
   *
   * `@tickover/contract` is deliberately not what this refuses. It is a workspace-only package
   * that stays scoped and private, and `packages/daemon/README.md` names it correctly while
   * explaining a near-identical defect: declaring it as a runtime dependency once made the
   * published manifest require a package that 404s on the public registry.
   */
  const npmSurfaces = [
    ['packages/plugin/skills/setup/SKILL.md', join(root, 'skills/setup/SKILL.md')],
    ['packages/plugin/skills/uninstall/SKILL.md', join(root, 'skills/uninstall/SKILL.md')],
    ['packages/daemon/README.md', resolve(repo, 'packages/daemon/README.md')],
    ['packages/vscode/README.md', resolve(repo, 'packages/vscode/README.md')],
    ['the public README', publicReadme()],
  ] as const

  it('names the package npm actually publishes, at the version it actually is', () => {
    const daemon = JSON.parse(readFileSync(resolve(repo, 'packages/daemon/package.json'), 'utf8'))
    const pkg: string = daemon.name

    // Unscoped on purpose, so a scope reappearing here is the rename being half-undone rather
    // than a style change: every scope this product could use is either somebody else's or an
    // org that does not exist yet.
    expect(pkg, 'the daemon package is scoped again').not.toMatch(/^@/)

    for (const [label, path] of npmSurfaces) {
      const text = readFileSync(path, 'utf8')
      expect(text, `${label}: does not name the published package ${pkg}`).toContain(pkg)
      expect(text, `${label}: the unpublishable @tickover/cli survives here`).not.toContain('@tickover/cli')
    }

    const setup = readFileSync(join(root, 'skills/setup/SKILL.md'), 'utf8')
    // Two assertions, because losing the pin and having the wrong pin are different defects and
    // the second one's message is a lie about the first.
    expect(setup, 'the setup skill no longer pins a version at all').toContain(`${pkg}@`)
    expect(setup, `the setup skill pins a version the daemon is not at (${daemon.version})`).toContain(
      `${pkg}@${daemon.version}`,
    )
  })
})
