import { createRequire } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

// `@docusaurus/router` is a webpack-only alias that core resolves to
// client/exports/router.js, a thin re-export of react-router-dom. Both that
// module and the copy of react-router-dom it re-exports are located *through*
// @docusaurus/core rather than declared as dependencies here, because this
// workspace deliberately does not depend on react-router-dom itself. What
// matters is that a test gets the same physical copy Docusaurus' own client
// uses, so a `<MemoryRouter>` in a test and the `useLocation()`/`matchPath`
// inside the docs plugin share one router context instead of silently landing
// in two.
const docusaurusCoreManifest = createRequire(import.meta.url).resolve(
  '@docusaurus/core/package.json'
)
const docusaurusCoreRequire = createRequire(docusaurusCoreManifest)
const docusaurusRouter = fileURLToPath(
  new URL('lib/client/exports/router.js', pathToFileURL(docusaurusCoreManifest))
)
const reactRouterDom = docusaurusCoreRequire.resolve('react-router-dom')

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      // Docusaurus's own webpack build resolves this to the active theme's
      // MDXComponents via a build-time alias; there is no real package for a
      // plain Vite resolver to find outside that build. See the stub file for
      // details.
      '@theme-original/MDXComponents': fileURLToPath(
        new URL('./src/test/theme-original-mdx-components-stub.ts', import.meta.url)
      ),
      '@theme-original/Root': fileURLToPath(
        new URL('./src/test/theme-original-root-stub.tsx', import.meta.url)
      ),
      // See the resolution note above: the real modules, not stand-ins, so tests
      // exercise the genuine router hooks and the genuine `matchPath` the docs
      // plugin's active-doc context matches routes with.
      '@docusaurus/router': docusaurusRouter,
      // Test-only specifier, not the bare package name — see the ambient
      // declaration in src/test/react-router-dom.d.ts for why the name has to
      // stay distinct.
      '@docs-test/react-router-dom': reactRouterDom,
      // The real browser runtime factory, for the #478 conversation test. Same
      // arrangement, same reason: the test must drive the genuine prompt
      // composition and answer finalization rather than an imitation, and
      // `createRuntime` is deliberately not on app-browser's public barrel (which
      // cannot load outside a Vite app build). See src/test/browser-runtime.d.ts.
      // The assistant's real incremental Markdown session, so the streamed-
      // snapshot link policy is tested against the documents the renderer would
      // actually have been handed. See src/test/content-markdown.d.ts.
      '@docs-test/content-markdown': fileURLToPath(
        new URL('../../packages/content/content-markdown/src/index.ts', import.meta.url)
      ),
      '@docs-test/browser-runtime': fileURLToPath(
        new URL('../../packages/app/app-browser/src/runtime/create-runtime.ts', import.meta.url)
      ),
      // The docs plugin's client barrel cannot be loaded outside a Docusaurus
      // webpack build; this stub keeps upstream's real active-document
      // resolution while skipping the barrel. See the file for the details.
      '@docusaurus/plugin-content-docs/client': fileURLToPath(
        new URL('./src/test/docusaurus-plugin-content-docs-client-stub.ts', import.meta.url)
      ),
      // Read by that stub, mirroring the `failfast` semantics core's real
      // `@docusaurus/useGlobalData` implements over a React context a plain
      // Vitest render cannot mount.
      '@docusaurus/useGlobalData': fileURLToPath(
        new URL('./src/test/docusaurus-use-global-data-stub.ts', import.meta.url)
      ),
      '@docusaurus/BrowserOnly': fileURLToPath(
        new URL('./src/test/docusaurus-browser-only-stub.tsx', import.meta.url)
      ),
      '@docusaurus/useDocusaurusContext': fileURLToPath(
        new URL('./src/test/docusaurus-use-docusaurus-context-stub.ts', import.meta.url)
      ),
      '@docusaurus/useBaseUrl': fileURLToPath(
        new URL('./src/test/docusaurus-use-base-url-stub.ts', import.meta.url)
      ),
      '@generated/globalData': fileURLToPath(
        new URL('./src/test/generated-global-data-stub.ts', import.meta.url)
      ),
      // The search plugin's own worker.js reads its runtime config from this
      // webpack-generated module. Docusaurus' build writes and resolves it for
      // real (apps/docs/.docusaurus/@easyops-cn/...); this alias is what lets
      // docs-search's contract test drive the genuine upstream SearchWorker
      // instead of a hand-rolled imitation. See the stub for details.
      '@generated/@easyops-cn/docusaurus-search-local/default/generated-constants.js':
        fileURLToPath(new URL('./src/test/generated-search-constants-stub.ts', import.meta.url))
    }
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test-setup.ts']
  }
})
