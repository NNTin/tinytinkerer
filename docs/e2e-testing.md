# End-to-End Testing (Playwright) — Architecture & Plan

> Status: **IMPLEMENTED.** The suite lives in [`packages/e2e`](../packages/e2e) and is wired into
> CI ([`.github/workflows/e2e.yml`](../.github/workflows/e2e.yml)). All seven guarantees for GitHub
> issue **#217** pass in Chromium against the production `vite preview` build. This document is both
> the design rationale and the as-built record; the **“As built”** callouts in §2/§4/§6/§7 note where
> implementation chose a specific option the plan had left open.

## 1. Goal & scope

The host-side orchestration of the code-execution plugin (message boundary, nonce, single-settle,
concurrency, timeout clamping, output caps) is already unit-tested in jsdom. What jsdom **cannot**
exercise — and what this suite exists to prove — are the **load-bearing isolation guarantees** of
`packages/app/app-browser/src/sandbox-executor.ts`, because they need a real browser engine
(real Worker, real CSP enforcement, real opaque-origin iframe):

1. **No network egress** — CSP `connect-src 'none'` blocks `fetch` / `XMLHttpRequest` /
   `WebSocket` / `sendBeacon` / `EventSource` inside the Worker.
2. **No `eval` / `new Function`** — no `'unsafe-eval'` in the CSP ⇒ both throw.
3. **Opaque origin** — code cannot reach `parent`/`top` DOM, `localStorage`, `sessionStorage`,
   `indexedDB`, `document.cookie`, or the app URL (`sandbox="allow-scripts"`, **no**
   `allow-same-origin`).
4. **Empty referrer** — `referrerPolicy="no-referrer"` ⇒ no `Referer` on any attempted load.
5. **No resource loads** — `img-src 'none'` / `media-src 'none'` block `new Image().src = …`
   exfiltration.
6. **Worker creation works** — under `worker-src blob:` inside the sandboxed opaque-origin iframe
   (the one capability the design depends on actually functioning).
7. **Timeout / teardown** — `while(true){}` is terminated at the deadline (`timedOut: true`) and
   the iframe is torn down (no residual `<iframe title="code execution sandbox">` nodes).

**Out of scope** for #217: visual/UX regression, the real LLM, real auth, real LiteLLM spend.

### Key architectural fact that shapes everything

The sandbox's entire security boundary is **self-contained in `sandbox-executor.ts`**: the CSP is an
in-document `<meta http-equiv="Content-Security-Policy">` inside `SANDBOX_SRCDOC`, and
opaque-origin / no-referrer / blob-worker all come from **iframe attributes set in JS**. **None of
the seven guarantees depend on the host's HTTP response headers.** Consequences:

- Dev-vs-prod **header** parity is _not_ a correctness factor for #217. What does matter is that the
  real **bundler/minifier** is used, so the `SANDBOX_SRCDOC` string and worker bootstrap survive a
  production build. The suite therefore runs against a real Vite build, not a hand-written page.

## 2. Test strategy — mocked LiteLLM, real everything else

LiteLLM is **mocked**. A **fixture** supplies the SSE token stream the model would have produced;
that stream contains tool-call deltas, so the frontend agent runtime **automatically invokes
`run_javascript`** with attacker-controlled `code`. This makes the otherwise non-deterministic
chat → LLM → tool-call path **fully deterministic** while exercising the **production code path
end to end**: real frontend, real plugin enablement, real `createSandboxExecutor`, real browser.

Tests run in **anonymous mode** (no GitHub login required by the frontend) and with **rate limiting
disabled**, so a run needs no secrets and never trips a quota.

This supersedes the earlier "focused harness only" idea: because the fixture's tool-call `code`
argument is arbitrary, every one of the seven adversarial snippets can be driven through the **real
`run_javascript` path**, which is strictly stronger coverage than a standalone harness. A minimal
harness page is retained only as an **optional fast lane** (see §7).

