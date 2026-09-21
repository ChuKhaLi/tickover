---
name: uninstall
description: "Remove Tickover: restore the previous status line from its backup, stop the daemon, and optionally log out and remove the npm package."
---

Undo the Tickover setup. Do these steps in order.

1. Restore the status line: if `~/.tickover/statusline-backup.json` exists, set `statusLine` in `~/.claude/settings.json` to its exact contents; otherwise delete the `statusLine` key. Keep every other key unchanged.
2. Drain any undelivered answers **before stopping anything**: run `tickover status` and read `queuedAnswers`. These are answers the developer has already given that the server has not accepted yet, and `~/.tickover/state.sqlite` holds the only copy of them. If it is greater than 0, tell the developer, leave the daemon running, and check again every couple of minutes until it reaches 0 (delivery retries back off up to 15 minutes, so this can take a while if the network or the server was down). If they would rather not wait, say plainly how many answers they are giving up and get their agreement before continuing.
3. Stop the daemon: read `~/.tickover/daemon.json`; if present, end the process with that `pid` (`taskkill /PID <pid> /F` on Windows, `kill <pid>` elsewhere) and delete `daemon.json`.
4. Ask the developer with AskUserQuestion whether to also log out and delete local data (options: "Log out and delete ~/.tickover" / "Keep my login and earnings history locally"). If they choose to delete: run `tickover logout`, then remove the `~/.tickover` directory.
5. Ask whether to remove the npm package (options: "Remove tickover-cli from npm -g" / "Keep it"). If yes: `npm uninstall -g tickover-cli`.
6. Remind the developer to run `claude plugin uninstall tickover` to remove the hooks and this skill. Earnings the server has already recorded — everything that reached it, which is everything once `queuedAnswers` is 0 — stay on their account and are paid out on the normal schedule; deleting `~/.tickover` does not touch them. Anything still queued at step 2 that they chose not to wait for is gone with that directory and will never be paid.
