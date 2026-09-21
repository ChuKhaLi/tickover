# Tickover plugin for Claude Code

One paid question in the status line while Claude works. Requires the `tickover` daemon (installed by `/tickover:setup`).

    claude plugin marketplace add ChuKhaLi/tickover
    claude plugin install tickover@tickover
    /tickover:setup

What this plugin contains: one hook script, registered against four Claude Code events, that tells the local daemon when a turn starts and stops (it exits in under a second and prints nothing), a status line script that asks the daemon for one line, and two skills (`setup`, `uninstall`). Where Claude Code's function hooks (Mods) are enabled, it also loads one hooks module, `hooks/band.tsx`, which draws the open question above the prompt and sends your number-key answer to the local daemon; it reads no prompt text. No network calls leave your machine from this plugin; only the daemon talks to the Tickover server. No self-updater: updates arrive through `claude plugin update tickover`.
