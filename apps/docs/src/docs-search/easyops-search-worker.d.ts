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
 * The one deep import production code takes. Upstream's own theme components
 * spell it `../searchByWorker` (SearchBar.jsx, SearchPage.jsx) — a relative,
 * extensionless specifier we cannot write from outside the package — but both
 * spellings resolve to the same file, so webpack serves them from one module
 * instance and therefore one shared worker. That outcome is verified by the
 * browser probe in the PR, not inferred from the specifier text.
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
