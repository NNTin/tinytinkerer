# `@tinytinkerer/e2e`

Playwright end-to-end tests that exercise the app together with the **real edge
worker**, end to end in a real browser.

## How it works

The suite mocks **only LiteLLM** (the upstream model provider). Everything else is
real: the production `vite preview` build of `@tinytinkerer/web`, and the actual edge
Hono worker — driven in-process via `app.fetch`, so its routing, validation, CORS,
anonymous-tier key provisioning, and the chat proxy are all covered.

Runs are **anonymous** (no GitHub auth) and **rate limiting is disabled** — neither
auth nor rate limiting is under test. Because only LiteLLM is mocked, the suite needs
no secrets and makes no real network calls.

## Layout

- `playwright.config.ts` — Chromium project; `webServer` runs `vite preview` on a
  per-run port (`E2E_PORT`, else a random high port) so parallel git worktrees don't
  collide.
- `fixtures/mock-litellm.ts` — pipes `/api/*` through the real edge worker and mocks
  the LiteLLM upstream it calls; plus the shared UI helpers.
- `fixtures/snippets.ts` — adversarial inputs used by the current suite.
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
  callouts, and link cards — each streamed as deltas so incremental parsing is covered.

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

## Running locally

One-time browser install (downloads to the shared `~/.cache/ms-playwright`):

```bash
pnpm --filter @tinytinkerer/e2e e2e:install   # playwright install --with-deps chromium
```

Build the web shell once (the suite serves its production bundle), then run:

```bash
pnpm generate:brand-assets && pnpm generate:privacy-policy && pnpm generate:notices
TINYTINKERER_SKIP_BRAND_ASSET_GENERATION=1 pnpm exec turbo run build --filter=@tinytinkerer/web
pnpm --filter @tinytinkerer/e2e e2e
```

> On a headless box without root (e.g. some WSL2 setups) where
> `playwright install --with-deps` cannot install the OS libraries, download the
> Debian/Ubuntu `.deb`s for the missing libs without root (`apt-get download` +
> `dpkg -x` into a prefix) and export `LD_LIBRARY_PATH` to that prefix before running.
