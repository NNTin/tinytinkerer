// The pinned @easyops-cn/docusaurus-search-local@0.55.2 ships no `exports`
// map or types for its internal modules (see private-index-adapter.ts's
// module doc). This is the one deep import this adapter takes from it.
declare module '@easyops-cn/docusaurus-search-local/dist/client/client/utils/tokenize.js' {
  export function tokenize(text: string, language: string[]): string[]
}
