// The stable id for the context-inspector plugin. Kept in its own module so both
// the plugin manifest and the host (which hard-codes the id to decide whether to
// arm request capture, mirroring how it hard-codes the web-search/run_javascript
// tool ids) can reference the same literal without importing the whole package.
export const CONTEXT_INSPECTOR_PLUGIN_ID = 'context-inspector'
