import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const deployBase = process.env.TINYTINKERER_DEPLOY_BASE?.replace(/\/+$/, '')
const base = deployBase ? `${deployBase}/excalidraw-app/` : '/excalidraw-app/'

export default defineConfig({
  base,
  plugins: [react()],
  server: {
    host: 'localhost'
  },
  build: {
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
