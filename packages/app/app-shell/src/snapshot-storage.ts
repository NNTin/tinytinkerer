// Host-side persistence for an embedded app's opaque session snapshot. A sandboxed
// iframe app runs at an opaque origin and has no Web Storage of its own (see the
// security boundary in docs/app-harness.md), so the harness — which runs at a real
// origin — persists the opaque blob the app emits and replays it on reload.
//
// The snapshot is treated as opaque JSON: this module never interprets app data, and
// every access fails safe (missing key, unavailable storage, or corrupt JSON all
// yield `null`/no-op) so persistence can never break the harness or the app.

export const readAppSnapshot = (key: string): unknown => {
  try {
    const raw = window.localStorage.getItem(key)
    if (raw === null) return null
    return JSON.parse(raw)
  } catch {
    return null
  }
}

export const writeAppSnapshot = (key: string, snapshot: unknown): void => {
  try {
    window.localStorage.setItem(key, JSON.stringify(snapshot))
  } catch {
    // Storage may be unavailable (private mode, quota exceeded). Best-effort only.
  }
}