### Request flow under test

```
Playwright (Chromium)
  → app (anonymous, code-exec plugin enabled via Settings)
  → chat send
  → POST /api/models/chat            (host dev server proxies /api/* to the edge)
  → edge proxies to LITELLM_BASE_URL/v1/chat/completions
  → ▶ MOCK LiteLLM streams the fixture SSE (tool_call delta: run_javascript { code })
  → frontend agent runtime auto-invokes run_javascript
  → host PluginHost.executeSandboxedCode → createSandboxExecutor (real iframe + Worker + CSP)
  → result { ok, result, logs, timedOut, error } surfaces back into the chat turn
  → assertions (see §7)
```

Relevant wiring confirmed in the codebase:

- Edge route `EDGE_ROUTE_PATHS.modelsChat = '/api/models/chat'`
  (`packages/shared/contracts/src/edge.ts`) proxies to `${LITELLM_BASE_URL}/v1/chat/completions`
  with SSE passthrough (`apps/edge/src/routes/models.ts`).
- Host dev server proxies `/api` and `/auth/github/exchange` to the edge
  (`apps/host/src/host-server.mjs`, `edgeProxyPrefixes`).
- Anonymous tier already exists (`ANONYMOUS_IDENTITY`, `apps/edge/src/lib/litellm-user-keys.ts`).
- Inbound rate limits are env-driven and `'0'` disables a scope
  (`apps/edge/src/lib/inbound-rate-limit.ts`): set `RATE_LIMIT_*` to `0` for e2e.

### Where LiteLLM is mocked

**As built:** the suite uses Playwright route interception of the `/api/models/chat` request,
fulfilling it with the fixture SSE body (`packages/e2e/fixtures/mock-litellm.ts`). The web shell
calls the edge at a **relative** URL (`edgeBaseUrl === ''`), so the route matches regardless of port
and the run is fully hermetic — no edge, no wrangler, no auth, no network. Anonymous mode and
disabled rate limiting are therefore **intrinsic** rather than configured. The alternative (a real
edge pointed at a fake `LITELLM_BASE_URL`) would additionally exercise anonymous-tier key resolution
and the rate-limit config, but adds wrangler/miniflare to every run for no extra coverage of the
sandbox, which is entirely frontend-owned (§1). The fixture/specs are identical either way.

The mock is **content-driven**, keyed off the request's system prompt (so it is robust to call
ordering — the default agent is ReAct: decide → act → decide → synthesize):

- `You are a ReAct agent…` → first call returns an **action** decision invoking `run_javascript` with
  the adversarial `code`; once the tool result is folded into the observations (`Tool results:`), it
  returns **final** so the run ends.
- `You are a planning assistant…` → a minimal valid plan (defensive; ReAct does not plan).
- otherwise (`SYSTEM_STYLE_PROMPT`) → a short synthesized answer.

The runtime folds the `SandboxExecutionResult` back into the next request as the ReAct observation, so
the mock's captured (decoded) message text is the in-sandbox oracle — see §7.

## 3. Monorepo placement & vitest isolation

- New workspace: **`packages/e2e`** (matched by the existing `packages/*/*` glob — verify, else add
  `packages/e2e` to `pnpm-workspace.yaml`). It is tooling, not a shipped app, so it lives under
  `packages/`, not `apps/`.
- It contains: `playwright.config.ts`, the specs, the SSE **fixtures**, the **mock LiteLLM** server,
  and (optionally) the minimal harness page (§7).
- **Keep it out of vitest.** Vitest's default glob is `**/*.{test,spec}.*`; e2e specs use the
  distinct extension **`*.e2e.ts`** and the package exposes **no vitest `test` script**. Its turbo
  task is a separate **`e2e`** task (not `test`), so `turbo run test` never collects Playwright.
- `knip` must not flag the new dev deps / files — add `packages/e2e` to `config/knip.ts` coverage
  (entry = `playwright.config.ts` + `**/*.e2e.ts`). `jscpd` and `format:check` apply unchanged
  (Prettier-format all new files; Husky/lint-staged will enforce on commit).

