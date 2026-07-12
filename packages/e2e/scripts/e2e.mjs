import { spawnSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const workspaceRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
const pnpm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'

// Build the composed apps/host/dist THIS suite serves before Playwright starts —
// but only locally.
//
// WHY THIS EXISTS: the Playwright webServer serves a STATIC prebuilt apps/host/dist
// via `vite preview` (see playwright.config.ts); the suite itself never builds it.
// That dist is a COMPOSITION — apps/host/src/build-pages.mjs copies apps/shell/dist
// into /web/, /widget/, /mobile/ and apps/canvas/dist into /canvas/. Two traps make
// a stale dist easy to serve, and both produce specs that fail against OUTDATED
// bundles with confusing errors unrelated to the change under test (e.g. a /web/
// spec that never sees code added since the shell was last built):
//   1. Never rebuilding after a source change — `vite preview` happily serves an
//      old dist.
//   2. Running `pnpm --filter @tinytinkerer/host build`, which runs ONLY host's own
//      `vite build && build-pages.mjs`: it RE-COPIES whatever apps/shell/dist and
//      apps/canvas/dist already exist WITHOUT rebuilding them. It looks like a full
//      build (and finishes in ~1s) but composes stale endpoint bundles.
// The correct build is `turbo run build --filter=@tinytinkerer/host`, whose task
// graph rebuilds shell + canvas + root FIRST, then composes. Doing it here means a
// plain `pnpm --filter @tinytinkerer/e2e e2e` can never serve a stale dist. Turbo's
// cache makes it a fast no-op when nothing changed.
//
// SKIPPED IN CI: a dedicated `build-shells` job builds the shells once and the
// shards download that artifact into apps/*/dist (they install `scriptless` and must
// not rebuild). GitHub Actions always sets CI=true, so that path is untouched. Set
// E2E_SKIP_BUILD=1 to skip locally too when you deliberately serve a prebuilt dist.
/**
 * @param {string[]} args - argv passed to `pnpm`
 * @param {Record<string, string>} [extraEnv] - env overrides for this step
 */
const runOrExit = (args, extraEnv) => {
  const step = spawnSync(pnpm, args, {
    stdio: 'inherit',
    cwd: workspaceRoot,
    env: { ...process.env, ...extraEnv }
  })
  if (step.status !== 0) {
    console.error(`\n[e2e] preflight build failed: pnpm ${args.join(' ')}`)
    process.exit(step.status ?? 1)
  }
}

if (!process.env.CI && process.env.E2E_SKIP_BUILD !== '1') {
  console.log(
    '[e2e] Building composed host so the served apps/host/dist matches source ' +
      '(turbo cache makes this fast when nothing changed; set E2E_SKIP_BUILD=1 to skip).'
  )
  // Regenerate the two gitignored source files the shell build imports (privacy
  // policy + third-party notices). Fast, idempotent, offline. Brand assets are
  // built by turbo's @tinytinkerer/brand-assets#build in the graph below, so the
  // slow root generator stays skipped (TINYTINKERER_SKIP_BRAND_ASSET_GENERATION=1),
  // matching the CI build step.
  runOrExit(['run', 'generate:privacy-policy'])
  runOrExit(['run', 'generate:notices'])
  runOrExit(['exec', 'turbo', 'run', 'build', '--filter=@tinytinkerer/host'], {
    TINYTINKERER_SKIP_BRAND_ASSET_GENERATION: '1'
  })
}

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
