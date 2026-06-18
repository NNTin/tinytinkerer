# Workflow: LLM-output parse_error / schema_error (model non-compliance)

Goal: triage a `handled: yes` request issue whose `failure_kind` is `parse_error`
or `schema_error` and whose `request_area` _parses model output_ (e.g.
`react.decide`). These are **not** request failures — the HTTP request succeeded
(`http_status: 200`); what failed is interpreting the model's free-form text as
structured JSON.

The fix is **recover-don't-crash; stay loud for the lossy cases, silent for a
clean prose finish — and never `accept`.** Model non-compliance comes in two
distinct flavours and they are NOT the same defect:

- A **truncated/malformed** decision (a JSON value _was_ present but cut off
  mid-action, or a valid value of the wrong shape) means we abandoned the tool
  call the model was emitting and answered from **incomplete tool results** — a
  real defect. **Keep capturing it (stay loud).**
- A **pure-prose finish** (the model emitted _no_ JSON value at all) is the model
  correctly deciding it is _done_ — the expected `final` outcome, not a bug.
  Capturing it just generates recurring noise that **auto-regresses the issue**
  every time the model answers in prose (this is exactly what reopened
  `FRONTEND-K`). **Recover it silently (no capture).**

You _can_ tell them apart at parse time: pure prose has no JSON opener (`{`/`[`),
truncation has one that never balances. So this is **not** an `accept` (that would
suppress _all_ outcomes, including the lossy ones) — it is a narrow, per-call-site
distinction. Read the **accept-or-fix guideline** in `../SKILL.md` first — the
answer here is _fix/recover_, never _accept_.

Settled `TINYTINKERER-FRONTEND-J` (truncated/malformed decision JSON —
`Unterminated string` / `Expected property name`) and `TINYTINKERER-FRONTEND-K`
(model answered in prose: `"I now have"... is not valid JSON`, later
`No complete JSON value found in model output`). Both `react.decide`,
`handled: yes`, `http_status: 200`, stacktrace ending in `JSON.parse` /
`extractBalancedJson` under `parseWithTelemetry` in `react-decider.ts`.

> **`FRONTEND-K` regression (release `8fbd56a`) — the prose-vs-truncation split.**
> After the recover-to-`final` fix shipped, `-K` kept auto-regressing: every time
> the model finished a step in _prose_ (no JSON at all) the decider recovered
> correctly **but still captured** a `parse_error`, so Sentry reopened the issue
> on each new release. Root cause: a pure-prose finish is the _expected_ `final`
> outcome, not a defect — capturing it was pure noise. Fix: the decider now passes
> `silentWhenNoJson: true` to `parseModelJsonWithTelemetry`, which recovers a
> no-JSON response **silently** (a benign `no_json` `ModelJsonError`, no capture)
> while truncation/malformed/wrong-shape responses still capture. The planner
> leaves the option off (a planner answering in prose IS a defect).

## Recognize it

- `failure_kind: parse_error` (model text isn't valid JSON: prose, empty, or
  truncated/cut-off stream) **or** `schema_error` (valid JSON, wrong shape).
- `http_status: 200` — the upstream/edge call was fine; the _content_ didn't
  conform. A 4xx/5xx here would be a different problem (see `triage-issues.md`).
- `request_area` is a model-output parse site (`react.decide`; future planner /
  synthesize areas behave the same), and the stacktrace bottoms out in
  `JSON.parse` or a zod `.parse` wrapped by `parseWithTelemetry`.
- `develop` is a **live production tier** — a `develop`-only parse error is a real
  production bug, not pre-production noise. A `pr-preview`-only error is
  PR-specific and lower priority but still real signal. Only `development`
  (localhost) is noise (see `triage-by-environment.md`).

## Planner parse failures create TWO Sentry issues — treat them as one incident

A **planner** (`planning.chat`, `mcp-planner.ts`) parse failure creates **two
separate Sentry issues** from the same request, because the inner error and the
outer `ModelJsonError` are each captured by a different handler:

