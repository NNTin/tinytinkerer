# Workflow: LLM-output parse_error / schema_error (model non-compliance)

Goal: triage a `handled: yes` request issue whose `failure_kind` is `parse_error`
or `schema_error` and whose `request_area` *parses model output* (e.g.
`react.decide`). These are **not** request failures — the HTTP request succeeded
(`http_status: 200`); what failed is interpreting the model's free-form text as
structured JSON.

The fix is **recover-don't-crash, but stay loud — do NOT `accept`.** It is
tempting to call model non-compliance "normal & unavoidable" and suppress it, but
that **hides a real defect**: a *truncated* decision means the stream was cut off
mid-action, so we abandon the tool call the model was emitting and answer from
**incomplete tool results**. You cannot reliably tell that lossy case apart from a
clean "model finished in prose" at parse time, so the safe, honest rule is to keep
capturing every failure while still recovering for the user. Read the
**accept-or-fix guideline** in `../SKILL.md` first — this is a case where the
answer is *fix/recover*, not *accept*.

Settled `TINYTINKERER-FRONTEND-J` (truncated/malformed decision JSON —
`Unterminated string` / `Expected property name`) and `TINYTINKERER-FRONTEND-K`
(model answered in prose: `"I now have"... is not valid JSON`). Both
`react.decide`, `handled: yes`, `http_status: 200`, stacktrace ending in
`JSON.parse` under `parseWithTelemetry` in `react-decider.ts`.

## Recognize it
- `failure_kind: parse_error` (model text isn't valid JSON: prose, empty, or
  truncated/cut-off stream) **or** `schema_error` (valid JSON, wrong shape).
- `http_status: 200` — the upstream/edge call was fine; the *content* didn't
  conform. A 4xx/5xx here would be a different problem (see `triage-issues.md`).
- `request_area` is a model-output parse site (`react.decide`; future planner /
  synthesize areas behave the same), and the stacktrace bottoms out in
  `JSON.parse` or a zod `.parse` wrapped by `parseWithTelemetry`.
- Often `pr-preview`/`develop` only at first (a dev exercising a PR) — but it is a
  real robustness gap that **will** reach production, so fix it, don't dismiss it
  as env noise (contrast: a `development`/localhost crash *is* noise; see
  `triage-by-environment.md`).

## Two parses live at these call sites — keep them distinct
A model call has **two** parse steps; harden only the right one:
1. **Envelope parse** — `parseJsonWithTelemetry` of the edge's OpenAI-shaped
   `{ choices: [{ message: { content } }] }`. This MUST be valid JSON; a
   `parse_error` here is a **real edge bug** → fix it. Do NOT make it lenient.
2. **Decision-content parse** — the model's `content` *string* → robust JSON →
   your schema. THIS is the unavoidable one: route it through the shared
   `parseModelJsonWithTelemetry` helper (`@tinytinkerer/sentry-telemetry`), on its
   **own** metadata, so the leniency never weakens the strict envelope check above.
   The decider then recovers-to-`final`; the planner surfaces the error (see
   "The fix" below). (Earlier drafts said to `accept` the content parse_error on
   this metadata — that is **wrong**: we recover/surface but keep capturing, never
   `accept`.)

## The fix (recover, but stay loud)
A thrown `parse_error` is fatal: it propagates through `nextDecision` (which only
catches rate-limit errors) and **kills the whole agent run**. So:

