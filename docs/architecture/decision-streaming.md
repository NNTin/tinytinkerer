# Decision streaming lifecycle

ReAct and Hybrid consume the same `DecisionChunk` contract in `AgentRuntimeBase`.
`LiteLLMProvider` opts into `decisionStreamLifecycle: 'explicit-request-start'`; the
app-core adapter preserves this capability. Other providers retain timing from invocation.

- `request-start` carries the selected model, immediately before dispatch and after any
  provider wait. It starts response clocks once; repeated start events cannot extend them.
- `progress` carries only its source: `content`, `reasoning` or `tool_call`. Nonempty model
  text and advancing function-name/argument fragments end first-response waiting and reset
  the idle clock. SSE comments, empty deltas, role/index/id metadata, repeated complete
  function names, usage and finish markers do not. No partial JSON is carried by this event.
- `thought` retains the existing visible accumulated prose. Progress itself emits no chat
  event or repeated thought. Legacy providers can still make progress through thoughts.
- `decision` is the completed structured choice. Tools execute only after stream completion,
  complete JSON-object arguments and the registered tool's schema validation. Completed
  blank/whitespace-only arguments from gateways are normalized to `{}` for no-argument
  calls; required parameters still fail registry validation.

The streamed-decider accepts protocol completion (`[DONE]` or a successful finish reason),
not bare transport EOF. Empty/metadata-only streams, missing names, invalid/non-object JSON,
truncation and unsuccessful finish reasons fail without executing tools. Calls are assembled
by index, including fragmented names. Every offered call must be complete, including unselected siblings: a malformed sibling
fails the whole decision instead of executing any call. The first indexed call supplies
the single action, so multiple calls do not create extra side effects.
Cancellation of a valid but unfinished call does not execute it.

## Response bounds

`AgentRuntimeOptions` (also forwarded by `createChatRuntime`) has three independent budgets:

| Option                      | Default                      | Starts / resets                                   |
| --------------------------- | ---------------------------- | ------------------------------------------------- |
| `firstChunkTimeoutMs`       | `max(stepTimeoutMs, 90_000)` | Dispatch until first meaningful progress          |
| `stepTimeoutMs`             | `15_000`                     | Each meaningful response fragment after the first |
| `decisionResponseTimeoutMs` | `300_000`                    | Dispatch; never reset by progress                 |

The response ceiling covers both streamed prose and argument assembly. One scheduler uses
monotonic elapsed time to enforce the earlier of the idle/first-response and absolute deadlines. Nonpositive or
nonfinite ceiling values fall back to 300 seconds, rather than disabling the bound. Thus
healthy tool-only generation can exceed 90 seconds while continuing to make progress, but
endless fragments cannot hold a decision open indefinitely. Transport/upstream deadlines may
still terminate a request sooner. Single-shot planner/decision/execution calls retain their
existing `firstChunkTimeoutMs` whole-response budget; synthesis is unchanged.

`RuntimeTimeoutError.diagnostics` separates `cause` (`first_response`, `argument_assembly`,
`idle`, `response_ceiling`) from `lastPhase` (`request_started`, `content`, `reasoning`,
`tool_call`, `decision`), with response `elapsedMs`, the triggering `budgetMs`, and selected
`model`. Once tool-call assembly begins, an idle gap is `argument_assembly` even if the last
fragment was reasoning; a ceiling remains `response_ceiling`. The browser reports these fields explicitly as warning
telemetry tags/context. No prompt, tool name, argument fragment, result or credential is added.

## Pre-request quota cooldown

