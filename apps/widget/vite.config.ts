import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { getBuildInfo } from '../../scripts/build-info.mjs'

const deployBase = process.env.TINYTINKERER_DEPLOY_BASE?.replace(/\/+$/, '')
const base = deployBase ? `${deployBase}/widget/` : '/widget/'
const { appVersion, buildHash } = getBuildInfo()

export default defineConfig({
  base,
  define: {
    __APP_VERSION__: JSON.stringify(appVersion),
    __BUILD_HASH__: JSON.stringify(buildHash)
  },
  plugins: [react(), tailwindcss()],
  server: {
    host: 'localhost'
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id: string) {
          if (
            id.includes('node_modules/react/') ||
            id.includes('node_modules/react-dom/') ||
            id.includes('node_modules/react-router')
          ) {
            return 'react-vendor'
          }
          if (
            id.includes('node_modules/@sentry/') ||
            id.includes('node_modules/@sentry-internal/')
          ) {
            return 'sentry-vendor'
          }
          if (
            id.includes('node_modules/@codemirror/') ||
            id.includes('node_modules/codemirror/')
          ) {
            return 'codemirror-vendor'
          }
        }
      }
    }
  }
})
