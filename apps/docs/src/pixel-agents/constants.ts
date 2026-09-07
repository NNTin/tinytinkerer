// Below this width the pixel-art office cannot be usefully shown beside
// anything else; above it, `usePixelAgentsCapability` offers the graphical
// office (issue #452's "narrow screens" fallback trigger). The documentation
// sidebar's Office (issue #472) uses the same gate — Docusaurus only renders
// the desktop sidebar above 997px, so in practice this only fires there for a
// browser window narrowed after load.
export const PIXEL_AGENTS_NARROW_VIEWPORT_QUERY = '(max-width: 720px)'
export const PIXEL_AGENTS_REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)'
