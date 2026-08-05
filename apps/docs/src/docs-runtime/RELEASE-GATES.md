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

## The browser matrix

Split deliberately, and named here because "which engines?" is a release
question (issue #482).

| Suite                                         | Engines                   |
| --------------------------------------------- | ------------------------- |
| `assistant-cross-engine.e2e.ts` — three flows | Chromium, Firefox, WebKit |
| everything else under `tests/docs/`           | Chromium                  |

Three flows, one per engine-sensitive property, each **asserted** rather than
cited:

| Flow                                        | Property                                                                  |
| ------------------------------------------- | ------------------------------------------------------------------------- |
| launcher → activation → disclosure → answer | the feature works at all                                                  |
| a host overlay hides and restores it        | `inert` — accessibility-tree removal, focus leaving, and keyboard return  |
| dock and undock                             | `isolation: isolate`, and the `<html>` custom property the page insets on |

An earlier revision of this section named all three properties while the suite
exercised only `inert`. That is the same overstatement #482 exists to catch, so
it is worth being explicit: what is listed is what is asserted.

The exhaustive accessibility, contrast, performance and regression specs stay on
Chromium, which is the deployment target; tripling them would buy far less than
it costs.

## Known gaps, stated rather than implied

- **Rollback is a behavioural disable, not dead-code elimination.** A
  rolled-back build is the same size and still emits the corpus and search
  index; nothing mounts or fetches them. Deliberate — see `README.md`. It is an
  emergency control, not a supported permanent configuration (#482).
- **The `assistantRuntime` budget is Chromium-only.** Measured at 2,596,180
  bytes on the one engine the byte-budget spec runs on; another engine's chunk
  set could differ. The spec prints the figure on every run, so a drift shows up
  before it is a breach. The cross-engine pair above is behavioural, not
  budgeted — deliberately, since a per-engine byte budget is three numbers
  nobody would maintain.
- **A real provider, real streaming, a real OAuth round trip and a real rate
  limit are staging-only**, by design — see the staging checklist.
- **A reader who only ever uses a live lab is no longer offered the telemetry
  opt-in**, because ownership is structural and the assistant runtime is lazy.
  Raised by #479 and **approved as-is by #482**: telemetry defaults to off, so
  "no consent host yet" collects nothing. Reintroducing first-claim ownership or
  an eager consent host was rejected — the first is the boot-order bug #479
  removed, the second costs every reader bytes for an opt-in that defaults off.
- **Live labs render light-on-any-theme while the assistant is theme-aware.**
  **Resolved by #496.** The cause was only half what this entry said. A palette
  did not reach them — but `docked-chat-surface.tsx` and `turn-activity-panel.tsx`
  also carried 69 literal `stone-*`/`white` classes between them, which no
  palette can reach, so this was never a documentation-CSS gap: it was an
  `app-browser` tokenisation gap that happened to show up here first. Both
  components now read the token graph; `ChatApp`'s stage carries `tt-app-embed`,
  so the product scopes its own surface; and the documentation's palette is keyed
  on that class, covering the assistant, the live labs and the rich-content
  playground alike. Asserted in both themes by
  `packages/e2e/tests/docs/lab-theming.e2e.ts` — contrast sweep, palette, dark
  axe, and computed-chrome parity against `/widget`.
- **`@tinytinkerer/app-shell`'s dock chrome does not follow the site theme.**
  The Pixel Agents lab's dock header, grip and move controls carry a hard-coded
  palette in `app-shell/src/styles.css` (`#eee4cf`, `#243447`, `#7a725f`) that is
  outside the token graph entirely, so it reads identically in both themes. Left
  alone by #496 deliberately: it is a fourth component with its own palette, not
  part of the conversation surface that issue is about, and its one text node is
  an `aria-hidden` decorative glyph. Visible only inside the Pixel Agents lab.
- **`/docs` Settings lists a deliberate subset of the product's plugins.**
  Resolved by #495: the empty-registry alias is gone and each documentation app
  injects its own catalogue (`plugin-subsets.ts`). The assistant carries the
  tool picker and the context gauge; the live labs add code execution. `read_dom`
  and Web search are excluded permanently, and the HITL plugins by scope —
  `__tests__/no-dom-access.test.ts` and `__tests__/no-human-prompt.test.ts` hold
  all three exclusions, against the real catalogues.
