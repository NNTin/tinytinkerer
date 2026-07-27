/**
 * Test-only stand-in for
 * `@generated/@easyops-cn/docusaurus-search-local/default/generated-constants.js`
 * — the module the pinned search plugin's own `worker.js` reads its language,
 * stop-word, index-URL, and fuzziness settings from.
 *
 * That module is real: Docusaurus' webpack build writes it to
 * `apps/docs/.docusaurus/@easyops-cn/docusaurus-search-local/default/` (see
 * generate.js in the pinned package) and resolves `@generated/*` for every
 * module in the build, app code included. It just isn't produced by a plain
 * Vite/Vitest resolver, exactly like `@generated/globalData` — so this file
 * plays the same role that stub does, and the values below mirror the real
 * generated file for this site's `searchLocalOptions`.
 *
 * Keeping this in sync is part of the package-upgrade checklist in
 * apps/docs/src/docs-search/README.md: if the generated constants gain a field
 * the worker reads, add it here or the contract test stops exercising real
 * behavior.
 */
// The real generated module imports lunr for its side effect of registering
// extra `lunr-languages` stemmers. With `language: ['en']` it registers none
// (see generate.js), so this import mirrors it without doing anything, and lunr
// stays a single shared instance between this stub and the worker.
import 'lunr'

/** `searchLocalOptions` never sets `removeDefaultStopWordFilter`. */
export const removeDefaultStopWordFilter: string[] = []

/** `searchLocalOptions.language` is `['en']`. */
export const language = ['en']

/**
 * `hashed: true` (not `"filename"`) means the content hash is a `?_=` query
 * string on a fixed filename. The hash itself is build-specific; tests stub
 * `fetch`, so only the shape matters here.
 */
export const searchIndexUrl = 'search-index{dir}.json?_=test'

export const searchResultLimits = 8

export const fuzzyMatchingDistance = 1
