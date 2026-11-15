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

The response ceiling covers both streamed prose and argument assembly. Nonpositive or
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

## Sequential handoff

[#530](https://github.com/NNTin/tinytinkerer/issues/530) establishes dispatch/progress timing.
Pre-request time is excluded from these response clocks for explicit-start providers.
[#533](https://github.com/NNTin/tinytinkerer/issues/533) owns an abortable quota-wait lifecycle,
separate cooldown/run bounds and avoiding double waiting. This change does not add quota
states, alter existing quota policy, disable 429 recovery or impose a new whole-run bound.
Existing short 429 cooldown/retry still happens after the failed attempt's timers are cleared;
only the next dispatched request starts new response budgets.

`packages/app/app-browser/tests/decision-progress.test.ts` exercises the real HTTP SSE →
parser → LiteLLMProvider → app-core adapter → ReAct/Hybrid chain with fake time. It requires
no live model or paid API. The source-backed regression does not establish the exact trigger
of the owner's supplied terminal failure; native request timing and payloads remain unavailable.
