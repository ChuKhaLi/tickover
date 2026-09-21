# Tickover for VS Code

Shows the current Tickover question in the status bar and lets you answer it from a QuickPick. Requires the `tickover` daemon (`npm i -g tickover-cli`, then `tickover login`). Works in VS Code, Cursor, Windsurf, Trae, and Kiro.

Commands: Tickover: Answer the current question · Tickover: Skip the current question · Tickover: Open the answer page.

The extension only talks to the daemon on 127.0.0.1 with the token from `~/.tickover/daemon.json`. It never reads your files or your prompts.

## Local editors only

The extension reads `~/.tickover/daemon.json` and connects to `127.0.0.1` **from the extension host's own machine**. In a remote setup — VS Code Remote SSH, Dev Containers, WSL, GitHub Codespaces — the extension host runs on the remote side while the daemon (and your `~/.tickover`) is on your local machine, so the extension finds no `daemon.json` and the status bar reads `tickover: daemon off`. Nothing is broken and nothing is lost; the extension simply cannot see the daemon across that boundary.

Answer from the terminal pane (`tickover pane`) or the browser page (`tickover page`) on your local machine instead, or run the daemon on the remote side and use those. The hooks and the status line are unaffected: they run wherever the Claude Code session runs.
