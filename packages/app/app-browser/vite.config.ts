import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      // vite-plugin-pwa supplies this virtual module at build time only; point it
      // at a stub so tests can import src/register-pwa.ts (and mock it).
      'virtual:pwa-register': fileURLToPath(
        new URL('./src/test/pwa-register-stub.ts', import.meta.url)
      )
    }
  },
  server: {
    fs: {
      // Allow dynamic imports from the pnpm virtual store when running from a worktree
      // where node_modules are symlinked from a different directory.
      strict: false
    }
  }
})
