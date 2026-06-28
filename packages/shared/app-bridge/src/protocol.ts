import { z } from 'zod'

// The wire protocol version. Bump this whenever the envelope shape below changes
// in a backward-incompatible way. Each iframe app advertises the version it was
// built against in its `ready` handshake; the harness compares it against the
// version it expects and degrades the app's tools gracefully on a mismatch rather
// than speaking a wire format the other side cannot parse.
export const APP_BRIDGE_PROTOCOL_VERSION = 1

// Fields every message carries regardless of `kind`:
//   - protocolVersion: the version the sender was built against (handshake gate).
//   - sessionNonce: a per-mount secret that pairs one harness instance with one
//     iframe instance. Over a sandboxed (opaque-origin) iframe, `event.origin` is
//     the string "null", so a literal origin allowlist is meaningless; the bridge
//     instead trusts message *identity* (event.source, enforced in the DOM
//     transport) plus this nonce (enforced in the client/server). This mirrors the
//     nonce approach in app-browser's sandbox-executor.ts.
const envelopeBaseShape = {
  protocolVersion: z.number().int().nonnegative(),
  sessionNonce: z.string().min(1)
}

// Harness → app: invoke a verb. Correlated to its response by `id`.
export const requestMessageSchema = z.object({
  ...envelopeBaseShape,
  kind: z.literal('req'),
  id: z.string().min(1),
  verb: z.string().min(1),
  payload: z.unknown()
})

// App → harness: the reply to a request, correlated by the same `id`. Modeled as
// a discriminated union on `ok` so the envelope itself enforces the invariant — a
// success carries a (possibly null) `result`, a failure carries a non-empty
// `error`. The channel is untrusted, so a malformed reply (e.g. `ok: false` with
// no error) is rejected on receipt rather than papered over with a fallback.
const responseBaseShape = {
  ...envelopeBaseShape,
  kind: z.literal('res'),
  id: z.string().min(1)
}
export const responseMessageSchema = z.discriminatedUnion('ok', [
  z.object({ ...responseBaseShape, ok: z.literal(true), result: z.unknown().optional() }),
  z.object({ ...responseBaseShape, ok: z.literal(false), error: z.string().min(1) })
])

// App → harness: an unsolicited notification (e.g. "scene-changed"). Fire-and-forget.
export const eventMessageSchema = z.object({
  ...envelopeBaseShape,
  kind: z.literal('event'),
  verb: z.string().min(1),
  payload: z.unknown()
})

// App → harness: the handshake announcing the app is mounted, which protocol
// version it speaks, and which verbs it serves. Sent once on app startup AND in
// reply to a `hello` (see below).
export const readyMessageSchema = z.object({
  ...envelopeBaseShape,
  kind: z.literal('ready'),
  appId: z.string().min(1),
  verbs: z.array(z.string().min(1))
})

// Harness → app: "are you there?". The app re-announces `ready` in response. This
// makes the handshake robust to mount ordering: the app's startup `ready` covers
// "harness listening first, app loads later", and `hello` covers the reverse —
// including a harness client that re-subscribes (e.g. React strict-mode effect
// re-runs) AFTER the app already announced, which would otherwise miss `ready`.
export const helloMessageSchema = z.object({
  ...envelopeBaseShape,
  kind: z.literal('hello')
})

// A plain union (not `discriminatedUnion('kind')`) because `responseMessageSchema`
// is itself a discriminated union (on `ok`) and so cannot be a member of an outer
// discriminated union. Each member still carries a literal `kind`, so consumers
// narrow on it normally.
export const bridgeMessageSchema = z.union([
  requestMessageSchema,
  responseMessageSchema,
  eventMessageSchema,
  readyMessageSchema,
  helloMessageSchema
])

export type RequestMessage = z.infer<typeof requestMessageSchema>
export type ResponseMessage = z.infer<typeof responseMessageSchema>
export type EventMessage = z.infer<typeof eventMessageSchema>
export type ReadyMessage = z.infer<typeof readyMessageSchema>
export type HelloMessage = z.infer<typeof helloMessageSchema>
export type BridgeMessage = z.infer<typeof bridgeMessageSchema>
