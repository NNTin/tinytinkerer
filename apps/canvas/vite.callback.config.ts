import { defineConfig } from 'vite'
import { fileURLToPath } from 'node:url'

// Standalone build for the Excalidraw library-import relay page. It is a tiny vanilla
// entry (no React, no Excalidraw) served at /canvas/library-callback/ on the real
// origin, kept out of the shell and iframe graphs. See library-callback/main.ts.
const deployBase = process.env.TINYTINKERER_DEPLOY_BASE?.replace(/\/+$/, '')
const base = deployBase ? `${deployBase}/canvas/library-callback/` : '/canvas/library-callback/'

export default defineConfig({
  root: fileURLToPath(new URL('./library-callback', import.meta.url)),
  base,
  build: {
    outDir: '../dist/library-callback',
    emptyOutDir: false,
    sourcemap: false
  }
})
