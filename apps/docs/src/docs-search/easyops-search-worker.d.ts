// The pinned @easyops-cn/docusaurus-search-local@0.55.2 ships no `exports` map
// and no types for its internal modules (its package.json declares only
// `main`/`typings`, both pointing at the *server* entry point), so a deep
// import needs an ambient declaration.
//
// Both declarations below type their results as `unknown[]` rather than the
// plugin's private `DSLASearchResult[]`, so that shape cannot leak past
// private-worker-adapter.ts's runtime validation — the adapter re-declares
// exactly the fields it validates and consumes.

/**
 * The one deep import production code takes. The specifier is byte-identical
 * to the one the plugin's own theme components (SearchBar.jsx, SearchPage.jsx)
 * use, which is what makes webpack dedupe them onto a single module instance
 * and therefore a single shared worker.
 */
declare module '@easyops-cn/docusaurus-search-local/dist/client/client/theme/searchByWorker.js' {
  export function searchByWorker(
    baseUrl: string,
    searchContext: string,
    input: string,
    limit: number
  ): Promise<unknown[]>
  export function fetchIndexesByWorker(baseUrl: string, searchContext: string): Promise<void>
}

/**
 * Test-only. `searchByWorker.js` exists purely to wrap this class in a real
 * `Worker` + Comlink RPC, which jsdom has no use for, so __tests__ drive the
 * class directly to exercise genuine upstream query behavior — see
 * __tests__/private-worker-contract.test.ts. Production code must go through
 * `searchByWorker` above so the query actually runs off the main thread.
 */
declare module '@easyops-cn/docusaurus-search-local/dist/client/client/theme/worker.js' {
  export class SearchWorker {
    search(baseUrl: string, searchContext: string, input: string, limit: number): Promise<unknown[]>
    fetchIndexes(baseUrl: string, searchContext: string): Promise<void>
  }
}
