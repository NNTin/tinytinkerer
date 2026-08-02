# Release gates: where each #481 criterion is proved

Issue #481 asks for privacy, accessibility, performance and release gates for the
documentation assistant. Much of what its checklist enumerates was already built
and proved by #474–#480; duplicating those assertions here would have produced a
second suite that can disagree with the first.

So this is an **evidence map**. Each criterion names the test that establishes
it, whether that test is new or inherited. #482 is the independent audit and owns
whatever this map turns out to have missed.

## Privacy

| Criterion                                                  | Proved by                                                                                                                         |
| ---------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Accurate pre-send disclosure                               | `packages/e2e/tests/docs/assistant-widget.e2e.ts` — "discloses what a send does before the first one"                             |
| Nothing sent before acknowledgement                        | same test, asserted against the mocked upstream's recorded request bodies                                                         |
| Asked once, not once per message                           | same file — "asks once per reader, not once per message"                                                                          |
| Still readable afterwards                                  | same file — "keeps the disclosure available in Settings"                                                                          |
| Gate semantics (versioning, fail-closed, storage failure)  | `packages/app/app-browser/tests/pre-send-disclosure.test.ts`                                                                      |
| Resume-after-acknowledge, dismiss-keeps-text               | `packages/app/app-browser/tests/chat-composer.test.tsx` — "pre-send disclosure gate"                                              |
| Visiting or opening sends no source content                | `packages/e2e/tests/docs/assistant-performance.e2e.ts` profiles 1 and 2 (no corpus body, no index)                                |
| Source Markdown only, never the DOM                        | inherited: `docs-corpus/__tests__/*`, `docs-tools/__tests__/source-rules.test.ts`, `docs-runtime/__tests__/static-safety.test.ts` |
| Unlisted pages excluded from search, readable when visited | inherited: `docs-search/__tests__/search-documentation.test.ts`; route coverage added to `assistant-widget.e2e.ts`'s `ROUTES`     |
| Separate assistant / live-lab / product storage and reset  | inherited: `docs-runtime/__tests__/session.test.tsx`, `packages/app/app-browser/tests/document-globals-multi-app.test.ts`         |
| Anonymous quota, login handoff                             | `docs-runtime/__tests__/product-sign-in.test.ts`; the real round trip is staging-only (see below)                                 |

## Accessibility

| Criterion                                       | Proved by                                                                              |
| ----------------------------------------------- | -------------------------------------------------------------------------------------- |
| Launcher, panel, tool picker, consent, privacy  | inherited: `assistant-widget.e2e.ts` — axe over `.docs-assistant-root`, light and dark |
| Contrast on every embedded surface              | inherited: same file's `worstContrastIn` sweep                                         |
| Focus restoration, keyboard operation           | inherited: same file — "the launcher and panel controls are keyboard operable"         |
| Pre-send disclosure: announced, keyboard, focus | `accessibility.e2e.ts` — "the pre-send disclosure is announced…"                       |
| Sign-in: accessible name, announced unavailable | `accessibility.e2e.ts` — "the assistant sign-in affordance…"                           |
| Idle launcher on ordinary content pages         | inherited: `accessibility.e2e.ts`'s `CONTENT_PAGE_URLS` scans, which include it        |

## Performance

| Criterion                               | Proved by                                                                |
| --------------------------------------- | ------------------------------------------------------------------------ |
| No runtime chunk on any built page      | inherited: `scripts/check-docs-performance-budget.mjs`, eager-chunk half |
| No eager import at the source level     | inherited: `docs-runtime/__tests__/static-safety.test.ts`                |
| Four load profiles, explicit budgets    | `config/docs-performance-budget.json`                                    |
| Profiles 1, 3, 4 weighed                | `scripts/check-docs-performance-budget.mjs`, byte-budget half            |
| Fetch **sequencing** for all four       | `packages/e2e/tests/docs/assistant-performance.e2e.ts`                   |
| The returning-open profile #480 created | same file — "a returning reader with the panel open…"                    |
| Production search index exists          | budget script (`No search-index.json` failure) and perf profile 4        |

## Release operations

| Criterion                                       | Proved by                                                                        |
| ----------------------------------------------- | -------------------------------------------------------------------------------- |
| CI consumes no shared or user quota             | `packages/e2e/fixtures/no-live-quota.ts`, installed from `playwright.config.ts`  |
| Documented staging smoke                        | `docs/contributing/staging-smoke-checklist.md`                                   |
| Rollback without breaking live labs             | `apps/docs/src/theme/__tests__/Root.test.tsx` — "with the assistant rolled back" |
| Rollback switch parsing (fail-safe defaults)    | `apps/docs/tests/site-config.test.ts`                                            |
| Private-worker upgrade validation documented    | inherited: `docs-search/README.md`'s upgrade checklist                           |
| Private-worker compatibility check              | inherited: `docs-search/__tests__/private-worker-contract.test.ts`               |
| Deterministic build / static rendering          | inherited: `docs-corpus/__tests__/validate-corpus.test.ts`, corpus `postBuild`   |
| Maintainer documentation matches implementation | `README.md` beside this file                                                     |

## Known gaps, stated rather than implied

- **The `assistantRuntime` budget is Chromium-only.** Measured at 2,596,180
  bytes on the one engine the docs specs run on; another engine's chunk set could
  differ. The spec prints the figure on every run, so a drift shows up before it
  is a breach.
- **A real provider, real streaming, a real OAuth round trip and a real rate
  limit are staging-only**, by design — see the staging checklist.
- **A reader who only ever uses a live lab is no longer offered the telemetry
  opt-in**, because ownership is structural and the assistant runtime is lazy.
  Recorded by #479, deliberately left to #482: telemetry stays off, so this is
  conservative rather than a collection change.