## 4. Target build & per-run port allocation (parallel worktrees)

> **As built:** the suite targets the **production `vite preview` build of `@tinytinkerer/web`**
> (served under its Vite base `/web/`), so the minified `SANDBOX_SRCDOC` is exercised. Playwright's
> `webServer` runs `vite preview` on a **per-run port** — `E2E_PORT` when set (CI pins `43117`), else a
> random high port — with `--strictPort` and `reuseExistingServer: !CI`, so concurrent worktrees do not
> contend and never touch the host server's hardcoded 3111. The web build must exist first
> (`turbo run build --filter=@tinytinkerer/web` after the `generate:*` steps); CI and the README do this.

- Run the suite against a **real production-style build** served statically (`build:pages` output
  served via `vite preview`/a static server) **and/or** the host dev server. Header parity is not a
  #217 factor (§1), but using a real bundle ensures `SANDBOX_SRCDOC` survives minification.
- **Port collisions are a known WSL2 / parallel-worktree pain.** The host dev server hardcodes port
  **3111** and throws `EADDRINUSE` if taken (`apps/host/src/host-server.mjs` — the CLI entry reads
  no `PORT` env). Mitigations, in order of preference:
  1. Prefer the **`page.route` fast lane** (§2) + a self-contained harness/preview server that
     Playwright's `webServer` starts on a **dynamic/ephemeral port** (`port: 0`-style), so no two
     worktrees contend. This is the cleanest parallel story and avoids 3111 entirely.
  2. If the real host+edge are needed, launch them via Playwright `webServer` through a **thin
     wrapper** that calls `createHostServer({ port })` with a per-run port (no production-code change
     — `createHostServer` already accepts `port`), and pass the matching `VITE_EDGE_URL` /
     `ALLOWED_ORIGINS`. Use `reuseExistingServer: !process.env.CI`.
- Do **not** add a `minimumReleaseAgeExclude` or weaken any supply-chain gate to make ports work.

## 5. Browser matrix — phased

- **Phase 1 (in scope, done): Chromium only.** Fastest path, matches the primary deployment target,
  smallest WSL2 install. Lands #217.
