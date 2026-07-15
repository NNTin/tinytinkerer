import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      'virtual:pwa-register': fileURLToPath(
        new URL('../app-browser/src/test/pwa-register-stub.ts', import.meta.url)
      )
    }
  }
})
