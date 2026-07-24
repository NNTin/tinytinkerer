import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

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
      '@docusaurus/BrowserOnly': fileURLToPath(
        new URL('./src/test/docusaurus-browser-only-stub.tsx', import.meta.url)
      ),
      '@docusaurus/useDocusaurusContext': fileURLToPath(
        new URL('./src/test/docusaurus-use-docusaurus-context-stub.ts', import.meta.url)
      )
    }
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test-setup.ts']
  }
})
