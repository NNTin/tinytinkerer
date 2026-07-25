// The docs-only IndexedDB namespace for LiveLab demo state (conversations, plugin
// settings, model selection). Deliberately distinct from the product's own default
// namespace ('tinytinkerer', defined in @tinytinkerer/app-browser's config module)
// so a lab's history/settings never appears in, or overwrites, the normal app's data
// (issue #451). LabReset deletes exactly this IndexedDB database.
export const DOCS_LAB_STORAGE_NAMESPACE = 'tinytinkerer-docs-lab'

// One-time consent-style notice shown by every LiveLab before any protected content
// (and therefore before any possible network action) renders.
export const DOCS_LAB_NETWORK_NOTICE =
  'This demo contacts the live TinyTinkerer backend and may consume your account’s usage quota.'
