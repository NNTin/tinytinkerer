import { useCallback, useEffect, useRef, useState } from 'react'
import {
  APP_SNAPSHOT_EVENT,
  APP_SNAPSHOT_RESTORE_VERB,
  AppProtocolVersionMismatchError,
  BridgeVersionMismatchError,
  createBridgeClient,
  iframeClientTransport
} from '@tinytinkerer/app-bridge'
import type { AppBridgeHandle } from './bridge-handle'
import { readAppSnapshot, writeAppSnapshot } from './snapshot-storage'

export type AppFrameStatus = 'loading' | 'ready' | 'version-mismatch' | 'error'

export type AppFrameProps = {
  // The iframe app page, served under its harness route (e.g. "/canvas/excalidraw-app/").
  src: string
  // The id the harness expects the app to announce; pins the handshake.
  appId: string
  // The protocol version the harness speaks; the app is gated on it.
  appProtocolVersion: number
  // Capabilities this shell exposes as tools. The handshake must advertise all
  // of them before the handle becomes ready.
  expectedVerbs: readonly string[]
  // The shared handle the always-on appTools call through. MUST be stable across
  // renders (create it once, e.g. module-level or via useRef) — it is an effect
  // dependency. <AppFrame> populates it on ready / clears it on teardown.
  handle: AppBridgeHandle
  title: string
  className?: string
  // How long to wait for the app's ready handshake before reporting 'error'.
  readyTimeoutMs?: number
  // localStorage key for persisting the app's opaque session snapshot across reloads.
  // The sandboxed (opaque-origin) app cannot use storage itself, so the harness keeps
  // the blob the app emits and replays it after the handshake. Omit to disable
  // persistence. The stored payload is opaque — the harness never interprets it.
  persistenceKey?: string
  onStatusChange?: (status: AppFrameStatus) => void
}

// The harness passes its per-mount session nonce to the app through the iframe URL
// fragment (a fragment is never sent to the server, and the sandboxed app reads it
// from location.hash). The app echoes it on every message so the two instances stay
// paired over the opaque origin.
export const APP_BRIDGE_NONCE_PARAM = 'app-bridge-nonce'

const appendSessionNonce = (src: string, nonce: string): string => {
  const separator = src.includes('#') ? '&' : '#'
  return `${src}${separator}${APP_BRIDGE_NONCE_PARAM}=${encodeURIComponent(nonce)}`
}

export const AppFrame = ({
  src,
  appId,
  appProtocolVersion,
  expectedVerbs,
  handle,
  title,
  className,
  readyTimeoutMs = 20_000,
  persistenceKey,
  onStatusChange
}: AppFrameProps): React.JSX.Element => {
  const frameRef = useRef<HTMLIFrameElement | null>(null)
  const nonceRef = useRef<string>('')
  if (nonceRef.current === '') nonceRef.current = crypto.randomUUID()
  const [status, setStatus] = useState<AppFrameStatus>('loading')

  // Track the latest onStatusChange without making it an effect dependency (it is
  // often an inline arrow that would otherwise re-run the bridge effect each render).
  const onStatusChangeRef = useRef(onStatusChange)
  onStatusChangeRef.current = onStatusChange

  const report = useCallback((next: AppFrameStatus): void => {
    setStatus(next)
    onStatusChangeRef.current?.(next)
  }, [])

  useEffect(() => {
    const frame = frameRef.current
    if (!frame) return
    let cancelled = false
    let detachSnapshot: (() => void) | undefined

    // A fresh handshake is starting — on initial mount, a prop change, or a
    // StrictMode effect re-run. The previous client was already torn down (its
    // cleanup cleared the handle), so reset to 'loading' instead of leaving a
    // stale 'ready' on data-app-frame-status / onStatusChange while the handle is
    // cleared and rejecting requests.
    report('loading')

    const client = createBridgeClient(iframeClientTransport(frame), {
      appProtocolVersion,
      sessionNonce: nonceRef.current,
      expectedAppId: appId,
      expectedVerbs
    })

    const readyTimer = setTimeout(() => {
      if (cancelled) return
      handle.setUnavailable(`app "${appId}" did not become ready within ${readyTimeoutMs}ms`)
      report('error')
    }, readyTimeoutMs)

    client.ready.then(
      () => {
        if (cancelled) return
        clearTimeout(readyTimer)
        handle.setClient(client)
        if (persistenceKey !== undefined) {
          // Restore first: replay any persisted snapshot, then keep persisting the
          // ones the app emits. Restore is best-effort — a corrupt/incompatible blob
          // rejects at the app's version-guarded contract and the app stays empty.
          const saved = readAppSnapshot(persistenceKey)
          if (saved !== null) void client.request(APP_SNAPSHOT_RESTORE_VERB, saved).catch(() => {})
          detachSnapshot = client.on(APP_SNAPSHOT_EVENT, (payload) => {
            writeAppSnapshot(persistenceKey, payload)
          })
        }
        report('ready')
      },
      (error: unknown) => {
        if (cancelled) return
        clearTimeout(readyTimer)
        handle.setUnavailable(error instanceof Error ? error.message : String(error))
        report(
          error instanceof BridgeVersionMismatchError ||
            error instanceof AppProtocolVersionMismatchError
            ? 'version-mismatch'
            : 'error'
        )
      }
    )

    return () => {
      cancelled = true
      clearTimeout(readyTimer)
      detachSnapshot?.()
      handle.setClient(null)
      client.dispose()
    }
  }, [
    src,
    appId,
    appProtocolVersion,
    expectedVerbs,
    handle,
    readyTimeoutMs,
    persistenceKey,
    report
  ])

  return (
    <iframe
      ref={frameRef}
      src={appendSessionNonce(src, nonceRef.current)}
      title={title}
      className={className}
      // Opaque-origin isolation: the app runs scripts but has no same-origin access
      // to the harness (storage, cookies, DOM). The bridge correlates by event.source
      // + session nonce instead of origin (see app-bridge dom-transport.ts). The grant
      // is the minimum the embedded app's features need — note the deliberate ABSENCE
      // of `allow-same-origin`, which would collapse the opaque origin and defeat that
      // isolation:
      //   - allow-scripts                  run the app bundle (e.g. Excalidraw).
      //   - allow-downloads                export / save-to-image triggers a download.
      //   - allow-popups                   open external links (GitHub, libraries) in a
      //                                    new window.
      //   - allow-popups-to-escape-sandbox opened popups get a normal top-level context
      //                                    (not this restrictive sandbox) so those
      //                                    external sites work.
      sandbox="allow-scripts allow-downloads allow-popups allow-popups-to-escape-sandbox"
      // Permissions Policy is separate from the sandbox: the Clipboard API stays blocked
      // unless the host frame delegates it. Grant only clipboard read/write so "copy to
      // clipboard" (write) and paste (read) work.
      allow="clipboard-write; clipboard-read"
      referrerPolicy="no-referrer"
      data-app-frame-status={status}
    />
  )
}
