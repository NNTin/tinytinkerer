# `@tinytinkerer/e2e`

Playwright end-to-end tests that exercise the app together with the **real edge
worker**, end to end in a real browser.

## How it works

The suite mocks **only LiteLLM** (the upstream model provider). Everything else is
real: the production build of the single browser shell (`@tinytinkerer/shell`, served
from the composed `apps/host/dist` at `/web/`, `/widget/`, `/mobile/`) plus the integrated
stages (including Canvas and Pixel Agents), all served from that composed origin, and the actual
edge Hono worker — driven in-process via `app.fetch`, so its routing, validation, CORS,
anonymous-tier key provisioning, and the chat proxy are all covered.

Runs are **anonymous** (no GitHub auth) and **rate limiting is disabled** — neither
auth nor rate limiting is under test. Because only LiteLLM is mocked, the suite needs
no secrets and makes no real network calls.

## Layout

- `scripts/e2e.mjs` — chooses the per-run ports before Playwright starts, so the
  servers and workers share the same base URLs. The three browser endpoints share ONE
  origin: `E2E_PORT` (and its aliases `E2E_PORT_WIDGET` / `E2E_PORT_MOBILE`, kept for
  specs that build per-endpoint URLs). Canvas is mounted at `/canvas/` on that origin,
  so parallel git worktrees need only one generated port.
- `playwright.config.ts` — three browser projects: `chromium`, `firefox`, `webkit`.
  Chromium runs the whole suite; `firefox` + `webkit` are restricted (via per-project
  `testMatch`) to **just** `sandbox-isolation.e2e.ts`, because the sandbox-isolation
  guarantees are engine-sensitive (Blink / Gecko / WebKit) and cross-engine coverage
  is the point of issue #245. Every other spec stays Chromium-only — out of scope for
  #245. One `vite preview --strictPort` server serves the composed `apps/host/dist`,
  including `/web/`, `/widget/`, `/mobile/`, `/canvas/`, `/ide/`, `/mermaid/`,
  `/pixel-agents/`, and the root app.
- `fixtures/mock-litellm.ts` — pipes `/api/*` through the real edge worker and mocks
  the LiteLLM upstream it calls; plus the shared UI helpers.
- `fixtures/first-load.ts` — shared first-load dialog dismissal + shell-port env
  helpers, dependency-free so canvas specs can use it without pulling the edge worker.
- `fixtures/snippets.ts` — adversarial inputs used by the current suite.
- `reporters/bail-warning.ts` — a Playwright reporter (CI only) that emits a job
  **warning** listing the tests a `maxFailures` bail skipped, since those run nothing and
  so are otherwise absent from the merged Allure report. See _Bail-fast_ below.
