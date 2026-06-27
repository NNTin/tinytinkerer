// The single seam the bridge client and server talk through. Keeping the bridge
// logic (correlation, timeouts, schema validation, nonce checks) independent of
// any concrete message channel makes it unit-testable without a real iframe: tests
// wire two in-memory transports together; production wires DOM `postMessage`
// transports (see dom-transport.ts).
//
// `post` sends one message; `subscribe` registers a handler for inbound messages
// and returns an unsubscribe function. Messages cross the seam untyped (`unknown`)
// because the channel is untrusted — every consumer re-validates with Zod.
export type BridgeTransport = {
  post(message: unknown): void
  subscribe(handler: (message: unknown) => void): () => void
}
