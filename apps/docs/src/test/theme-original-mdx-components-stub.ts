// Test-only stand-in for Docusaurus's `@theme-original/MDXComponents` — a pure
// webpack-alias specifier the real Docusaurus build resolves to the active
// theme's own MDXComponents module, with no real package/export anywhere for a
// plain Vite/Vitest resolver to find. Vitest's vitest.config.ts aliases the
// specifier to this file so src/theme/MDXComponents.tsx (which imports it) can
// be exercised in tests without a full Docusaurus build.
export default { code: 'code-original', a: 'a-original' }
