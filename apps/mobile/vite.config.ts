import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'
import { sentryVitePlugin } from '@sentry/vite-plugin'
import { getBuildInfo } from '../../scripts/build-info.mjs'
import { createBrowserShellViteConfig } from '../../scripts/browser-shell-vite.mjs'

export default defineConfig(
  createBrowserShellViteConfig({
    slug: 'mobile',
    buildInfo: getBuildInfo(),
    publicDir: '../../packages/brand/brand-assets/assets/generated',
    plugins: [
      react(),
      tailwindcss(),
      VitePWA({
        // Registration is handled manually in src/app/register-pwa.ts so we can
        // drive update checks on foreground + on an interval. `null` prevents the
        // plugin from injecting a second, competing registration.
        injectRegister: null,
        registerType: 'autoUpdate',
        manifest: {
          name: 'tinytinkerer',
          short_name: 'tinytinkerer',
          description:
            'Mobile-first TinyTinkerer workspace optimized for quick installs and narrow screens.',
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
    sentryVitePlugin,
    server: {
      host: 'localhost',
      proxy: {
        '/api': { target: 'http://localhost:8787', changeOrigin: true },
        '/auth/github/exchange': { target: 'http://localhost:8787', changeOrigin: true },
        '/health': { target: 'http://localhost:8787', changeOrigin: true }
      }
    }
  })
)
