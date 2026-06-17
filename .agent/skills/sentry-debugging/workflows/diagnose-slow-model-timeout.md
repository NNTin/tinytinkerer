# Diagnose a slow-model timeout cascade (LiteLLM / reasoning models)

A slow reasoning model — e.g. `openai/gpt-5` via the **litellm** provider — does
not fail with a 4xx/5xx. It fails by being _slow to first token_, which trips two
**different** timeouts in two projects and files two **separate** Sentry issues
for one user action. Recognise the pair before you "fix" either half.

## The signature (two issues, one prompt)

Settled in PR for `TINYTINKERER-FRONTEND-S` + `TINYTINKERER-EDGE-7`.

| Project  | Issue        | Error                                   | Culprit                                                                                 |
| -------- | ------------ | --------------------------------------- | --------------------------------------------------------------------------------------- |
| frontend | `FRONTEND-S` | `Error: ReAct decision timed out`       | `agent-runtime-base.ts` `attemptDecision`                                               |
| edge     | `EDGE-7`     | `AbortError: The operation was aborted` | `request-telemetry.ts` `fetchWithTelemetry` (via `routes/models.ts` `fetchWithTimeout`) |

They correlate by **same `model` tag** (`openai/gpt-5`), **same release SHA**, and
timestamps seconds apart (the frontend gives up first; the edge's own backstop
timeout fires a few seconds later). The edge event's `request.*` context carries
`origin: litellm`, `host: litellm.labs.lair.nntin.xyz`, `path: /v1/chat/completions`.

## Why both fire (the cascade)

1. The frontend streaming decision path arms an **idle timeout** (`stepTimeoutMs`,
   historically 15s) **before the first chunk**. A reasoning model's
   time-to-first-token exceeds that idle gap, so the timer fires before any token
   arrives → `controller.abort()` → throws `ReAct decision timed out` (FRONTEND-S,
   surfaced to the user, `source: agent-runtime`).
2. That abort cancels the frontend's fetch to the edge — but the edge route did
   **not** wire the incoming request's `signal` into its upstream fetch, so the
   edge keeps the doomed LiteLLM request alive until its **own** `fetchWithTimeout`
   backstop (historically 30s) fires → `AbortError` captured as EDGE-7
   (`failure_kind: abort`).

## The fix (both halves — fixing one alone relocates the symptom)

- **Frontend (FRONTEND-S):** separate _time-to-first-token_ from _inter-chunk
  idle_. `agent-runtime-base.ts` now has `firstChunkTimeoutMs` (default
  `max(stepTimeoutMs, 60s)`): the first `arm()` uses it; after the first chunk
  arrives (`firstChunk = false`) subsequent arms use the short `stepTimeoutMs`
  idle gap. The non-streaming `withTimeout` decision uses `firstChunkTimeoutMs`
  too (it waits for the whole one-shot response).
- **Edge (EDGE-7):** this is the **abort taxonomy** (below). The models.chat call
  site now (a) **accepts `kinds: ['abort']`** — a cancel/backstop here is expected
  control flow, mirroring the frontend `edge-fetch.ts` / `synthesize` sites that
  already accept abort; (b) wires `signal: c.req.raw.signal` so the edge stops
  hammering LiteLLM the moment the client disconnects; (c) raises the backstop to
  120s so the **frontend** first-token budget is the user-facing authority and the
  edge never aborts a healthy stream first. Keep the edge backstop > the frontend
  budget.

## Abort taxonomy (do NOT treat every edge abort the same)

An `abort` `failure_kind` on a **models.chat** edge call is not a server bug:
it is the client cancelling the in-flight stream (its step idle-timeout fired or
the user stopped the run) or our own backstop timeout. That is the **one edge
abort you accept** — it mirrors the frontend cancel-accept. An abort on a
_non-cancellable_ edge call (a fire-and-forget upstream that no client drives)
would still be signal; don't blanket-accept abort across unrelated areas.

## Gotcha: a frontend-only fix re-creates a _real_ edge timeout

Once the frontend waits up to 60s, an edge backstop still set to 30s becomes the
new bottleneck — the edge aborts a healthy stream at 30s and returns an upstream
error while the frontend is still waiting. That is why the backstop bump (30→120s)
is **part of** the FRONTEND-S fix, not separate. Whenever you lengthen a
client-side wait, check every downstream timeout it now exceeds.
