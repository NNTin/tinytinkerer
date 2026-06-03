# SOP: debug `pnpm dev` in a real browser

Get from a cold checkout to a consented, signed-in app you can drive with `agent-browser`.

## 1. Start the dev servers

```
pnpm dev
```

Run it in the background and wait until both are up:

- **frontend (host):** `http://localhost:3111` — logs `@tinytinkerer/host listening at http://127.0.0.1:3111`
- **edge (worker):** `http://localhost:8787` — `GET /health` returns 200

Readiness check:

```
curl -sf -o /dev/null http://localhost:3111 && curl -sf http://localhost:8787/health
```

If the edge fails to build with `Could not resolve "@hono/zod-openapi"`, deps are stale — run `pnpm install`, then restart. The frontend and PAT login still work without the edge; only `:8787`-proxied model/chat calls won't.

## 2. Open + consent + sign in

```
node .agent/skills/browser-debugging/tools/browser-login.mjs
```

This opens `http://localhost:3111/web/` (the web shell — **not** `/`, which is an iframe host), clicks **Accept** on the telemetry/privacy notice if it appears, and pastes the PAT into Settings → Auth. The token comes from the `GITHUB_MODELS_TOKEN` environment variable (exported in `~/.bashrc`), falling back to `.env.github` when it is unset.

Exit codes:

- **0** — app is open and signed in (or was already). Proceed.
- **non-zero** — read the message. The common ones: _"GITHUB_MODELS_TOKEN is not set …"_ → export it (open a fresh shell so `~/.bashrc` runs, or `source ~/.bashrc`) or populate `.env.github`. _"the app dropped it: api.github.com/user returned 401"_ → the token lacks profile access (Models-only fine-grained token). Supply a classic PAT or a fine-grained token with profile read access. The browser is left open regardless, so you can still debug the signed-out UI.

## 3. Drive and inspect

Re-snapshot after every page change; refs go stale.

```
agent-browser snapshot -i              # interactive elements + @refs
agent-browser click @e23               # act on a ref
agent-browser console                  # console logs
agent-browser errors                   # uncaught page errors
agent-browser network requests --filter github   # filter network
agent-browser screenshot /tmp/state.png
```

Find elements without snapshotting: `agent-browser find role button click --name "Settings"`.

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