- **Phase 2 (out of scope here): Firefox + WebKit.** The isolation guarantees are engine-sensitive
  (CSP-in-srcdoc, opaque-origin, blob-worker behavior differ across Blink/Gecko/WebKit), so
  cross-engine coverage is desirable — but deferred to keep the first landing small. **Out of scope
  for this suite and tracked by [#245](https://github.com/NNTin/tinytinkerer/issues/245).**

## 6. CI & supply-chain policy

Add a **dedicated `.github/workflows/e2e.yml`** job (kept separate from `turbo run test` so the
browser download is not on every test run):

```
pnpm setup:workspace                               # scriptless install + allowlisted rebuilds
pnpm exec playwright install --with-deps chromium  # explicit browser fetch (cached)
pnpm --filter @tinytinkerer/e2e e2e
```

Cache `~/.cache/ms-playwright` keyed by the pinned Playwright version.

### Supply-chain policy interactions (read carefully)

- **License:** `@playwright/test` is **Apache-2.0 → `allow`** (`scripts/license-policy.mjs`). ✅
- **`saveExact`:** pin the exact version. ✅
- **7-day age gate** (`minimumReleaseAge: 10080`): pick a `@playwright/test` release **≥ 7 days
  old**. **No `minimumReleaseAgeExclude` without a human.**
- **Install-script allowlist** (`onlyBuiltDependencies`): the repo installs scriptless
  (`--ignore-scripts`) and rebuilds only allowlisted natives. Browser binaries are fetched by the
  **explicit `playwright install` command**, _not_ an npm lifecycle script, so no allowlist entry is
  normally required. **If `pnpm check:install-scripts` flags any Playwright lifecycle script, a human
  must approve adding it to `onlyBuiltDependencies`** — do not add it unilaterally.
- **Browser binaries** are an **out-of-band, non-npm** download not covered by SBOM / age-gate /
  license tooling. This is an accepted, human-acknowledged exception of the e2e setup, in CI and
  locally.

> **As built:** `@playwright/test@1.60.0` (published 2026-05-11, clears the 7-day gate; Apache-2.0).
> The `playwright` package **does** ship a postinstall browser-download script, so `check:install-scripts`
> flags it — a human approved adding **`playwright` to `ignoredBuiltDependencies`** (blocking that
> script; browsers are fetched explicitly via `playwright install`). The out-of-band browser download
> is the acknowledged exception. `e2e.yml` caches `~/.cache/ms-playwright` keyed by the pinned version.

## 7. Assertion strategy per guarantee

`run_javascript` resolves to `SandboxExecutionResult = { ok, result?, logs, timedOut, error? }`,
which the chat turn surfaces. Each guarantee is asserted with a **dual oracle** — the **in-sandbox
result** _and_ an **external Playwright observation** — so a snippet that merely swallows its own
error cannot produce a false pass.

Each item lists: the adversarial fixture `code` → the **in-sandbox oracle** (what the returned
result must show) → the **external oracle** (what Playwright independently observes).

1. **No egress** — attempt `fetch` / `XHR` / `WebSocket` / `sendBeacon` / `EventSource` to a sentinel
   URL → each throws/rejects (surfaced error or caught-and-logged) → `page.on('request')` / route
   trap sees **zero** hits to the sentinel.
2. **No eval** — `eval('1')`, `new Function('return 1')` → both **throw** (CSP, no `'unsafe-eval'`) →
   console CSP-violation logged.
3. **Opaque origin** — touch `parent.document`, `top.location`, `localStorage`, `sessionStorage`,
   `indexedDB`, `document.cookie`, app URL → each **throws / unreachable** → no cross-origin access
   observed.
4. **Empty referrer** — attempt a (blocked) load and report any `Referer` → n/a (Worker has no
   `document.referrer`) → route trap confirms **no `Referer`** header on the attempted load.
5. **No resource loads** — `new Image().src = sentinel`; media element → load error / no effect →
   route trap sees **zero** image/media requests.
6. **Worker works** — benign `return 1 + 1` → `ok: true, result: 2` → (no external oracle needed).
7. **Timeout/teardown** — `while (true) {}` → `timedOut: true` within the 10 s budget →
   `page.locator('iframe[title="code execution sandbox"]').count()` ⇒ **0** after settle.

> **As built:** each snippet `return`s a structured object; the runtime folds it into the next model
> request, and the test asserts on the mock's **decoded** message text (the raw POST body escapes the
> quotes, so decoding is required). Refinements found while implementing:
>
> - **Egress (1):** the in-sandbox oracle is async. `fetch`/sync-`XHR` reject/throw under
>   `connect-src 'none'`, but `WebSocket`/`EventSource` fail **asynchronously** (an `error`/`close`
>   event, never `open`) and `sendBeacon`/`EventSource` are simply **absent** from Worker scope — so
>   the snippet awaits each outcome and treats "never opened / unavailable" as blocked. The external
>   oracle watches `page.on('response')` (not `request`): Chromium still emits a `request` event for a
>   CSP-blocked attempt, so only a returned **response** would prove real egress; none occurs.
> - **Opaque origin (3):** code runs in the Worker, where `document`/`localStorage`/`sessionStorage`/
>   `parent`/`top` are absent (unreachable) and `indexedDB.open()` fails at the opaque origin; the
>   Worker's own `location` is an opaque `blob:` URL, so the snippet asserts it never matches an
>   `http(s)` app origin. The security outcome (no storage/DOM/origin reach) is what #217 requires.
> - **Referrer (4):** the Worker has no `document.referrer`; verified by `hasDocument === false`, with
>   the request-header level covered by the no-egress response oracle.
> - The sentinel host is `e2e-sandbox-sentinel.invalid` (RFC 6761 non-resolvable), so nothing can
>   succeed even absent CSP.

