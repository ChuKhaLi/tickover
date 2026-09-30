// The installed `tickover` command. It exists only to check the Node version before the CLI loads.
//
// cli.js imports node:sqlite, which is unflagged from Node 22.13. ESM links every static import
// before running any code, so on an older Node the CLI dies with ERR_UNKNOWN_BUILTIN_MODULE before
// a check inside it could run -- and npm only warns on `engines`, so the install itself succeeds.
// Hence a separate entry that imports nothing statically and loads the CLI dynamically.
// 23.0-23.3 are excluded too: node:sqlite was unflagged in 22.13 and, on the 23 line, only in 23.4.
const [major = 0, minor = 0] = process.versions.node.split('.').map(Number)
const tooOld = major < 22 || (major === 22 && minor < 13) || (major === 23 && minor < 4)

if (tooOld) {
  console.error(`Tickover needs Node 22.13 or newer, or 23.4 or newer (for node:sqlite); this is Node ${process.versions.node}. Upgrade Node, then run the command again.`)
  process.exit(1)
}

await import('./cli.js')
