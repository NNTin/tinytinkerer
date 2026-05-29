import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'
import { getBuildInfo } from '../../scripts/build-info.mjs'

const deployBase = process.env.TINYTINKERER_DEPLOY_BASE?.replace(/\/+$/, '')
const base = deployBase ? `${deployBase}/mobile/` : '/mobile/'
const { appVersion, buildHash } = getBuildInfo()

export default defineConfig({
  base,
  define: {
    __APP_VERSION__: JSON.stringify(appVersion),
    __BUILD_HASH__: JSON.stringify(buildHash)
  },
  publicDir: '../../packages/brand-assets/assets/generated',
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      injectRegister: 'auto',
      registerType: 'autoUpdate',
      manifest: {
        name: 'tinytinkerer',
        short_name: 'tinytinkerer',
        description: 'Mobile-first TinyTinkerer workspace optimized for quick installs and narrow screens.',
        start_url: './#/',
        scope: './',
        display: 'standalone',
        background_color: '#fffaf5',
        theme_color: '#f6f2ec',
        icons: [
          {
            src: 'icon-192.png',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'any'
          },
          {
            src: 'icon-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any'
          },
          {
            src: 'icon-maskable-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable'
          }
        ]
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,webmanifest}'],
        globIgnores: ['**/assets/mermaid.min-*.js'],
        navigateFallback: 'index.html',
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024
      },
      devOptions: {
        enabled: true
      }
    })
  ],
  server: {
    host: 'localhost',
    proxy: {
      '/api': { target: 'http://localhost:8787', changeOrigin: true },
      '/auth/github/exchange': { target: 'http://localhost:8787', changeOrigin: true },
      '/health': { target: 'http://localhost:8787', changeOrigin: true }
    }
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