### Optional fast lane (harness page)

A minimal Vite page exposing `window.__runSandbox(code, input)` that imports `createSandboxExecutor`
directly may be added to run the §7 snippets **without** the chat UI / mock LiteLLM. It is faster and
even more deterministic, but proves a strictly smaller surface (it skips plugin enablement + the
agent tool-call path). Treat it as a debugging/fast-feedback lane, **not** a replacement for the
mocked-LiteLLM full-flow specs.

## 8. Local / WSL2

- One-time: `pnpm --filter @tinytinkerer/e2e e2e:install` (`playwright install --with-deps chromium`;
  works headless in WSL2/Ubuntu).
- Browser binaries live in the **shared per-user** `~/.cache/ms-playwright`, so parallel worktrees
  share one download — no per-worktree duplication.
- Port collisions across worktrees are solved by the per-run-port `webServer` strategy in §4.
- **No-root fallback:** on a headless box where `--with-deps` cannot install the OS libraries
  (no sudo), download the missing libs' `.deb`s without root (`apt-get download` into a local state
  dir + `dpkg -x` into a prefix) and export `LD_LIBRARY_PATH` to that prefix before running. This is
  how the suite was verified during implementation.

## 9. Test plan checklist (as built)

- [x] `packages/e2e` workspace created; **not** collected by vitest (`*.e2e.ts`, no vitest `test`
      script); knip (`config/knip.ts` entry added), eslint, boundaries, exact-deps, prettier green.
- [x] In-page mock of `/api/models/chat` streaming a `run_javascript` tool call with arbitrary
      `code`; anonymous mode + no rate limiting (intrinsic — the edge is bypassed).
- [x] `playwright.config.ts`: Chromium project, `webServer` (`vite preview`) on a per-run port,
      `reuseExistingServer: !CI`.
- [x] One spec per guarantee in §7, each with both oracles; **all seven pass in Chromium**.
- [x] `e2e.yml` CI job with cached `playwright install`; supply-chain gates satisfied per §6; human
      authorization obtained (`playwright` → `ignoredBuiltDependencies`, `@playwright/test@1.60.0`).
- [ ] (Phase 2 — out of scope here, tracked by [#245](https://github.com/NNTin/tinytinkerer/issues/245))
      Firefox + WebKit projects.

## 10. Resolved decisions (record)

1. **Mock injection point** → **`page.route` interception** of `/api/models/chat` (hermetic; edge
   bypassed). The real-edge alternative adds no sandbox coverage. (§2)
2. **Served target** → **production `vite preview` build of `@tinytinkerer/web`** on a per-run port.
   (§4)
3. **Supply-chain** → `@playwright/test@1.60.0` (clears the 7-day gate, Apache-2.0); `playwright`
   added to `ignoredBuiltDependencies`; out-of-band browser download acknowledged. (§6)
4. **Browser matrix** → **Chromium-only** first; Firefox + WebKit are **out of scope** here and
   tracked by [#245](https://github.com/NNTin/tinytinkerer/issues/245). (§5)

## References

- Issue **#217** (parent #215), PR #216 (introduces the plugin + `createSandboxExecutor`).
- Issue **#245** — cross-browser (Firefox + WebKit) sandbox-isolation coverage (Phase 2 follow-up).
- `packages/app/app-browser/src/sandbox-executor.ts` — the isolation boundary under test.
- `docs/plugin-infrastructure.md` — "The Code execution plugin" section + documented residual risk.
- `apps/edge/src/routes/models.ts`, `packages/shared/contracts/src/edge.ts` — chat proxy + routes.
- `apps/host/src/host-server.mjs` — dev compositor + `/api` proxy + port handling.
