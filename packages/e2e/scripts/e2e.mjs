import { spawnSync } from 'node:child_process'

// The suite now serves THREE product shells, each on its own port (its own origin):
// web (/web/), widget (/widget/), and mobile (/mobile/). Allocate all three ports
// here, ONCE, before Playwright starts, so every Playwright process (runner + the
// config, which is re-evaluated per worker) agrees on the same base URLs.
//
// CI pins E2E_PORT (and may pin E2E_PORT_WIDGET / E2E_PORT_MOBILE). Locally we pick a
// random base port and derive the other two as base+1 / base+2, so parallel git
// worktrees don't collide. Each shell binds with --strictPort, so a collision fails
// fast rather than silently serving the wrong bundle.
const generatedPort = !process.env.E2E_PORT
const basePort = process.env.E2E_PORT ?? String(40000 + Math.floor(Math.random() * 20000))
const widgetPort = process.env.E2E_PORT_WIDGET ?? String(Number(basePort) + 1)
const mobilePort = process.env.E2E_PORT_MOBILE ?? String(Number(basePort) + 2)

// Forward extra args (e.g. `--shard=1/3` from CI) to `playwright test`. Strip any
// bare `--` separator: pnpm can pass the `--` token through to the script, and
// Playwright treats everything after a lone `--` as positional test-file filters,
// which would swallow real flags ("No tests found").
const executable = process.platform === 'win32' ? 'playwright.cmd' : 'playwright'
const forwardedArgs = process.argv.slice(2).filter((arg) => arg !== '--')
const result = spawnSync(executable, ['test', ...forwardedArgs], {
  stdio: 'inherit',
  env: {
    ...process.env,
    E2E_PORT: basePort,
    E2E_PORT_WIDGET: widgetPort,
    E2E_PORT_MOBILE: mobilePort,
    E2E_PORT_GENERATED: generatedPort ? '1' : ''
  }
})

if (result.signal) {
  process.kill(process.pid, result.signal)
}

process.exit(result.status ?? 1)
