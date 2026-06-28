import { bridgeMessageSchema } from './protocol'
import type { BridgeTransport } from './transport'

// A verb handler runs inside the iframe app and maps a request payload to a
// result (or throws to signal failure). It may be sync or async — the server
// awaits the return value either way. Payloads arrive untyped — handlers validate
// with their own app-owned Zod schemas. (The result type is `unknown` rather than
// `unknown | Promise<unknown>` because `unknown` already absorbs the promise.)
export type BridgeVerbHandler = (payload: unknown) => unknown

export type BridgeServer = {
  // Re-announce readiness. Called once automatically on creation; exposed so an
  // app can re-handshake if it remounts.
  announceReady(): void
  // Send an unsolicited event to the harness (e.g. "scene-changed").
  emit(verb: string, payload?: unknown): void
  // Stop listening for requests.
  dispose(): void
}

export type CreateBridgeServerOptions = {
  // Identifies this app in the handshake; the harness can pin it via expectedAppId.
  appId: string
  // The version this app speaks; the harness gates on it.
  protocolVersion: number
  // The per-mount nonce (passed from the harness, e.g. via the iframe URL hash).
  sessionNonce: string
  // verb → handler. The set of keys is advertised in the handshake.
  handlers: Record<string, BridgeVerbHandler>
}

export const createBridgeServer = (
  transport: BridgeTransport,
  options: CreateBridgeServerOptions
): BridgeServer => {
  const verbs = Object.keys(options.handlers)

  const announceReady = (): void => {
    transport.post({
      kind: 'ready',
      appId: options.appId,
      protocolVersion: options.protocolVersion,
      sessionNonce: options.sessionNonce,
      verbs
    })
  }

  const emit = (verb: string, payload?: unknown): void => {
    transport.post({
      kind: 'event',
      verb,
      payload: payload ?? null,
      protocolVersion: options.protocolVersion,
      sessionNonce: options.sessionNonce
    })
  }

  const unsubscribe = transport.subscribe((raw) => {
    const parsed = bridgeMessageSchema.safeParse(raw)
    if (!parsed.success) return
    const message = parsed.data
    if (message.sessionNonce !== options.sessionNonce) return
    // A late-joining harness client asks us to re-announce; oblige.
    if (message.kind === 'hello') {
      announceReady()
      return
    }
    if (message.kind !== 'req') return

    const reply = (body: { ok: true; result: unknown } | { ok: false; error: string }): void => {
      transport.post({
        kind: 'res',
        id: message.id,
        protocolVersion: options.protocolVersion,
        sessionNonce: options.sessionNonce,
        ...body
      })
    }

    const handler = options.handlers[message.verb]
    if (!handler) {
      reply({ ok: false, error: `app-bridge: unknown verb "${message.verb}"` })
      return
    }

    // Run the (possibly async) handler and reply with its result or error. The
    // error string is guaranteed non-empty so the reply satisfies the wire schema
    // (an empty `error` would be rejected on receipt and the request would hang
    // until its timeout instead of rejecting promptly).
    void (async () => {
      try {
        const result = await handler(message.payload)
        reply({ ok: true, result: result ?? null })
      } catch (error) {
        const text = error instanceof Error ? error.message : String(error)
        reply({ ok: false, error: text || `app-bridge: verb "${message.verb}" failed` })
      }
    })()
  })

  const dispose = (): void => {
    unsubscribe()
  }

  // Announce readiness immediately. The harness attaches its listener at mount —
  // before the iframe document loads — so this first handshake is not missed.
  announceReady()

  return { announceReady, emit, dispose }
}
