// Stable id used as the activation key and the contributed tool id. Must match the
// manifest id surfaced in the Settings Modal. Lives in its own module so sibling
// modules (e.g. permission-view) can reference it without importing the plugin
// entry point and forming an import cycle.
export const CODE_EXEC_PLUGIN_ID = 'code-exec'
