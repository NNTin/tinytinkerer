// Webpack stand-in for @tinytinkerer/app-browser's plugins/registry.ts (see
// docusaurus.config.ts's stubAppBrowserPluginDiscoveryPlugin). That module
// discovers plugins via Vite's `import.meta.glob`, a Vite-only build-time
// feature with no webpack equivalent — Docusaurus builds with webpack, so
// bundling the real module crashes at runtime with "...glob is not a
// function" the moment anything reachable from it evaluates, which happens
// unconditionally: @tinytinkerer/app-browser's chat store imports
// `loadPluginModules` directly, so ANY LiveLab that touches `useChatStore`
// (every one built so far) pulls this in, whether or not it uses plugins.
//
// The docs live-lab demos have no `packages/plugins/*` of their own to
// discover anyway, so "no plugins available" is the correct behavior here,
// not merely a degraded one.
export const loadPluginModules = (): Promise<unknown[]> => Promise.resolve([])
export const resetPluginModuleCache = (): void => {}
