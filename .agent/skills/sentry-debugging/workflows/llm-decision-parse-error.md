# Workflow: LLM-output parse_error / schema_error (model non-compliance)

Goal: triage a `handled: yes` request issue whose `failure_kind` is `parse_error`
or `schema_error` and whose `request_area` *parses model output* (e.g.
`react.decide`). These are **not** request failures — the HTTP request succeeded
(`http_status: 200`); what failed is interpreting the model's free-form text as
structured JSON. That is inherent, unavoidable LLM non-compliance, and the fix is
**recover-don't-crash + accept the unavoidable kind**, not a plain `accept` and not
a try/catch that swallows. Read the **accept-or-fix guideline** in `../SKILL.md`
first.

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

## Two parses live at these call sites — only ONE is unavoidable
A model call has **two** parse steps; do not accept the wrong one:
1. **Envelope parse** — `parseJsonWithTelemetry` of the edge's OpenAI-shaped
   `{ choices: [{ message: { content } }] }`. This MUST be valid JSON; a
   `parse_error` here is a **real edge bug** → fix it, never `accept`.
2. **Decision-content parse** — the model's `content` *string* → `JSON.parse` →
   your schema. THIS is the unavoidable one. Build a **separate** metadata object
   for it carrying the `accept`, so accepting the content parse_error does not
   blind you to a malformed envelope.

## The fix (recover, then accept)
A thrown `parse_error` is fatal: it propagates through `nextDecision` (which only
catches rate-limit errors) and **kills the whole agent run**. So:

1. **Recover to a sane default instead of throwing.** Wrap the content parse and,
   on failure, fall back to the graceful no-op decision so the loop winds down
   cleanly. For the ReAct decider that is `{ kind: 'final' }` — the model emitting
   prose ("I now have enough information…") literally *means* it is done, and the
   runtime already has a `decision ?? { kind: 'final' }` fallback to mirror. The
   `final` path then synthesizes an answer from context.
2. **`accept` the `parse_error`** on the decision-content metadata — it is
   unavoidable model behaviour and now handled, so it should not be captured:
   ```ts
   accept: {
     kinds: ['parse_error'],
     reason: 'Model may stream non-decision content (prose / empty / truncated JSON); loop falls back to a final answer. Settles <ISSUE>.'
   }
   ```
3. **Keep `schema_error` CAPTURED** (do *not* add it to `kinds`). Valid JSON of the
   wrong shape can mean the model misbehaved OR *our own decision contract drifted*
   — that second case is a real bug we want surfaced. Still **recover** from it
   (fall back to `final`) so it never crashes a run, but let it report.
4. **Harden sibling call sites together** (`../SKILL.md` trap #2). The decider has a
   streaming (`streamDecision`) and a non-streaming (`decideNextAction`) sibling in
   the same file; fix BOTH or the issue relocates to the other path. A shared
   `parseDecisionOrFinal(metadata, jsonText, response)` helper keeps them identical.

## Prove it
Add call-site tests that the consumer **returns/yields the fallback decision**
(not throws) for: prose content, empty body, truncated JSON, and a valid-but-wrong
shape — e.g. `packages/app/app-browser/tests/react-decider.test.ts`. Update any
older test that asserted these *throw* (they encoded the pre-fix crash contract).

## Resolve
`update_issue(... status: "resolvedInNextRelease", reason: "Recover to final + accept parse_error at react-decider.ts (streamDecision + decideNextAction). Settles <ISSUE>.")`.
The frontend project coerces this to plain `resolved` (see `triage-issues.md` quirk)
and auto-regresses if a *non-accepted* kind (e.g. a real `schema_error`) recurs.
