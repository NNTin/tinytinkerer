// Distinct from the product's own `tinytinkerer-pixel-agents` IndexedDB
// database and `tinytinkerer:pixel-agents-workspace-layout:v1` localStorage
// key (see @tinytinkerer/pixel-agents's workspace-db.ts) so a visitor's demo
// office seats/layout never collide with, or overwrite, their real Pixel
// Agents workspace on the same origin (issue #452) — nor the documentation
// assistant's own office workspace (issue #472, see
// docs-runtime/assistant-constants.ts).
export const DOCS_PIXEL_AGENTS_WORKSPACE_DATABASE = 'tinytinkerer-docs-lab-pixel-agents'
export const DOCS_PIXEL_AGENTS_DOCK_LAYOUT_STORAGE_KEY =
  'tinytinkerer-docs-lab:pixel-agents-workspace-layout:v1'
export const DOCS_PIXEL_AGENTS_CHAT_STORAGE_KEY =
  'tinytinkerer-docs-lab:pixel-agents-lab-chat-layout:v1'
