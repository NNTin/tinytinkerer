// Stable id used as the activation key (which plugins the user enabled) and the
// manifest id surfaced in the Settings modal. Lives in its own module so sibling
// modules (e.g. gauge-view) can reference it without importing the plugin entry
// point and forming an import cycle. Keep it short and kebab-case.
export const CONTEXT_USAGE_PLUGIN_ID = 'context-usage'
