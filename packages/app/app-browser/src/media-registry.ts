import type { ChatEvent } from '@tinytinkerer/contracts'
import { mediaRefFor, partitionToolResultMedia } from '@tinytinkerer/contracts'
import { useCallback, useMemo, useSyncExternalStore } from 'react'
import { useOptionalBrowserApp } from './app'

// Builds the `media:<ref>` -> data URL lookup the chat transcript resolves the
// model's markdown image handles against (the model embeds `![caption](<ref>)`
// instead of a real URL — see `mediaRefFor`/`partitionToolResultMedia` in
// @tinytinkerer/contracts). Scans the conversation's `agent.tool.completed`
// events, the single source of truth for tool output: they are persisted (IndexedDB,
// via the chat store), so a registry built from them uniformly covers a live run
// AND a reload with no separate rehydrate path.
//
// The key MUST be `mediaRefFor(payload.stepId, i)` where `i` is the index into
// `partitionToolResultMedia(payload.output).media` — the SAME canonical ref the
// inference path minted for the model (its `callId` there is this event's own
// `stepId`, verified equal in this codebase). `partitionToolResultMedia` is
// defensive and never throws, so a malformed output simply yields no media for
// that event rather than breaking the scan.
export const buildMediaRegistry = (events: readonly ChatEvent[]): Map<string, string> => {
  const registry = new Map<string, string>()
  for (const event of events) {
    if (event.type !== 'agent.tool.completed') {
      continue
    }
    const { media } = partitionToolResultMedia(event.payload.output)
    media.forEach((item, index) => {
      registry.set(mediaRefFor(event.payload.stepId, index), item.dataUrl)
    })
  }
  return registry
}

// Stable empty snapshot so `useSyncExternalStore`'s `getSnapshot` returns a
// reference-stable value when there is no browser app (and thus no chat store)
// to read — otherwise every render would report a "changed" snapshot even
// though nothing changed.
const EMPTY_EVENTS: ChatEvent[] = []

// Resolves a `media:<ref>` handle to its real data URL, backed directly by the
// chat store's persisted events — there is no separate cache to keep in sync,
// so a ref always resolves the same way live and after a reload. Tolerates
// rendering outside a mounted BrowserApp (e.g. component tests): `resolve`
// then always returns `undefined`, matching a host that wires no media
// registry at all.
export const useResolveMediaUrl = (): ((ref: string) => string | undefined) => {
  const app = useOptionalBrowserApp()
  const subscribe = useCallback(
    (onStoreChange: () => void) => {
      if (!app) return () => undefined
      return app.stores.chat.subscribe(() => {
        onStoreChange()
      })
    },
    [app]
  )
  const getSnapshot = useCallback(
    (): readonly ChatEvent[] => app?.stores.chat.getState().events ?? EMPTY_EVENTS,
    [app]
  )
  const events = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
  const registry = useMemo(() => buildMediaRegistry(events), [events])
  return useCallback((ref: string) => registry.get(ref), [registry])
}
