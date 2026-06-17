# SOP: debug `pnpm dev` in a real browser

Get from a cold checkout to a consented, signed-in app you can drive with `agent-browser`.

## 1. Start the dev servers

**Fast path — use the preflight tool.** It frees stale ports, ensures deps +
native builds, generates brand assets, and waits for both servers:

```
bash .agent/skills/browser-debugging/tools/start-dev.sh
```

Or do it by hand with `pnpm dev`, then wait until both are up:

- **frontend (host):** `http://localhost:3111` — logs `@tinytinkerer/host listening at http://127.0.0.1:3111`
- **edge (worker):** `http://localhost:8787` — `GET /health` returns 200

Readiness check:

```
curl -sf -o /dev/null http://localhost:3111 && curl -sf http://localhost:8787/health
```

### Cold-start gotchas (a fresh worktree hits all of these)

- **`Cannot find package 'sharp'`** at `generate:brand-assets` → `node_modules`
  is missing or pnpm skipped native build scripts. Run `pnpm install`, then
  `pnpm rebuild sharp esbuild workerd` (pnpm ignores those build scripts by
  default). The `start-dev.sh` tool does this for you.
- **`Address already in use ... 0.0.0.0:8787`** → a stale/orphaned `workerd`
  (often from _another_ worktree's dev run, re-parented to PID 1) still holds the
  edge port. Find and kill it: `lsof -ti:8787` then `kill -9 <pid>`. `pnpm dev`
  brings up host+edge together, so an occupied :8787 takes the whole run down.
- **`Could not resolve "@hono/zod-openapi"`** → deps are stale; `pnpm install`.
  The frontend and PAT login still work without the edge; only `:8787`-proxied
  model/chat calls won't.

## 2. Open + consent + sign in

```
node .agent/skills/browser-debugging/tools/browser-login.mjs
```

This opens `http://localhost:3111/web/` (the web shell — **not** `/`, which is an iframe host), clicks **Accept** on the telemetry/privacy notice if it appears, and pastes the PAT into Settings → Auth. The token comes from the `TINYTINKERER_GITHUB_TOKEN` environment variable (exported in `~/.bashrc`), falling back to `.env.github` when it is unset.

> **Token gotcha (non-interactive shells):** `~/.bashrc` is only sourced by
> _interactive_ shells, so a tool-invoked bash often has `TINYTINKERER_GITHUB_TOKEN`
> unset, and `.env.github` is per-worktree (it may live only in a _different_
> checkout). If login can't find the token, either `source ~/.bashrc` first, or
> hand it through inline for one command, e.g.:
>
> ```
> export TINYTINKERER_GITHUB_TOKEN="$(grep -oP 'export (TINYTINKERER_GITHUB_TOKEN|GITHUB_MODELS_TOKEN)=\K.*' ~/.bashrc | tr -d '\"')"
> node .agent/skills/browser-debugging/tools/browser-login.mjs
> ```

Exit codes:

- **0** — app is open and signed in (or was already). Proceed.
- **non-zero** — read the message. The common ones: _"TINYTINKERER_GITHUB_TOKEN is not set …"_ → export it (open a fresh shell so `~/.bashrc` runs, or `source ~/.bashrc`) or populate `.env.github`. _"the app dropped it: api.github.com/user returned 401"_ → the token lacks profile access. Supply a classic PAT or a fine-grained token with profile read access. The browser is left open regardless, so you can still debug the signed-out UI.

## 3. Drive and inspect

Re-snapshot after every page change; refs go stale.

```
agent-browser snapshot -i              # interactive elements + @refs
agent-browser click @e23               # act on a ref
agent-browser console                  # console logs
agent-browser errors                   # uncaught page errors
agent-browser network requests         # network history (method/url/status)
agent-browser screenshot /tmp/state.png
```

Find elements without snapshotting: `agent-browser find role button click --name "Settings"`.

### agent-browser command quirks (this CLI version)

- **`find` needs an ACTION.** `find role button --name X` errors with
  _"Unknown subaction: --name"_. Put the action before the flags:
  `find role button click --name "Refresh models"`.
- **`network` has no `--filter` / `clear`.** Valid subactions are `route`,
  `unroute`, `requests`, `request`, `har`. Filter by piping:
  `agent-browser network requests | grep models/list`. Count fired requests with
  `... | grep -c <path>` before/after an action to prove a click actually hit the
  network (the model-refresh no-op was caught exactly this way).
- **Reload with `agent-browser open <url>`, not `eval 'location.reload()'`.**
  An eval-triggered reload while CDP is attached double-mounts React in dev mode
  and spews bogus `createRoot()` / `removeChild NotFoundError` console errors that
  look like app bugs but aren't. A clean `open` re-load avoids them.
- **`[role="dialog"]` is keyed by `aria-label`.** Wait on the exact label, e.g.
  `agent-browser wait '[aria-label="Settings"][role="dialog"]'`; a generic
  `[role=dialog]` wait can time out. Opening Settings can need a second click if
  the login tool just closed it.

## 4. Finish

Leave the session running while you iterate (closing it wipes consent + login and forces a redo). When done:

```
agent-browser close --all
```

## Troubleshooting

- **`open` hangs / `CDP command timed out: Page.navigate`** — a wedged session. `agent-browser close --all`, then re-open. (`browser-login.mjs` already self-heals this once.)
- **`eval`/`querySelector` finds nothing that's clearly on screen** — you're on `/` (iframe host), not `/web/`. Re-open `http://localhost:3111/web/`.
- **Consent dialog keeps reappearing** — the session was closed/reset; consent is per browser profile. Just Accept again (the tool does).
- **Signed in, then signed out a few seconds later** — the `/user` 401 token-drop (see step 2). It's the token's scope, not a flake.
