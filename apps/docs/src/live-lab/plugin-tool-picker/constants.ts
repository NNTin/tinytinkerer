// This lab's own ChatApp layout persistence key. Distinct from the Pixel Agents
// lab's key (a different floating/sidebar geometry per surface), but it
// deliberately REUSES that lab's workspace database + dock layout key (see
// PluginToolPickerLabContent.tsx) — both labs share the one isolated docs-lab
// chat session, so the office/seats layout is the same conceptual surface.
export const DOCS_PLUGIN_TOOL_PICKER_CHAT_STORAGE_KEY =
  'tinytinkerer-docs-lab:plugin-tool-picker-lab-chat-layout:v1'