0. **Parse robustly first, so you only fall back when there's truly nothing to
   recover.** Model output is frequently *sloppy-but-complete*: wrapped in prose,
   single-quoted, trailing commas, unquoted keys. Recover those instead of
   needlessly dropping to `final` (which loses the action). The shared
   `parseModelJsonWithTelemetry` helper (`@tinytinkerer/sentry-telemetry`,
   `src/model-json.ts`) folds the whole boilerplate into one call — strip ```` ```json ````
   fences → `parseRobustModelJson` (strict `JSON.parse`, else first **balanced**
   object re-parsed with **JSON5**) → `zod` schema → telemetry. Crucially it
   **never repairs a truncated value** (no auto-closing brackets/strings) — a
   cut-off `action` must NOT become a runnable action with a fabricated argument,
   so genuine incompleteness still throws and falls back. (Robustness ≠ guessing.)
   > **Use the shared helper everywhere — don't hand-roll a parse.** An ESLint
   > rule (`no-restricted-properties` on `JSON.parse`, scoped to
   > `**/runtime/*-decider.ts` / `**/runtime/*-planner.ts` in `eslint.config.mjs`)
   > fails the build if a model decision/planner path raw-`JSON.parse`s model
   > output. Envelope / tool-result / storage parsers stay on strict `JSON.parse`
   > and are intentionally out of scope. (Adopted in issue #139; origin PR #138.)
1. **Recover *or surface*, but never throw uncaught — and the choice differs by
   call site, on purpose.** `parseModelJsonWithTelemetry` is policy-free: it
   returns the value or throws a `ModelJsonError`. Each caller owns its fallback:
   - **ReAct decider** (`react-decider.ts`) — **recover to `{ kind: 'final' }`**.
     When the model finished in prose ("I now have enough information…") that is
     the correct outcome (the runtime already has a `decision ?? { kind: 'final' }`
     fallback to mirror), and the `final` path then synthesizes an answer from
     context. When the stream was *truncated*, `final` still keeps the user from a
     crash, but the answer is built from whatever tool results we had — degraded,
     not perfect.
   - **Planner** (`mcp-planner.ts`) — **surface the error** to the run-error path
     (`handleRunError`); do NOT degrade to the heuristic `inferPlan`. A
     wrong/guessed plan is worse than a clear failure. `GitHubModelsProvider.plan`
     re-throws a `ModelJsonError` (only transport/network failures still fall
     through to the heuristic, since there we never got model output to misread).
2. **Do NOT `accept` the failure — keep capturing both `parse_error` and
   `schema_error`.** Recovering does not make the failure expected: the truncated
   case dropped an in-flight tool action and produced an *incomplete* answer, and
   a `schema_error` can mean *our own decision contract drifted*. Both are real
   bugs to investigate (why is the decision stream truncating / the model not
   conforming?), so they must stay visible. Recover for the user; stay loud for us.
   No `accept` block on the decision-content metadata.
3. **Harden sibling call sites together** (`../SKILL.md` trap #2). The decider has a
   streaming (`streamDecision`) and a non-streaming (`decideNextAction`) sibling in
   the same file; fix BOTH or the issue relocates to the other path. A shared
   `parseDecisionOrFinal(metadata, jsonText, response)` helper keeps them identical.

## Prove it
Add call-site tests, in `packages/app/app-browser/tests/react-decider.test.ts`,
that for prose content, empty body, truncated JSON, and a valid-but-wrong shape the
consumer **returns/yields the fallback `final` decision** (not throws). Update any
older test that asserted these *throw* (they encoded the pre-fix crash contract).
**Also assert it stays loud:** register a spy via `setCaptureExceptionSink` and
check the capture sink is **still called** (with `failure_kind: parse_error`,
`request_area: react.decide`) on a truncated decision — this locks in "recover but
don't suppress" so nobody silently re-adds an `accept`.

## Resolve
Mark the issue **`resolvedInNextRelease`** with a `reason` naming the fix (the
crash is gone, sloppy-but-complete decisions are recovered, and the residual
truncation/prose cases degrade gracefully to `final`). Keep these two axes
separate — they are **not** in tension:
- **Code:** still capture (no `accept`) — *stay loud*.
- **Status:** `resolvedInNextRelease` — *acknowledge the fix shipped*.

Because we keep emitting events, Sentry **auto-regresses** (reopens + escalates)
the issue if the residual cases recur on the new release — so the signal is not
lost, it just resurfaces louder if reality disagrees with the fix. That is
cleaner than leaving it permanently `unresolved`. (Frontend coerces
`resolvedInNextRelease` → plain `resolved`; it still auto-regresses — see the
`triage-issues.md` quirk.) If those residual cases *do* keep firing post-deploy,
chase the root cause (token limits / streaming cutoff / prompt tightening / a
JSON/response-format constraint) and resolve against that fix.
