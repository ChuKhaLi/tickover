# Tickover

Earn while Claude thinks. Tickover shows one paid, single-choice question in Claude Code's status
line while Claude works, and pays you per answer. $0.50 a question, not $0.002 an ad.

    claude plugin marketplace add ChuKhaLi/tickover
    claude plugin install tickover@tickover
    /tickover:setup

## What this repository is

This is the open-source half of Tickover, and it is a **mirror**. Development happens in a private
monorepo that also holds the server; every component that runs on your machine is published here,
along with the web app that serves the public pages. The mirror is regenerated from the private
repository on each release, so its history is a history of published versions rather than of every
commit made along the way.

The server is not published. The reasoning is written down rather than implied: trust is the wedge
this product is built on, so the client has to be auditable, while the panel and the buyer
relationships are the business. Publishing the client is what lets you check the claims below; the
server holds no secret that changes them.

| Directory | What it is |
| --- | --- |
| `packages/plugin` | The Claude Code plugin: one hook script wired to four events, the status line script, two skills. Plain `.mjs`, no build step, no dependencies. |
| `packages/daemon` | The local daemon and CLI, published to npm as `tickover-cli`. The only component on your machine that talks to the Tickover server. |
| `packages/contract` | Shared schemas, rules and pricing constants that the client and server both validate against. |
| `packages/vscode` | The VS Code extension. Talks only to the local daemon. |
| `packages/web` | The public pages, including the privacy policy. |

## The claims you can check here

- **Nothing reads your prompts, files, paths or transcripts.** `packages/plugin/hooks/notify.mjs`
  is the whole of what Claude Code runs, and `hooks.json` is where it is wired to the four events.
- **The plugin makes no network call.** Only the daemon talks to the server; the plugin talks to the
  daemon on loopback.
- **There is no self-updater.** Updates arrive through `claude plugin update tickover` and nothing
  else.
- **The hooks cannot disturb Claude Code.** They exit within their timeout and print nothing to
  stdout, and the status line falls back to your previous line rather than to nothing.
- **What does leave your machine** is listed on the consent screen and in
  `packages/daemon/README.md`. Both, and the three web pages that publish the same lists, are held
  to one list in `packages/contract/src/disclosure.ts` by tests, so no surface can quietly narrow
  what it admits to.

## Building it

    git clone https://github.com/ChuKhaLi/tickover
    cd tickover
    pnpm install
    pnpm build
    pnpm test

The lockfile is not mirrored, because the one in the private monorepo pins the server's dependency
graph as well; `pnpm install` resolves this workspace on its own. Two test files are held back with
it: they check that the reverse-proxy configuration, its documentation and the stand-in server all
describe the same order, and both the configuration and the documentation are part of the deployment
this repository does not carry. Everything else runs, and none of it needs Docker.

Comments in here point at two kinds of thing this repository does not carry. Decisions by number, as
`R47` or `R110`, which resolve in the private repository's decisions files. And sometimes a path into
the closed half: a file under `packages/server/`, the reverse-proxy configuration in `deploy/`, a
spec or a design note under `docs/`. A handful of files do the second one, mostly to say which
server behaviour a client test is standing in for.

Both will look like dangling references, and both are left in place on purpose: the point of
publishing this code is that it is the same bytes that run on your machine, and rewriting the
comments for presentation would quietly end that guarantee. Where a decision changes something you
can observe, it is described in full on the site or in the package README rather than left as a
number.

## Issues and changes

Issues and security reports are welcome here, and so are pull requests. What happens to a pull
request is worth knowing before you spend an afternoon on one.

This repository is a mirror, so a merge made here would be erased by the next sync. A pull request
is therefore not merged here. It is applied to the private monorepo with `git am`, which keeps you
as the author of the commit, and it arrives back here in the next release along with everything
else. The sync commit carries a `Co-Authored-By:` line naming you, so the change is attributed to
you on this repository too, and the pull request is closed with a link to the release carrying it.

Every change is applied by hand rather than merged, which is deliberate and is the same reason the
rest of this README exists: this is the code that runs on your machine and holds your API token, so
nothing reaches it without somebody reading it first.

Two things that will save you time:

- **The paths here are the paths there.** `packages/plugin/hooks/notify.mjs` sits at that exact
  path in the private monorepo, so a patch cut from your pull request applies without being
  rewritten. Keep your change inside the directories listed above and it will apply cleanly.
- **This README is generated.** It is built on every sync from a source file in the private
  repository, so an edit to it here cannot survive one. Report a problem with it as an issue.

A change to the server is not something this repository can take, because the server is not here.

## License

MIT. See `LICENSE`.
