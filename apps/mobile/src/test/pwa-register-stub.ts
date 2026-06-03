// Test-only stand-in for the `virtual:pwa-register` module, which is provided by
// vite-plugin-pwa at build time but not during vitest runs. Aliased in
// vitest.config.ts so imports resolve; individual tests replace it via vi.mock.
export function registerSW(): (reloadPage?: boolean) => Promise<void> {
  return async () => {}
}
