import type { KnipConfig } from 'knip'

// Knip detects unused files, exports, and dependencies across the pnpm
// workspaces. Workspaces, entry points, and most project files are
// auto-discovered from package.json / pnpm-workspace.yaml; this config only
// records the deliberate exceptions.
//
// Policy: unused *files*, *dependencies*, and unresolved/unlisted imports fail
// CI (these are the high-signal, low-false-positive findings). Unused *exports*
// and *types* are reported as warnings only — internal library packages keep a
// public surface that isn't always consumed within the monorepo, so failing on
// them would be noisy. Burn the warnings down over time (see issue #143).
const config: KnipConfig = {
  // The commitlint config lives in config/ (issue #182), outside the plugin's
  // default detection, so point the plugin at it explicitly. This keeps the
  // file recognized as a config entry and its `extends` dependency traced.
  commitlint: {
    config: ['config/commitlint.config.cjs']
  },
  ignore: [
    // Agent skill tools are invoked by external tooling, not imported by the app.
    '.agent/**',
    // Static assets the host shell loads at runtime, not via module imports.
    'apps/host/public/__host/**'
  ],
  // Dependencies that are present for tooling/typing reasons and are not
  // statically importable, so knip cannot trace them. Baselined for the
  // existing codebase; remove the dep (and this entry) when it is truly gone.
  ignoreDependencies: [
    // Vite React plugin: declared by packages that only run vitest (which uses
    // esbuild for JSX) and have no vite config importing the plugin.
    '@vitejs/plugin-react',
    // Ambient @types/* packages consumed implicitly by the TS compiler.
    '@types/react-dom',
    '@types/dompurify',
    // CLI-only dev tooling without a static import.
    '@testing-library/user-event',
    'eslint-config-prettier'
  ],
  rules: {
    exports: 'warn',
    types: 'warn',
    nsExports: 'warn',
    nsTypes: 'warn',
    duplicates: 'warn',
    enumMembers: 'warn'
  },
  workspaces: {
    'apps/edge': {
      // workerd is the Cloudflare Workers runtime binary. It is spawned as a CLI
      // (miniflare/wrangler dev and the scriptless-install smoke test run the
      // `workerd` bin), never statically imported, so knip cannot trace it.
      // Pinned explicitly so the native binary is part of the locked supply chain.
      ignoreDependencies: ['workerd']
    },
    'apps/web': {
      // Radix primitives kept for parity with the shared UI package; not yet
      // imported directly by the app.
      ignoreDependencies: [
        '@radix-ui/react-collapsible',
        '@radix-ui/react-dialog',
        '@radix-ui/react-tooltip'
      ]
    },
    'apps/mobile': {
      ignoreDependencies: [
        '@radix-ui/react-collapsible',
        '@radix-ui/react-dialog'
      ]
    },
    'packages/plugins/plugin-feedback': {
      // Declared for the plugin's schema work; no runtime import yet.
      ignoreDependencies: ['zod']
    },
    'packages/plugins/plugin-web-search': {
      // Declared for parity with the plugin scaffold; the tool reuses the search
      // schemas from contracts and does not import zod directly yet.
      ignoreDependencies: ['zod']
    }
  }
}

export default config