[#533](https://github.com/NNTin/tinytinkerer/issues/533) makes provider quota waiting an
explicit pre-request phase, shared by streamed and single-shot decisions and synthesis.
`LiteLLMProvider` checks its quota tracker before every model request:

- Pacing of at most one second (a nearly spent window) is slept inline. It can be aborted
  and comes before dispatch, so it starts no response clock. Streamed decisions are timed
  from `request-start`. Single-shot decisions are timed from `ProviderCallOptions.onRequestStart`,
  which explicit request-start providers call immediately before dispatch; their whole
  `firstChunkTimeoutMs` budget starts there. Legacy providers remain timed from invocation.
- A longer request-quota, token-quota or post-429 backoff wait is raised as a
  `RateLimitError` before any request. The runtime's existing cooldown handles it like a
  429: `rate.limit.waiting` (the cooldown banner), an abortable wait outside every response
  timer, then `rate.limit.recovered` and a retry. Once the deadline has passed, the retry is
  dispatched without being throttled again. Its first-response, idle and response-ceiling
  budgets start fresh at that dispatch, so a 120-second reset no longer looks like a
  90-second model timeout.
- On an upstream 429 the provider returns one effective deadline: the later of the
  upstream `retryAt` and the tracker's 1.1× amplified backoff with jitter. The runtime waits
  until exactly then, so the same window is never waited out twice. The anti-storm
  amplification and jitter stay as they were.
- Cancellation ends a wait at once, clearing its timer and listener. `edgeFetch` also
  checks the signal immediately before dispatch, so an abort or deadline that wins at that
  boundary issues no request.

Malformed or missing reset values fall back to the 60-second renewal window, and an expired
reset does not wait. Quota headers are read from synthesis responses, as before.

| Option                  | Default   | Bound                                                   |
| ----------------------- | --------- | ------------------------------------------------------- |
| `maxCooldownMs`         | `300_000` | Longest single cooldown waited before a retry           |
| `runCooldownDeadlineMs` | `900_000` | Elapsed run time by which an admitted cooldown must end |

Negative or nonfinite values fall back to the defaults. `runCooldownDeadlineMs` is anchored
once per run, when its context is created, on the monotonic clock. That single deadline is
shared by every decision attempt, retry, Hybrid sub-loop and synthesis attempt. A cooldown
is admitted only if the time the run has already spent (model and tool time included) plus
the wait it will actually perform, until the protocol `retryAt`, ends by the deadline.
Wall-clock changes cannot extend this budget. The deadline governs **cooldown admission
only**; it is not a whole-run timeout. Tools, permission/human-input waits and a synthesis
stream already running are not cut by it. Inline pacing is separate from it and still
abortable.

When a bound is exceeded, the run emits `rate.limit.cancelled` with `reason: 'too_long'`
(single wait above `maxCooldownMs`) or `'run_limit'` (would end past the run deadline). It
then neither waits nor issues a later request. Decisions stop; synthesis is also bounded and ends with
a rate-limited answer instead of making a request. A user abort reports `'cancelled'`. These
outcomes are never a `RuntimeTimeoutError`. Completed tool observations and their events
stay in the run while it waits. Persistent checkpoints and explicit resume belong to
[#531](https://github.com/NNTin/tinytinkerer/issues/531).

`packages/app/app-browser/tests/quota-cooldown.test.ts` exercises the real HTTP → SSE →
provider → adapter → ReAct/Hybrid/Plan-Execute chain with fake time. The tested mechanism
was verified independently; it is not claimed as the cause of the owner's terminal timeout.

## Sequential handoff

[#530](https://github.com/NNTin/tinytinkerer/issues/530) establishes dispatch/progress timing.
Pre-request time is excluded from these response clocks for explicit-start providers.
#533 (above) adds the quota cooldown phase on top of that contract.
Existing short 429 cooldown/retry still happens after the failed attempt's timers are cleared;
only the next dispatched request starts new response budgets.

`packages/app/app-browser/tests/decision-progress.test.ts` exercises the real HTTP SSE →
parser → LiteLLMProvider → app-core adapter → ReAct/Hybrid chain with fake time. It requires
no live model or paid API. The source-backed regression does not establish the exact trigger
of the owner's supplied terminal failure; native request timing and payloads remain unavailable.
