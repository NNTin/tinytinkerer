# End-to-End Testing (Playwright) — Architecture & Plan

> Status: **PLAN / not yet implemented.** This document is the agreed design for the
> Playwright e2e suite. It is the contract that the implementation must follow and be
> verified against. First target: GitHub issue **#217** — real-browser verification of the
> code-exec sandbox isolation guarantees that jsdom cannot cover.

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

### Where LiteLLM is mocked — decision

Primary: **mock the LiteLLM upstream** by pointing the edge's `LITELLM_BASE_URL` at a tiny local
fake server that streams the fixture. This keeps the **real edge** in the loop (so anonymous-tier
key resolution and the rate-limit config are genuinely exercised) and is the literal reading of
"LiteLLM is mocked."

Fallback / fast lane: **Playwright `page.route('**/api/models/chat')`** fulfilling the request with
the fixture SSE body. This bypasses the edge entirely (anonymous + no-rate-limit become trivially
true) and removes the need to run wrangler/miniflare. Use this if standing up the edge in CI proves
flaky; it still exercises the full **frontend** path that owns the sandbox.

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

- **Phase 1: Chromium only.** Fastest path, matches the primary deployment target, smallest WSL2
  install. Lands #217.
- **Phase 2: add Firefox + WebKit.** The isolation guarantees are engine-sensitive (CSP-in-srcdoc,
  opaque-origin, blob-worker behavior differ across Blink/Gecko/WebKit), so cross-engine coverage is
  desirable — but deferred to keep the first landing small. Track it; the spec notes the guarantees
  are engine-sensitive so it is not forgotten.

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

> ⚠️ **Human authorization required before implementation:** (a) the pinned `@playwright/test`
> version must clear the 7-day gate; (b) acknowledge the out-of-band browser download; (c) approve
> any install-script allowlist entry _only if_ `check:install-scripts` flags one.

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

Cross-cutting oracle: subscribe to `securitypolicyviolation` events / console CSP errors as
corroboration for the blocks (1, 2, 5).

> Note on guarantee #4: the user code runs in a **Worker**, which has no `document.referrer`; the
> referrer guarantee is therefore observed at the **request-header** level (no `Referer` on any
> attempted load), not by reading `document.referrer` from inside the Worker.

### Optional fast lane (harness page)

A minimal Vite page exposing `window.__runSandbox(code, input)` that imports `createSandboxExecutor`
directly may be added to run the §7 snippets **without** the chat UI / mock LiteLLM. It is faster and
even more deterministic, but proves a strictly smaller surface (it skips plugin enablement + the
agent tool-call path). Treat it as a debugging/fast-feedback lane, **not** a replacement for the
mocked-LiteLLM full-flow specs.

## 8. Local / WSL2

- One-time: `pnpm exec playwright install --with-deps chromium` (works headless in WSL2/Ubuntu).
- Browser binaries live in the **shared per-user** `~/.cache/ms-playwright`, so parallel worktrees
  share one download — no per-worktree duplication.
- Port collisions across worktrees are solved by the dynamic-port `webServer` strategy in §4.

## 9. Test plan checklist (for the implementation PR to satisfy)

- [ ] `packages/e2e` workspace created; **not** collected by vitest (`*.e2e.ts`, no vitest `test`
      script, separate turbo `e2e` task); knip/jscpd/prettier green.
- [ ] Mock LiteLLM server + SSE token fixtures that emit a `run_javascript` tool call with arbitrary
      `code`; anonymous mode; `RATE_LIMIT_*=0`.
- [ ] `playwright.config.ts`: Chromium project, `webServer` on a **dynamic port**,
      `reuseExistingServer: !CI`.
- [ ] One spec per guarantee in §7, each with both oracles; all seven passing in Chromium.
- [ ] `e2e.yml` CI job with cached `playwright install`; supply-chain gates (license/age/exact/
      install-scripts) satisfied per §6; human authorizations obtained.
- [ ] (Phase 2, follow-up) Firefox + WebKit projects.

## 10. Open items needing a human decision before/while implementing

1. **Mock injection point** — real edge with mocked `LITELLM_BASE_URL` (primary, faithful to
   "LiteLLM is mocked") vs `page.route` interception of `/api/models/chat` (fast lane, edge
   bypassed). _Recommendation: start with whichever stands up green fastest in CI; the specs and
   fixtures are identical either way since both stream the same SSE._
2. **Served target** — `build:pages` static preview vs host dev server. _Recommendation: static
   preview on a dynamic port for hermeticity + worktree-safety._
3. **Supply-chain authorizations** — confirm the pinned `@playwright/test` clears the 7-day gate,
   acknowledge the out-of-band browser download, and approve an install-script allowlist entry only
   if `check:install-scripts` flags one (§6).
4. **Browser matrix timing** — confirm Chromium-only for the first PR, cross-browser as a follow-up.

## References

- Issue **#217** (parent #215), PR #216 (introduces the plugin + `createSandboxExecutor`).
- `packages/app/app-browser/src/sandbox-executor.ts` — the isolation boundary under test.
- `docs/plugin-infrastructure.md` — "The Code execution plugin" section + documented residual risk.
- `apps/edge/src/routes/models.ts`, `packages/shared/contracts/src/edge.ts` — chat proxy + routes.
- `apps/host/src/host-server.mjs` — dev compositor + `/api` proxy + port handling.
</content>
</invoke>
