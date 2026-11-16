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
| `owner`                    | Fencing token of the run attempt that owns the record. Every write compares it (see below).                                                                                                  |

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

## Ownership across tabs

`RunCheckpointStore` writes only by compare-and-swap. `swap(record, expectedOwner)` and
`delete(conversationId, expectedOwner)` each run in one IndexedDB read-write transaction, which
the browser serializes across every connection to the database, including other tabs and
windows. Each run attempt has its own `owner` token. Its first write expects no record (or the
record a Send just superseded), and every later write expects its own token.

- A Resume claims the record by swapping the stored owner for a new one before any request. Of
  two tabs that resume the same progress at the same moment, exactly one claim succeeds. The
  other is refused with "already being resumed in another tab or window" and makes no request.
- A run whose record was claimed elsewhere fails its next compare-and-swap. It stops before its
  next tool call and says that its progress now belongs to the run in the other tab. It writes
  nothing more.
- A refusal records its reason against the loaded owner without claiming the record.

There is no lease. A tab that closes or reloads leaves no lock behind, so its progress can be
resumed at once, and its unanswered call is uncertain.

Lifecycle:

- A new run (Send or Regenerate) supersedes the conversation's checkpoint.
- A run that reaches a `final` decision deletes its checkpoint. That cleanup can fail, so before
  anything else, Resume (and the panel) read the conversation's persisted events. If the turn's
  latest run reached a `final` decision and its answer, with no error or rate-limit stop after
  it, the run is finished. Resume then refuses ("already finished"), removes the stale record
  and makes no request. A refused Resume adds no step or tool activity, so it does not count as
  a new run.
- Every other end keeps it for Resume: a failure, a rate-limit stop, the step budget, a
  cancellation or a reload.
- Conversation delete, reset and restart remove the checkpoint together with the events.
- A checkpoint more than `CHECKPOINT_TTL_MS` (7 days) past its `createdAt` is refused as expired. Later writes (attempts, refusals, stops) never extend it.

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

| Check                    | Outcome when it fails                                                                                                                                                       |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Readable, version 1      | Incompatible. The record is kept as evidence.                                                                                                                               |
| Run not already finished | Refused, from the persisted events. The stale record is removed.                                                                                                            |
| Same conversation, turn  | Refused. An earlier turn's progress cannot continue a later one.                                                                                                            |
| Not blocked for good     | The stored reason.                                                                                                                                                          |
| ReAct strategy           | Refused. Hybrid and plan-execute runs have plan state that a checkpoint does not keep.                                                                                      |
| Not expired              | Expired.                                                                                                                                                                    |
| Same access              | Retryable, but only the original credential can match (see Limits).                                                                                                         |
| Every saved call         | It needs a recorded source (provenance is never invented), a registered tool with the same source, and the same MCP server address. Missing or changed tools are retryable. |
| The uncertain call       | `recovery.reconcile` decides it (below). Without a reconciler, Resume is blocked.                                                                                           |
| `recovery.revalidate`    | The host's reason, for example a missing or expired artifact.                                                                                                               |
| Claim the attempt        | Compare-and-swap of the owner. Another tab claimed it first, or the record could not be saved: Resume stops.                                                                |

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

- Ownership is a fencing token, not a lease, so a live run in one tab can be claimed by a Resume
  in another. The claimed run then stops before its next call. At most one of them can dispatch
  calls from the record.
- Access is compared by credential. The app has no refresh tokens: a GitHub OAuth token lasts
  until it is revoked or replaced by a new sign-in. The only client-side identity is a network
  probe of GitHub's `/user`, which gives a login that can be renamed and is cached per token.
  It is no stable account id. So a fresh sign-in issues a new token, even for the same account,
  and is refused as different access. Only the original credential can match, for example a
  host-provided token that is restored. Accounts and servers stay isolated either way.
- MCP discovery carries no tool annotations, so every uncertain call is treated as a possible
  mutation.
