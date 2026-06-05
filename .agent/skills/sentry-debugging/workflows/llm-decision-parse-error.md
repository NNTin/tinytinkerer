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

## Two parses live at these call sites — only ONE is unavoidable
A model call has **two** parse steps; do not accept the wrong one:
1. **Envelope parse** — `parseJsonWithTelemetry` of the edge's OpenAI-shaped
   `{ choices: [{ message: { content } }] }`. This MUST be valid JSON; a
   `parse_error` here is a **real edge bug** → fix it, never `accept`.
2. **Decision-content parse** — the model's `content` *string* → `JSON.parse` →
   your schema. THIS is the unavoidable one. Build a **separate** metadata object
   for it carrying the `accept`, so accepting the content parse_error does not
   blind you to a malformed envelope.

## The fix (recover, but stay loud)
A thrown `parse_error` is fatal: it propagates through `nextDecision` (which only
catches rate-limit errors) and **kills the whole agent run**. So:

0. **Parse robustly first, so you only fall back when there's truly nothing to
   recover.** Model output is frequently *sloppy-but-complete*: wrapped in prose,
   single-quoted, trailing commas, unquoted keys. Recover those instead of
   needlessly dropping to `final` (which loses the action). `parseRobustModelJson`
   (`app-browser/src/runtime/robust-json.ts`) does strict `JSON.parse` first, then
   extracts the first **balanced** object and re-parses with **JSON5**. Crucially
   it **never repairs a truncated value** (no auto-closing brackets/strings) — a
   cut-off `action` must NOT become a runnable action with a fabricated argument,
   so genuine incompleteness still throws and falls back. (Robustness ≠ guessing.)
1. **Recover to a sane default instead of throwing.** Wrap the content parse and,
   on failure, fall back to the graceful no-op decision so the loop winds down
   cleanly. For the ReAct decider that is `{ kind: 'final' }` — when the model
   finished in prose ("I now have enough information…") that is the correct
   outcome (the runtime already has a `decision ?? { kind: 'final' }` fallback to
   mirror), and the `final` path then synthesizes an answer from context. When the
   stream was *truncated*, `final` still keeps the user from a crash, but the
   answer is built from whatever tool results we had — degraded, not perfect.
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
The hard *crash* is fixed, but the underlying non-conformance is **not** — and we
deliberately keep reporting it. So do **not** mark these as cleanly fixed/accepted.
Leave a comment recording the crash fix and that capture is intentionally retained
for root-cause work, and either keep the issue `unresolved` (it is a real, open
bug) or let it auto-regress on the next occurrence. If you instead chase the root
cause (token limits / streaming cutoff / prompt tightening) and land that, resolve
against that fix.
