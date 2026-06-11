// Minimal in-memory stand-in for Cloudflare's `caches.default`. Responses are
// cloned on read/write so their single-use bodies survive multiple matches.
export const makeCacheMock = () => {
  const store = new Map<string, Response>()
  // The route only ever keys the cache by a string key, so the mock takes a
  // string directly (the real Cache API accepts RequestInfo | URL).
  const cache = {
    match: (key: string) => Promise.resolve(store.get(key)?.clone()),
    put: (key: string, res: Response) => {
      store.set(key, res.clone())
      return Promise.resolve()
    },
    delete: (key: string) => Promise.resolve(store.delete(key))
  }
  return { store, cache }
}