1. **Inner `SyntaxError`** — `parseWithTelemetry` (`model-json.ts:192`) captures
   the raw parse exception inline and re-throws it. This is captured immediately
   with `failure_kind: parse_error` and `handled: yes`. Stacktrace bottoms out in
   `model-json.ts:76` (`parseRobustModelJson`) or `model-json.ts:78`
   (`JSON5.parse`).
2. **Outer `ModelJsonError`** — the `catch` at `model-json.ts:200` wraps the
   `SyntaxError` and re-throws a `ModelJsonError`. The planner re-throws it (no
   safe prose fallback), and it propagates up through `github-models-provider.ts`
   → `hybrid-runtime.ts` → `chat.ts` → `chat-store.ts`, where the top-level
   handler captures it as a second, separate Sentry issue with title
   `ModelJsonError: Planning response body was not valid JSON`.

**Identification**: both issues share the same `trace_id`, near-identical
timestamps (within ~10 ms), the same user, and the same `request_area`. When you
see a `ModelJsonError: Planning response body was not valid JSON` issue, look for a
sibling `SyntaxError` (no JSON value, or JSON5 parse error) with the same trace —
they are **one incident**, not two.

**Contrast with the ReAct decider**: `react.decide` creates only **one** Sentry
issue (the inner `SyntaxError` from `parseWithTelemetry`). `parseDecisionOrFinal`
catches the outer `ModelJsonError` and recovers to `{ kind: 'final' }` — the
`ModelJsonError` never escapes to the chat-store handler, so no second issue is
created.

**Triage action**: resolve them **together** with the same reason; they are not
two bugs, they are one failure viewed through two capture points.

## Two parses live at these call sites — keep them distinct

A model call has **two** parse steps; harden only the right one:

1. **Envelope parse** — `parseJsonWithTelemetry` of the edge's OpenAI-shaped
   `{ choices: [{ message: { content } }] }`. This MUST be valid JSON; a
   `parse_error` here is a **real edge bug** → fix it. Do NOT make it lenient.
