<!--
This document reflects the current implementation of the multi-app harness.
If changes affecting the harness/bridge are made, update this file.
Do NOT delete above lines.
-->

# Multi-app harness

TinyTinkerer is a multi-app harness: the chat assistant is the through-line, and each "app" is an embedded third-party application rendered in a **sandboxed iframe** that the assistant drives over a shared, versioned, Zod-typed `postMessage` protocol. Excalidraw is the first app; adding the next is "new iframe app page + thin harness shell + declare its verbs," not a bespoke integration.

## Pieces

| Piece           | Package / location                                        | Responsibility                                                                                                                                                                      |
| --------------- | --------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Wire protocol   | `@tinytinkerer/app-bridge` (`packages/shared/app-bridge`) | Product-agnostic message envelope + correlation/timeouts + the client/server helpers and DOM transports. Knows nothing about any specific app.                                      |
| Hosting         | `@tinytinkerer/app-harness` (`packages/app/app-harness`)  | `<AppFrame>` (sandboxed iframe host + handshake + lifecycle), `createAppBridgeHandle`, `appToolsFromVerbs` (verbs → always-on `appTools`), `<HarnessShell>` (frame + chat overlay). |
| Tool seam       | `@tinytinkerer/app-browser`                               | `createBrowserShellRoot({ appTools })` registers always-on, schema-driven tools intrinsic to a shell (no activation surface); web/widget/mobile omit it.                            |
| Harness shell   | `apps/<app>` (e.g. `apps/canvas`)                         | Thin: points `<AppFrame>` at its app page and declares its verb→tool mapping. No third-party deps.                                                                                  |
| Iframe app      | `apps/<app>-app` (e.g. `apps/excalidraw-app`)             | First-party wrapper that mounts the third-party component and implements the bridge **server**. Owns all heavy/third-party deps, on its own build.                                  |
| Verb vocabulary | app-owned protocol package (e.g. `excalidraw-protocol`)   | The Zod verb payload schemas, imported by both the shell (model-facing tool input) and the iframe app (server validation) — one source of truth.                                    |

## The wire protocol (`app-bridge`)

Every message is a Zod-validated envelope discriminated on `kind`, and carries `protocolVersion` + `sessionNonce`:

- `req` `{ id, verb, payload }` — harness → app; correlated to its `res` by `id`.
- `res` `{ id, ok, result? | error? }` — app → harness.
- `event` `{ verb, payload }` — app → harness; unsolicited (e.g. `scene-changed`).
- `ready` `{ appId, verbs }` — app → harness; the handshake.
- `hello` `{}` — harness → app; "re-announce `ready`" (see handshake).

The client (`createBridgeClient`) and server (`createBridgeServer`) are written against a tiny `BridgeTransport` (`post` + `subscribe`) so the correlation/timeout/validation logic is unit-testable without a real iframe. Production wires the DOM transports (`iframeClientTransport`, `parentServerTransport`).

## Handshake & lifecycle

```
Shell mounts <AppFrame> ──▶ attaches its message listener, then renders the iframe
iframe app loads ──────────▶ bridge server announces `ready` (appId, version, verbs)
client receives `ready` ───▶ version/appId gate; on success populates the bridge handle
                              on version mismatch ──▶ tools degrade (reject clearly)
... steady state: requests/responses/events
```

Two mechanisms make the handshake robust to mount ordering: the server announces `ready` on startup (covers "harness listening first, app loads later"), and the client posts `hello` on creation, to which the server re-announces `ready` (covers a client that subscribes **after** the app already announced — e.g. a React strict-mode effect re-run). Requests issued before `ready` reject with an actionable message instead of hanging; a version mismatch marks the app unavailable so its tools fail cleanly rather than speaking an unknown wire format.

## Security boundary

The iframe is mounted `sandbox="allow-scripts"` **without** `allow-same-origin`, so the app runs at an **opaque origin**: it can run its own scripts but has no same-origin access to the harness's storage, cookies, or DOM, and the two share no auth. Because the origin is opaque, `event.origin` is the string `"null"` and a literal origin allowlist is meaningless; trust is instead anchored on:

- **identity** — the DOM transport accepts only messages whose `event.source` is the exact expected window (the iframe's `contentWindow` on the harness side; `window.parent` on the app side);
- **a per-mount session nonce** — generated by the harness, passed to the app via the iframe URL fragment (never sent to the server), and required on every message by both client and server;
- **envelope schema validation** — every inbound message's _envelope_ (`kind`, `verb`, ids, `protocolVersion`, `sessionNonce`) is re-parsed with Zod before it is acted on; a malformed or foreign-shaped message is dropped. Verb **payloads** are validated separately against each verb's own Zod schema: on the harness side by the chat runtime before it dispatches a tool call, and on the app side by the verb handler before it acts (the bridge passes payloads through as opaque `unknown`, so an app handler must validate its own input);
- **request timeouts** — every request rejects if no response arrives in time.

`targetOrigin` is `'*'` on every `postMessage`: this is safe because bridge payloads carry no harness secrets (only verb names and app data). This mirrors the long-standing approach in `app-browser`'s `sandbox-executor.ts`.

Consequently, all of an app's heavy/third-party code — and any advisory (GHSA) or license allow-list it needs — lives in the `apps/<app>-app` build, off the chat shell's origin and bundle.
