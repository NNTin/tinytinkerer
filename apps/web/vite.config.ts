import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const deployBase = process.env.TINYTINKERER_DEPLOY_BASE?.replace(/\/+$/, '')
const base = deployBase ? `${deployBase}/web/` : '/web/'

export default defineConfig({
  base,
  plugins: [react(), tailwindcss()],
  server: {
    host: 'localhost',
    proxy: {
      '/api': { target: 'http://localhost:8787', changeOrigin: true },
      '/auth/github/exchange': { target: 'http://localhost:8787', changeOrigin: true },
      '/health': { target: 'http://localhost:8787', changeOrigin: true },
    }
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id: string) {
          if (id.includes('node_modules/react/') || id.includes('node_modules/react-dom/') || id.includes('node_modules/react-router')) {
            return 'react-vendor'
          }
          if (id.includes('node_modules/@codemirror/') || id.includes('node_modules/codemirror/')) {
            return 'codemirror-vendor'
          }
        }
      }
    }
  }
})