2. **Decision-content parse** — the model's `content` _string_ → robust JSON →
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
   recover.** Model output is frequently _sloppy-but-complete_: wrapped in prose,
   single-quoted, trailing commas, unquoted keys. Recover those instead of
   needlessly dropping to `final` (which loses the action). The shared
   `parseModelJsonWithTelemetry` helper (`@tinytinkerer/sentry-telemetry`,
   `src/model-json.ts`) folds the whole boilerplate into one call — strip ` ```json `
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
1. **Recover _or surface_, but never throw uncaught — and the choice differs by
   call site, on purpose.** `parseModelJsonWithTelemetry` is policy-free: it
   returns the value or throws a `ModelJsonError`. Each caller owns its fallback:
   - **ReAct decider** (`react-decider.ts`) — **recover to `{ kind: 'final' }`**,
     and pass **`silentWhenNoJson: true`** to `parseModelJsonWithTelemetry`. When
     the model finished in _pure prose_ ("I now have enough information…", no JSON
     opener) that is the correct `final` outcome (the runtime mirrors it with
     `decision ?? { kind: 'final' }`) — so it recovers **silently** (a benign
     `no_json` `ModelJsonError`, **not captured**; this is the `FRONTEND-K`
     regression fix). When the stream was _truncated/malformed_ (a JSON value was
     present but cut off / wrong shape), `final` still keeps the user from a crash
     but the answer is built from incomplete tool results — degraded, and **still
     captured** (stays loud).
   - **Planner** (`mcp-planner.ts`) — **surface the error** to the run-error path
     (`handleRunError`); do NOT degrade to the heuristic `inferPlan`, and do **not**
     pass `silentWhenNoJson` (a planner answering in prose is itself a defect). A
     wrong/guessed plan is worse than a clear failure. `GitHubModelsProvider.plan`
     re-throws a `ModelJsonError` (only transport/network failures still fall
     through to the heuristic, since there we never got model output to misread).
2. **Do NOT `accept` — keep capturing the _lossy_ cases (`parse_error` from a
   truncated/malformed value, and `schema_error`).** Recovering does not make those
   expected: the truncated case dropped an in-flight tool action and produced an
   _incomplete_ answer, and a `schema_error` can mean _our own decision contract
   drifted_. Both are real bugs to investigate, so they stay visible. The **only**
   silenced case is a clean **pure-prose finish** (`no_json` — no JSON value at
   all), which is the model's correct `final` and pure noise to capture. `accept`
   would suppress _everything_ including the lossy cases — that is why this is a
   narrow `silentWhenNoJson`, not an `accept` block. Recover for the user always;
   stay loud for the lossy cases, silent for the prose finish.
3. **Harden sibling call sites together** (`../SKILL.md` trap #2). The decider has a
   streaming (`streamDecision`) and a non-streaming (`decideNextAction`) sibling in
   the same file; fix BOTH or the issue relocates to the other path. A shared
   `parseDecisionOrFinal(metadata, jsonText, response)` helper keeps them identical.

4. **Enrich the capture with the OFFENDING SHAPE so a `schema_error` is
   self-diagnosable (`FRONTEND-12`).** A bare `ZodError` only says what we
   _expected_ ("invalid*type, expected object, path []") — never what the model
   actually produced, so you can't tell whether it returned an array, a string, or
   an object missing a field. The `parse_error` path already passes the raw model
   text as `rawInput` (→ `failure.raw_input` Sentry context, truncated to 1 KB);
   the `schema_error` path historically omitted it. `parseModelJsonWithTelemetry`
   now passes a compact `[<type>] <JSON.stringify(parsed)>` descriptor (the exact
   parsed value that failed validation, type-tagged so the common wrong-top-level
   mismatch is obvious even after truncation; falls back to the raw text if it
   can't serialize) — see `describeOffendingShape` in `model-json.ts`. **This is
   enrichment, not a fix:** a model-output `schema_error` stays loud and is \_not*
   resolved unless you actually change the contract/prompt; the richer telemetry
   just makes the next occurrence diagnosable (this is the "can't fix now → make
   telemetry richer at the capture site" policy applied to a model-output defect).

## Prove it

Add call-site tests, in `packages/app/app-browser/tests/react-decider.test.ts`,
that for prose content, empty body, truncated JSON, and a valid-but-wrong shape the
consumer **returns/yields the fallback `final` decision** (not throws). Update any
older test that asserted these _throw_ (they encoded the pre-fix crash contract).
**Also assert the loud/silent split** (register a spy via `setCaptureExceptionSink`):

- On a **truncated** decision (and a wrong-shape one): the sink is **still called**
  (`failure_kind: parse_error` / `schema_error`, `request_area: react.decide`) —
  locks in "recover but don't suppress" so nobody re-adds an `accept`.
- On a **pure-prose finish** (no JSON at all): the sink is **NOT called** — locks
  in the `FRONTEND-K` regression fix so nobody re-captures the benign prose finish.
  Add matching unit tests for the helper itself in
  `packages/shared/sentry-telemetry/tests/model-json.test.ts`: with `silentWhenNoJson`,
  prose → `no_json` thrown + no capture; truncated → `parse_error` captured;
  wrong-shape → `schema_error` captured.

## Resolve

Mark the issue **`resolvedInNextRelease`** with a `reason` naming the fix (the
crash is gone, sloppy-but-complete decisions are recovered, and the residual
truncation/prose cases degrade gracefully to `final`). Keep these two axes
separate — they are **not** in tension:

- **Code:** still capture (no `accept`) — _stay loud_.
- **Status:** `resolvedInNextRelease` — _acknowledge the fix shipped_.

Because we keep emitting events, Sentry **auto-regresses** (reopens + escalates)
the issue if the residual cases recur on the new release — so the signal is not
lost, it just resurfaces louder if reality disagrees with the fix. That is
cleaner than leaving it permanently `unresolved`. (Frontend coerces
`resolvedInNextRelease` → plain `resolved`; it still auto-regresses — see the
`triage-issues.md` quirk.) If those residual cases _do_ keep firing post-deploy,
chase the root cause (token limits / streaming cutoff / prompt tightening / a
JSON/response-format constraint) and resolve against that fix.
