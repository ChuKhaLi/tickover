# tickover-cli

Earn while Claude thinks. Tickover shows one paid, single-choice question in Claude Code's idle window and pays you per answer. This package is the local daemon and CLI.

The npm package is `tickover-cli`; the command it installs is `tickover`.

    npm install -g tickover-cli
    tickover login        # GitHub device flow, opens a code you enter on github.com
    tickover pane         # optional: a terminal pane to answer with one key
    tickover page         # optional: open the answer page in your browser

Install the Claude Code plugin to get the status line and hooks:

    claude plugin marketplace add ChuKhaLi/tickover
    claude plugin install tickover@tickover
    /tickover:setup

## What leaves your machine

GitHub id (from login), your operating system, the Claude Code version, when each turn starts and stops, the Claude Code session id and when that session started, counts of file extensions in your project directory, which questions you skip, and your answers with how long you took and where you answered them (terminal pane, local page, VS Code, or inside Claude Code).

Derived from those, and never sent by the plugin: your country, from the IP address of the request, and an activity tier from how many turns you run a week (light under 5, regular 5 to 20, heavy over 20). Buyers can target studies on both, which is why they are listed here rather than only in the privacy policy.

Never: prompts, file contents, file paths, repository names, repository owners, or transcripts.

## Files

`~/.tickover/config.json` (server URL, API token, install token), `daemon.json` (port, token, pid while running), `state.sqlite`, `daemon.log`. Set `TICKOVER_HOME` to move them.

## Commands

`tickover daemon` runs in the foreground (the plugin starts it detached for you). `tickover status` prints health and balances. `tickover logout` clears the token. `tickover pane` opens the answer pane. `tickover page` prints and opens the browser answer page's URL — that URL carries the daemon token, which is why `tickover status` deliberately does not print it.

## Packaging

The published tarball has no runtime dependencies at all: `tsup` bundles `@tickover/contract`, `zod` and `string-width` into `dist/cli.js`, which then imports nothing but Node builtins. All three are therefore build-time dependencies and live in `devDependencies` — declaring them as `dependencies` made the published manifest require `@tickover/contract@0.1.0`, a workspace-only package that 404s on the public registry, so the tarball could not be installed at all.