- `tests/*.e2e.ts` — the specs (`*.e2e.ts`, kept out of vitest's globs).
  `sandbox-isolation.e2e.ts` verifies the code-exec sandbox isolation guarantees
  that jsdom cannot cover; `event-logger.e2e.ts` verifies the Event Logger plugin
  logs chat events to the console when enabled (and stays silent when disabled);
  `permissions.e2e.ts` verifies the Permissions plugin gates tools behind a
  confirmation modal (allow / deny / Escape / negative); `mermaid.e2e.ts` verifies
  a streamed ` ```mermaid ` block renders a real `<svg>` (the actual mermaid library
  running — jsdom unit tests mock `mermaid.render`) and that an invalid block falls
  back to a code block without crashing the turn; `markdown-renderers.e2e.ts` verifies
  the remaining renderers jsdom cannot exercise — sticky table headers + CSV download,
  the image lightbox, CodeMirror highlighting, the scriptless wireframe iframe,
  callouts, and link cards — each streamed as deltas so incremental parsing is covered;
  `chat-persistence.e2e.ts` verifies a conversation persists to IndexedDB (Dexie) and
  is restored on reload across all three endpoints (web/widget/mobile), and asserts the
  shared-session behaviour described below. See `pixel-agents-testing.md` for the Pixel
  Agents e2e suite (`pixel-agents.e2e.ts` / `pixel-agents-activity.e2e.ts`) architecture and
  its LiteLLM mock interplay.

### Single-origin topology and IndexedDB namespaces

`chat-persistence.e2e.ts` drives the browser endpoints, and canvas feature tests use
`/canvas/`; all are built and served from ONE origin (the composed `apps/host/dist`) at different paths — matching production.
Web, widget, and mobile default to the **same** Dexie database name (`storageNamespace` =
`tinytinkerer`) and, being same-origin, **share** one IndexedDB: a conversation created
under `/web/` **is** visible from `/widget/`, so signing in / a conversation on one
endpoint carries to the others. The spec asserts this directly. Canvas deliberately uses the separate
`tinytinkerer-canvas` database in the same origin. Build the composed host before a run (see below);
CI builds it and pins the shared port.

### Observing a mid-stream render

Some specs must assert a renderer's **mid-stream** state — e.g. that an incomplete
(unclosed-fence) `mermaid` block renders no broken SVG before the completed block
renders one, or that a half-streamed table stays graceful. Playwright's
`route.fulfill` is atomic — the browser receives the whole SSE body at once — so the
frontend never lingers in a partial state long enough to observe. To create a real,
observable window the mock streams a `: tt-gate` SSE-comment marker (emitted by
`sseStream` wherever a synthesis answer carries `GATE_SENTINEL`; the chat client's
SSE parser ignores comment lines, so it is inert elsewhere), and `installStreamGate`
(in `fixtures/mock-litellm.ts`) installs a page-side re-pacer that wraps
`window.fetch`: it takes the **real** edge SSE response and replays it as a
controllable stream — flush part 1, wait for `releaseStreamGate(page)`
(`window.__ttGate.release()`), then flush the rest. Nothing in the app or edge is
mocked (the bytes come from the real worker); only byte delivery is paced, exactly
as a slow network would.

## Bail-fast (`maxFailures`)

In CI each shard stops once **3** tests have failed (`E2E_MAX_FAILURES`, default `3`;
`0` = unbounded; unbounded locally). A single root cause tends to red many tests at once,
and with `retries: 1` each failure runs twice, so bailing avoids burning CI minutes on an
already-doomed shard — most of all when the cascade shows up as 60s timeouts.

The budget is **per shard** (one Playwright process per shard, no cross-shard
coordination), so the effective total is `3 × shard count`. That is fine: `--shard`
spreads a cascade's victims across shards, so each affected shard bails on its own cluster.
A flaky test that passes on retry does **not** count toward the budget.

When a shard bails, its remaining tests don't run — so they produce no Allure result and
are absent from the merged report. `reporters/bail-warning.ts` annotates the job with a
warning naming those skipped tests so the partial report is not mistaken for a full pass.
The failures that tripped the bail still red the e2e gate; **re-run to see the full
failure picture.** Tune the threshold in `.github/workflows/e2e-reusable.yml`.

## Running locally

One-time browser install (downloads to the shared `~/.cache/ms-playwright`):

```bash
pnpm --filter @tinytinkerer/e2e e2e:install   # playwright install --with-deps chromium firefox webkit
```

This installs all three engines. To iterate on just one, target a project:

```bash
pnpm --filter @tinytinkerer/e2e e2e -- --project=firefox   # or chromium / webkit
```

The suite serves a **static** prebuilt `apps/host/dist` via `vite preview` — it never
builds it. So a local run **auto-builds** that dist first: `scripts/e2e.mjs` composes
the host through turbo (rebuilding shell + canvas + root, then composing) before
Playwright starts, so you can just run:

```bash
pnpm --filter @tinytinkerer/e2e e2e
```

Turbo's cache makes the build a fast no-op when nothing changed. It is skipped in CI
(a dedicated job builds the shells and the shards download that artifact) and can be
skipped locally with `E2E_SKIP_BUILD=1` when you deliberately serve a prebuilt dist.

> ⚠️ Do **not** build the served dist with `pnpm --filter @tinytinkerer/host build`.
> That runs only host's own `vite build && build-pages.mjs`, which **re-copies**
> `apps/shell/dist` / `apps/canvas/dist` into the composed output **without rebuilding
> them** — it finishes in ~1s and looks like a full build but serves **stale** endpoint
> bundles, so `/web/` specs assert against outdated code and fail confusingly. Always
> build through turbo (which the auto-build above does):
> `TINYTINKERER_SKIP_BRAND_ASSET_GENERATION=1 pnpm exec turbo run build --filter=@tinytinkerer/host`.

> Pin `E2E_PORT` to fix the shared origin's port; otherwise the wrapper picks a random
> port. Every endpoint, including canvas, uses that origin.

> On a headless box without root (e.g. some WSL2 setups) where
> `playwright install --with-deps` cannot install the OS libraries, download the
> Debian/Ubuntu `.deb`s for the missing libs without root (`apt-get download` +
> `dpkg -x` into a prefix) and export `LD_LIBRARY_PATH` to that prefix before running.
> Firefox needs few extra libs, but **WebKit pulls in many** (GTK / GStreamer / WebP /
> ICU / libwoff, etc.).
> Without root, install the browser binaries with `playwright install firefox webkit`
> (no `--with-deps`), then let `playwright install-deps` report the exact package list.
> `sudo` that where you have root, or fall back to the `.deb` prefix above.
> Chromium-only iteration needs none of this: run
> `pnpm --filter @tinytinkerer/e2e e2e -- --project=chromium`.
