import { bridgeMessageSchema } from './protocol'
import type { BridgeTransport } from './transport'

// Thrown when the app's `ready` handshake advertises a protocol version the
// harness does not speak. The harness catches this to degrade the app's tools
// (they reject with a clear message) instead of issuing requests the app cannot
// answer. A distinct class lets callers branch on the failure mode.
export class BridgeVersionMismatchError extends Error {
  readonly expected: number
  readonly received: number

  constructor(expected: number, received: number) {
    super(
      `app-bridge: protocol version mismatch (harness expected ${expected}, app reported ${received})`
    )
    this.name = 'BridgeVersionMismatchError'
    this.expected = expected
    this.received = received
  }
}

export class BridgeCapabilityMismatchError extends Error {
  readonly missingVerbs: readonly string[]

  constructor(missingVerbs: readonly string[]) {
    super(`app-bridge: app did not advertise required verbs: ${missingVerbs.join(', ')}`)
    this.name = 'BridgeCapabilityMismatchError'
    this.missingVerbs = missingVerbs
  }
}

export type BridgeHandshake = {
  appId: string
  protocolVersion: number
  verbs: readonly string[]
}

export type BridgeClient = {
  // Resolves once the app announces it is ready and identity/version/capabilities
  // match; rejects on mismatch. Requests should await this first.
  readonly ready: Promise<BridgeHandshake>
  // Invoke a verb on the app. Resolves with the verb's result or rejects on the
  // app's error, a request timeout, or a transport failure.
  request(verb: string, payload?: unknown): Promise<unknown>
  // Subscribe to an app event verb (e.g. "scene-changed"). Returns an unsubscribe.
  on(verb: string, handler: (payload: unknown) => void): () => void
  // Tear down: stop listening, clear timers, reject any in-flight requests.
  dispose(): void
}

export type CreateBridgeClientOptions = {
  // The version the harness speaks; compared against the app's `ready`.
  protocolVersion: number
  // The per-mount nonce this client accepts (and stamps on outbound messages).
  sessionNonce: string
  // When set, a `ready` from a different appId rejects `ready` (defends against a
  // wrong/foreign frame answering on the shared message channel).
  expectedAppId?: string
  // Required app capabilities. Extra advertised verbs are allowed, but a missing
  // required verb rejects the handshake before tools can target an incompatible app.
  expectedVerbs?: readonly string[]
  // Per-request timeout. Defaults to 15s.
  timeoutMs?: number
  // Id generator (injectable for tests). Defaults to crypto.randomUUID.
  generateId?: () => string
}

const DEFAULT_TIMEOUT_MS = 15_000

type PendingRequest = {
  resolve: (value: unknown) => void
  reject: (error: Error) => void
  timer: ReturnType<typeof setTimeout>
}

export const createBridgeClient = (
  transport: BridgeTransport,
  options: CreateBridgeClientOptions
): BridgeClient => {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const generateId = options.generateId ?? (() => crypto.randomUUID())

  const pending = new Map<string, PendingRequest>()
  const eventHandlers = new Map<string, Set<(payload: unknown) => void>>()

  let resolveReady!: (handshake: BridgeHandshake) => void
  let rejectReady!: (error: Error) => void
  const ready = new Promise<BridgeHandshake>((resolve, reject) => {
    resolveReady = resolve
    rejectReady = reject
  })
  // Swallow the default unhandled-rejection if no one awaits `ready` before a
  // mismatch — the harness always awaits it, but a stray reject shouldn't crash.
  ready.catch(() => {})
  let readySettled = false

  const unsubscribe = transport.subscribe((raw) => {
    const parsed = bridgeMessageSchema.safeParse(raw)
    if (!parsed.success) return
    const message = parsed.data
    // Drop anything not stamped with our session's nonce.
    if (message.sessionNonce !== options.sessionNonce) return

    if (message.kind === 'ready') {
      if (readySettled) return
      if (options.expectedAppId !== undefined && message.appId !== options.expectedAppId) {
        readySettled = true
        rejectReady(
          new Error(
            `app-bridge: unexpected appId "${message.appId}" (expected "${options.expectedAppId}")`
          )
        )
        return
      }
      if (message.protocolVersion !== options.protocolVersion) {
        readySettled = true
        rejectReady(
          new BridgeVersionMismatchError(options.protocolVersion, message.protocolVersion)
        )
        return
      }
      const advertisedVerbs = new Set(message.verbs)
      const missingVerbs = (options.expectedVerbs ?? []).filter(
        (verb) => !advertisedVerbs.has(verb)
      )
      if (missingVerbs.length > 0) {
        readySettled = true
        rejectReady(new BridgeCapabilityMismatchError(missingVerbs))
        return
      }
      readySettled = true
      resolveReady({
        appId: message.appId,
        protocolVersion: message.protocolVersion,
        verbs: message.verbs
      })
      return
    }

    if (message.kind === 'res') {
      const entry = pending.get(message.id)
      if (!entry) return
      pending.delete(message.id)
      clearTimeout(entry.timer)
      if (message.ok) {
        entry.resolve(message.result ?? null)
      } else {
        // `error` is a required non-empty string on the ok:false branch (enforced
        // by responseMessageSchema), so no fallback is needed here.
        entry.reject(new Error(message.error))
      }
      return
    }

    if (message.kind === 'event') {
      const handlers = eventHandlers.get(message.verb)
      if (!handlers) return
      for (const handler of handlers) handler(message.payload)
    }
  })

  // Nudge the app to (re)announce readiness. Covers the case where this client
  // attaches after the app already sent its startup `ready` (e.g. a strict-mode
  // effect re-run). Harmless if the app isn't listening yet — its startup `ready`
  // still arrives.
  try {
    transport.post({
      kind: 'hello',
      protocolVersion: options.protocolVersion,
      sessionNonce: options.sessionNonce
    })
  } catch {
    // The app side may not be reachable yet; the startup `ready` path still applies.
  }

  const request = (verb: string, payload?: unknown): Promise<unknown> =>
    new Promise<unknown>((resolve, reject) => {
      const id = generateId()
      const timer = setTimeout(() => {
        pending.delete(id)
        reject(new Error(`app-bridge: request "${verb}" timed out after ${timeoutMs}ms`))
      }, timeoutMs)
      pending.set(id, { resolve, reject, timer })
      try {
        transport.post({
          kind: 'req',
          id,
          verb,
          payload: payload ?? null,
          protocolVersion: options.protocolVersion,
          sessionNonce: options.sessionNonce
        })
      } catch (error) {
        pending.delete(id)
        clearTimeout(timer)
        reject(error instanceof Error ? error : new Error(String(error)))
      }
    })

  const on = (verb: string, handler: (payload: unknown) => void): (() => void) => {
    let handlers = eventHandlers.get(verb)
    if (!handlers) {
      handlers = new Set()
      eventHandlers.set(verb, handlers)
    }
    handlers.add(handler)
    return () => {
      const set = eventHandlers.get(verb)
      if (!set) return
      set.delete(handler)
      if (set.size === 0) eventHandlers.delete(verb)
    }
  }

  const dispose = (): void => {
    unsubscribe()
    for (const entry of pending.values()) {
      clearTimeout(entry.timer)
      entry.reject(new Error('app-bridge: client disposed'))
    }
    pending.clear()
    eventHandlers.clear()
    if (!readySettled) {
      readySettled = true
      rejectReady(new Error('app-bridge: client disposed before ready'))
    }
  }

  return { ready, request, on, dispose }
}
