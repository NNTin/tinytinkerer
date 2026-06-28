import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'

const deployBase = process.env.TINYTINKERER_DEPLOY_BASE?.replace(/\/+$/, '')
const base = deployBase ? `${deployBase}/canvas/excalidraw-app/` : '/canvas/excalidraw-app/'

export default defineConfig({
  root: fileURLToPath(new URL('./excalidraw-app', import.meta.url)),
  base,
  plugins: [react()],
  build: {
    outDir: '../dist/excalidraw-app',
    emptyOutDir: false,
    sourcemap: false,
    rollupOptions: {
      output: {
        manualChunks(id: string) {
          if (id.includes('node_modules/react/') || id.includes('node_modules/react-dom/')) {
            return 'react-vendor'
          }
          if (
            id.includes('node_modules/@excalidraw/') ||
            id.includes('node_modules/roughjs/') ||
            id.includes('node_modules/points-on-curve/') ||
            id.includes('node_modules/points-on-path/') ||
            id.includes('node_modules/path-data-parser/')
          ) {
            return 'excalidraw-vendor'
          }
        }
      }
    }
  }
})
