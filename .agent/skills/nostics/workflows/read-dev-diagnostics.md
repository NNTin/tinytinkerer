# Read the diagnostics the dev app emitted

Goal: see the structured diagnostics the running app produced during local development, instead of squinting at the browser console.

## How diagnostics reach you in dev

The diagnostics module wires two **dev-only** reporters (gated on `import.meta.env.DEV`):

- **console reporter** — prints the formatted diagnostic (code, why, fix, sources, docs) to the **browser console**.
- **dev reporter** (`nostics/reporters/dev`) — forwards each diagnostic over the Vite dev-server socket (`import.meta.hot.send('nostics:report', ...)`). `nosticsCollector` (wired serve-only into each browser shell's `vite.config.ts` — `apps/web`, `apps/mobile`, `apps/widget`) appends it as NDJSON to **that shell's `.nostics.log`** (e.g. `apps/web/.nostics.log`). The host dev server runs one Vite server per shell using its own config, so the log lands under whichever shell you exercised.

So: trigger the code path in the browser (see the `browser-debugging` skill to drive the app), then read the log.

## Steps

1. Start the dev servers if they are not up (`browser-debugging` skill → `tools/start-dev.sh`). The web dev server must be the one serving `/web/`, because the collector only runs under `vite serve`.
2. Exercise the path that emits the diagnostic (click the flow / reproduce the failure).
3. Read the collected diagnostics:
   ```bash
   node .agent/skills/nostics/tools/read-diagnostics.mjs            # pretty-print all
   node .agent/skills/nostics/tools/read-diagnostics.mjs --code TT_CONTENT_RENDER_TELEMETRY_WIRING_FAILED
   node .agent/skills/nostics/tools/read-diagnostics.mjs --watch    # tail as new ones land
   ```
   The tool searches each shell's log (`apps/web`, `apps/mobile`, `apps/widget`, then a repo-root `.nostics.log` fallback; first existing wins), parses the NDJSON, and prints each entry's code / why / fix / sources / docs / cause. Use it instead of `cat` — the raw file is one JSON object per line.

## If the log is empty or missing

- **No `.nostics.log` at all** → the dev-server collector never ran. Confirm you started `vite serve` (not a production `vite build`), and that `nosticsCollector.vite()` is still in the relevant shell's `vite.config.ts` for `command === 'serve'`.
- **Log exists but your code isn't there** → the path didn't execute, or the diagnostic is a `throw` that aborted before the reporter flushed (reporters run before the throw, so it should still appear — re-check the code actually ran). Also confirm the reporter is dev-gated _on_ (`import.meta.env.DEV` is true under `vite serve`).
- **Nothing in the browser console either** → the diagnostics module's reporters array may be empty; check `packages/app/app-browser/src/diagnostics.ts`.

## Don't

- Don't expect `.nostics.log` in a production build — the collector is `serve`-only and the diagnostics are stripped. To inspect prod behaviour, use Sentry (`sentry-debugging` skill).
- Don't commit `.nostics.log` — it is gitignored dev output.
