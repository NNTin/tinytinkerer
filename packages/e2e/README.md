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
- `tests/*.e2e.ts` — the specs (`*.e2e.ts`, kept out of vitest's globs). The first
  suite verifies the code-exec sandbox isolation guarantees that jsdom cannot cover.

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
