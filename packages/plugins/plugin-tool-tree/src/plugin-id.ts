// The stable id for the tool-tree plugin. Kept in its own module so both the
// plugin manifest and the host (which resolves the first enabled plugin
// contributing a toolTreeDescriptor by scanning manifests, mirroring how it
// resolves the inspector/status descriptors) can reference the same literal
// without importing the whole package.
export const TOOL_TREE_PLUGIN_ID = 'tool-tree'
