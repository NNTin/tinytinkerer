import { spawnSync } from 'node:child_process'

// The three browser endpoints (/web/, /widget/, /mobile/) are now ONE build served
// from ONE origin (the composed apps/host/dist) — matching production, where they
// share a Cloudflare Pages origin. So E2E_PORT_WIDGET and E2E_PORT_MOBILE are the SAME
// port as E2E_PORT: the specs that build per-endpoint URLs (chat-persistence,
// widget-morph) point at the shared origin, different path. Canvas keeps its own
// origin (it hosts the sandboxed Excalidraw iframe with its own ACAO preview headers).
//
// Allocate the two ports here, ONCE, before Playwright starts, so every Playwright
// process (runner + the config, re-evaluated per worker) agrees on the base URLs. CI
// pins E2E_PORT (and may pin E2E_PORT_CANVAS); locally we pick a random base port and
// derive canvas as base+3. Servers bind with --strictPort so a collision fails fast.
const generatedPort = !process.env.E2E_PORT
const basePort = process.env.E2E_PORT ?? String(40000 + Math.floor(Math.random() * 20000))
// Same origin as web — one build serves all three browser endpoints.
const widgetPort = basePort
const mobilePort = basePort
const canvasPort = process.env.E2E_PORT_CANVAS ?? String(Number(basePort) + 3)

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
    E2E_PORT_CANVAS: canvasPort,
    E2E_PORT_GENERATED: generatedPort ? '1' : ''
  }
})

if (result.signal) {
  process.kill(process.pid, result.signal)
}

process.exit(result.status ?? 1)
