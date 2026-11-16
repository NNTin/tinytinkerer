# Saved progress and Resume

A run that has already done useful tool work can fail before it finishes: a model decision
times out, a cooldown is too long to wait out, the reader cancels, or the page reloads. Since
[tinytinkerer #531](https://github.com/NNTin/tinytinkerer/issues/531) the browser keeps that
work as a **checkpoint**, and the reader can continue it with an explicit **Resume**. Resume
continues the unfinished step. It does not repeat completed tool calls, and Send or Regenerate
never act as a Resume.

The checkpoint is generic. It knows tool calls, their host-stamped sources and their results.
It has no knowledge of any one app's tools, artifacts or stages.

## What is saved

`packages/app/app-browser/src/runtime/run-checkpoint.ts` defines `RunCheckpoint`, version
`RUN_CHECKPOINT_VERSION` (1). Each conversation has at most one checkpoint, for its latest
run. It is stored in the `runCheckpoints` table of the conversation database (Dexie schema 4).

| Field                      | Meaning                                                                                                                                                                                      |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `conversationId`, `turnId` | Scope. `turnId` is the id of the run's `user.message` event.                                                                                                                                 |
| `prompt`, `history`        | The run's prompt, and the conversation before it exactly as the run received it.                                                                                                             |
| `agentType`                | The strategy, from `agent.run.started`.                                                                                                                                                      |
| `invocations`              | Every call with a recorded result, in run order: `callId`, `toolId`, `input`, the **full** output or error, and the host-stamped `source`. The #532 model-facing projection is never stored. |
| `inFlight`                 | A call recorded before dispatch and not yet answered. After a reload it is **uncertain**.                                                                                                    |
| `account`, `origins`       | SHA-256 fingerprints of the credential the run used (or `anonymous`), and of each MCP server address by server id. Neither the token nor the address is stored.                              |
| `state`, `stop`, `blocked` | `running`, `stopped` (`failed`, `rate_limited`, `cancelled`, `unfinished`) or `blocked` with a reason and whether retrying can help.                                                         |
| `attempts`, timestamps     | How many times this run has been resumed, and wall-clock times. No monotonic timestamps are kept.                                                                                            |

A checkpoint is conversation state. Its outputs can contain capability-bearing references, such
as artifact ids or download URLs. They are never sent to telemetry and never copied into
reader-facing text, which names tools only.

## The write-ahead rule

The checkpointing decorator, `withRunCheckpoint` in `checkpointing-runtime.ts`, wraps the chat
runtime that `createRuntime` builds for each run. app-core's `executeChatPrompt` pulls runtime
events lazily, so the inner runtime waits at `agent.tool.started` until the decorator's commit
settles. The tool's gates and dispatch both happen after that point.

1. Before a call is dispatched, it is committed as `inFlight`, together with every result so
   far.
2. When the call's result arrives, it is moved into `invocations` and committed before the next
   decision.
3. A call is dispatched only when the stored record cannot misdescribe the run:
   - The record was written in full.
   - The run was too large to save (more than `MAX_CHECKPOINT_CHARS`, 2,000,000 serialized
     characters) and a not-resumable marker was written. Results are never truncated to fit.
   - The write failed and the old record was deleted. Nothing is offered for Resume.

   If both the write and the delete fail, the run stops **before** the call, with an `error`
   event and an answer saying that progress could not be saved. The old record is still
   accurate, because the call was never made.

Lifecycle:

- A new run (Send or Regenerate) supersedes the conversation's checkpoint.
- A run that reaches a `final` decision deletes its checkpoint.
- Every other end keeps it for Resume: a failure, a rate-limit stop, the step budget, a
  cancellation or a reload.
- Conversation delete, reset and restart remove the checkpoint together with the events.
- A checkpoint older than `CHECKPOINT_TTL_MS` (7 days) is refused as expired.

## Terminal failures

When a run fails after at least one tool call, the decorator replaces the generic `I hit an
execution issue` answer. The new answer lists the calls that completed, says that the failed
step and everything after it were not done, and says how to continue. It also states that a
successful call is not proof that its output was checked, rendered or exported. The `error`
notice and the activity stay as they are. This applies to every strategy, but Resume is offered
only for ReAct.

## Resume

The latest turn's assistant row lazily loads `run-recovery-panel.tsx`. The panel describes the
saved progress and shows **Resume**. A cancelled run with no answer gets the panel too. Clicking
Resume calls `chatStore.resumeRun(prompt, turnId)`. This goes through the same path as a send:
the per-conversation latch (a second click is a no-op while the first is in flight), the
pre-send disclosure gate and the cooldown gate. Only this action sets
`ChatRuntimeContext.resume`. Nothing resumes on its own, including after a cancellation.

Before any model request, Resume checks the checkpoint in this order and stops at the first
problem:

| Check                   | Outcome when it fails                                                                                                                                                       |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Readable, version 1     | Incompatible. The record is kept as evidence.                                                                                                                               |
| Same conversation, turn | Refused. An earlier turn's progress cannot continue a later one.                                                                                                            |
| Not blocked for good    | The stored reason.                                                                                                                                                          |
| ReAct strategy          | Refused. Hybrid and plan-execute runs have plan state that a checkpoint does not keep.                                                                                      |
| Not expired             | Expired.                                                                                                                                                                    |
| Same access             | Retryable: sign in with the original account.                                                                                                                               |
| Every saved call        | It needs a recorded source (provenance is never invented), a registered tool with the same source, and the same MCP server address. Missing or changed tools are retryable. |
| The uncertain call      | `recovery.reconcile` decides it (below). Without a reconciler, Resume is blocked.                                                                                           |
| `recovery.revalidate`   | The host's reason, for example a missing or expired artifact.                                                                                                               |
| Commit the attempt      | The checkpoint could not be saved: Resume stops.                                                                                                                            |

A refusal is saved on the checkpoint and shown as a `Resume stopped: …` notice on the turn. It
makes no model request and no tool call, and it never creates a replacement artifact. Retryable
refusals offer **Try Resume again**.

When every check passes, Resume starts a fresh ReAct run with
`RunOptions.restoredInvocations`. The run gets a new `ExecutionContext`, a new step budget and a
new `runStartedAt` anchor, so its cooldown allowance is fresh too. The restored calls are
observations only. They reach the model through `toolInvocationsToMessages`, so the #532
compact projection is recomputed from the stored full outputs and sources. `finalizeAnswer`
receives the full results. The resumed run emits no `user.message`. `buildTurns` continues the
latest turn (its new answer and notices replace the old ones), and `buildConversationHistory`
pairs the prompt with the latest answer once.

## Uncertain calls

A call that was dispatched and has no recorded result may have taken effect: the request was
sent, but the response was lost. The checkpoint never repeats it, and it never counts as safe to
repeat. A host can supply `AppRunRecovery.reconcile` to look the effect up, or to use the tool's
own idempotency protocol:

- `completed` gives the call's authoritative result, recorded with the call's original
  host-stamped source.
- `not_executed` must be proven. Resume then continues from the decision.
- `unknown`, or no reconciler, blocks Resume. The block explains why and keeps the evidence.

This also covers a lost `create`-style response that carried the only identifier of the new
artifact. Browser storage alone cannot make tool calls exactly-once across a distributed system.
That guarantee needs reconciliation or idempotency on the server side.

## Host interfaces

These are exported from `@nntin/tinytinkerer-embed` and live on `AppAssistantPolicy.recovery`:

```ts
type AppRunRecovery = {
  revalidate?: (input: {
    results: readonly AppToolResultRecord[]
    signal?: AbortSignal
  }) => Promise<AppRecoveryVerdict>
  reconcile?: (input: {
    call: AppUncertainToolCall
    results: readonly AppToolResultRecord[]
    signal?: AbortSignal
  }) => Promise<AppReconcileResult>
}
type AppRecoveryVerdict = { ok: true } | { ok: false; reason: string }
type AppUncertainToolCall = { toolId: string; input: Record<string, unknown>; source?: ToolSource }
type AppReconcileResult =
  | { status: 'completed'; output: unknown }
  | { status: 'not_executed' }
  | { status: 'unknown' }
```

The reason a host returns is shown to the reader, so it must not contain capability-bearing
references. If a hook rejects, Resume is blocked as retryable.

## Limits

- Resume is guarded within one page by the run latch. Two tabs that resume the same
  conversation at the same moment are not coordinated.
- If the delete after a completed run fails, the record stays. Resuming it continues from the
  next decision and repeats no call.
- The credential fingerprint changes when the token changes, so a fresh sign-in with the same
  account is refused as different access.
- MCP discovery carries no tool annotations, so every uncertain call is treated as a possible
  mutation.
