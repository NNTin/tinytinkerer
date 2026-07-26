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
  // The lint-staged config also lives in config/ (outside the plugin's default
  // detection) and is wired into the Husky pre-commit hook via an explicit
  // --config flag, so point the plugin at it to keep the file recognized as a
  // config entry and trace lint-staged as a used dependency.
  'lint-staged': {
    config: ['config/lint-staged.config.mjs']
  },
  ignore: [
    // Agent skill tools are invoked by external tooling, not imported by the app.
    '.agent/**'
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
    // CLI-only dev tooling without a static import.
    '@testing-library/user-event',
    'eslint-config-prettier',
    // Allure test report (issue #254). The vitest reporter is referenced only as a
    // string passed via a turbo passthrough flag (`--reporter=allure-vitest/reporter`
    // in `pnpm test:allure`), and the CLI is invoked as the `allure` bin — neither is
    // statically imported, so knip cannot trace them.
    'allure-vitest',
    'allure-commandline'
  ],
  rules: {
    exports: 'warn',
    types: 'warn',
    nsExports: 'warn',
    nsTypes: 'warn',
    // Each plugin intentionally exports its `createPlugin`/`manifest` twice: once
    // under the generic names the PluginModule contract requires for dynamic
    // discovery, and once under descriptive aliases the tests import. These are
    // deliberate, not drift, so duplicates stay a warning rather than failing CI.
    duplicates: 'warn',
    enumMembers: 'warn'
  },
  workspaces: {
    '.': {
      // Executed by the Pixel Agents preparation script with the pinned upstream
      // checkout's tsx binary, so there is deliberately no static import edge.
      entry: ['scripts/build-pixel-agents-assets.mjs']
    },
    'apps/edge': {
      // workerd is the Cloudflare Workers runtime binary. It is spawned as a CLI
      // (miniflare/wrangler dev and the scriptless-install smoke test run the
      // `workerd` bin), never statically imported, so knip cannot trace it.
      // Pinned explicitly so the native binary is part of the locked supply chain.
      ignoreDependencies: ['workerd']
    },
    'apps/docs': {
      // Docusaurus loads the stylesheet from a string in its config, while the
      // repository-level MDX source imports this component through the @site
      // alias. Register both runtime entry points because Knip cannot follow
      // either edge statically across the workspace boundary.
      entry: ['src/components/lab-container.tsx', 'src/css/custom.css'],
      // Knip's Docusaurus plugin resolves a scoped theme's package name by
      // assuming the `@scope/docusaurus-theme-x` convention (it special-cases
      // names that already contain "theme-", which @docusaurus/theme-mermaid
      // does). @easyops-cn/docusaurus-search-local doesn't follow that
      // convention, so it's misreported as unlisted under that guessed name
      // (which is not a real package). The real package name itself is no
      // longer misreported as unused now that src/docs-search's compatibility
      // adapter (issue #475) statically imports from it.
      ignoreDependencies: ['@easyops-cn/docusaurus-theme-docusaurus-search-local']
    },
    'apps/shell': {
      // Radix primitives kept for parity with the shared UI package; consumed by
      // @tinytinkerer/ui, not imported directly by the shell app.
      ignoreDependencies: [
        '@radix-ui/react-collapsible',
        '@radix-ui/react-dialog',
        '@radix-ui/react-tooltip'
      ]
    },
    'packages/plugins/plugin-feedback': {
      // Declared for the plugin's schema work; no runtime import yet.
      ignoreDependencies: ['zod']
    },
    'packages/app/canvas': {
      // Canvas has a React mount test in addition to its .ts domain tests. Keep the
      // package's complete Vitest suite explicit so Knip traces its test-only React
      // dependencies even when plugin discovery sees only the .ts entries.
      entry: ['tests/**/*.test.{ts,tsx}']
    },
    'packages/app/mermaid': {
      // Same trap as canvas above: the export-modal React mount test is a .tsx
      // entry the plugin discovery misses once the package carries its own
      // vitest.config.ts, which would strand the test and its testing-library
      // devDependencies as "unused".
      entry: ['tests/**/*.test.{ts,tsx}']
    },
    'packages/app/pixel-agents': {
      // Same reason as canvas above: the stage's React mount/reconciliation test
      // (issue #430) sits alongside the package's plain .ts domain tests, so its
      // test-only @testing-library/* dependencies need the same explicit entry.
      entry: ['tests/**/*.test.{ts,tsx}']
    },
    'packages/e2e': {
      // Playwright specs use the `*.e2e.ts` extension (kept distinct from vitest's
      // globs), which Knip's Playwright plugin does not match by default. Register
      // the specs so the suite, its fixtures, and @playwright/test are traced. The
      // custom reporters are named only as string paths in the config's `reporter`
      // array, so list them explicitly too or they read as unused files.
      entry: ['tests/**/*.e2e.ts', 'reporters/**/*.ts'],
      project: ['**/*.ts'],
      // The Allure Playwright reporter is named as a string in the reporter array
      // (issue #254), not imported, so knip cannot trace it.
      ignoreDependencies: ['allure-playwright']
    }
  }
}

export default config
