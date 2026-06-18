# `@tinytinkerer/e2e`

Playwright end-to-end tests. The first (and currently only) suite is **real-browser
verification of the code-exec sandbox isolation guarantees** that jsdom cannot cover
(GitHub issue [#217](https://github.com/NNTin/tinytinkerer/issues/217)). See
[`docs/e2e-testing.md`](../../docs/e2e-testing.md) for the full architecture.

## How it works

LiteLLM is **mocked in-page**: Playwright intercepts `/api/models/chat` and streams a
fixture so the **real frontend agent runtime** auto-invokes the `run_javascript` tool
with an adversarial snippet. The sandbox result the runtime folds back into the next
model request is the test's in-sandbox oracle; an independent Playwright observation
(no sentinel network response / the sandbox iframe torn down) is the external oracle.

Because the mock replaces the model, the suite is hermetic — no edge, no auth, no
network, **anonymous mode** and **rate limiting** are intrinsic, and it needs no
secrets. The app under test is the production `vite preview` build of `@tinytinkerer/web`.

## Layout

- `playwright.config.ts` — Chromium project; `webServer` runs `vite preview` on a
  per-run port (`E2E_PORT`, else a random high port) so parallel git worktrees don't
  collide.
- `fixtures/mock-litellm.ts` — the content-driven `/api/models/chat` mock + UI helpers.
- `fixtures/snippets.ts` — the adversarial snippets, one per guarantee.
- `tests/sandbox-isolation.e2e.ts` — one test per guarantee (`*.e2e.ts`, kept out of
  vitest's globs).

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
