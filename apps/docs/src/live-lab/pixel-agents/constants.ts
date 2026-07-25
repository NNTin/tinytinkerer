// Distinct from the product's own `tinytinkerer-pixel-agents` IndexedDB
// database and `tinytinkerer:pixel-agents-workspace-layout:v1` localStorage
// key (see @tinytinkerer/pixel-agents's workspace-db.ts) so a visitor's demo
// office seats/layout never collide with, or overwrite, their real Pixel
// Agents workspace on the same origin (issue #452).
export const DOCS_PIXEL_AGENTS_WORKSPACE_DATABASE = 'tinytinkerer-docs-lab-pixel-agents'
export const DOCS_PIXEL_AGENTS_DOCK_LAYOUT_STORAGE_KEY =
  'tinytinkerer-docs-lab:pixel-agents-workspace-layout:v1'
export const DOCS_PIXEL_AGENTS_CHAT_STORAGE_KEY =
  'tinytinkerer-docs-lab:pixel-agents-lab-chat-layout:v1'

// Below this width the assistant panel and the pixel-art office can't both be
// usefully shown; above it, `usePixelAgentsCapability` offers the graphical
// office (issue #452's "narrow screens" fallback trigger).
export const PIXEL_AGENTS_NARROW_VIEWPORT_QUERY = '(max-width: 720px)'
export const PIXEL_AGENTS_REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)'
