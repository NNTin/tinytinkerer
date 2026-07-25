// Shareable-selection helpers: the playground's URL only ever carries a
// curated EXAMPLE ID (see constants.ts), never free-form editor source —
// issue #455's "shareable example selection... without placing arbitrary
// source in the URL." Pure functions so they're testable without a browser.

export const PLAYGROUND_EXAMPLE_QUERY_PARAM = 'example'

export const readExampleIdFromSearch = (search: string): string | null =>
  new URLSearchParams(search).get(PLAYGROUND_EXAMPLE_QUERY_PARAM)

export const withExampleIdInSearch = (search: string, exampleId: string): string => {
  const params = new URLSearchParams(search)
  params.set(PLAYGROUND_EXAMPLE_QUERY_PARAM, exampleId)
  return `?${params.toString()}`
}
