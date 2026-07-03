import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'
import { sentryVitePlugin } from '@sentry/vite-plugin'
import { getBuildInfo } from '../../scripts/build-info.mjs'
import { createBrowserShellViteConfig } from '../../scripts/browser-shell-vite.mjs'

// The single browser shell. ONE build is served at /web/, /widget/, and /mobile/
// (the host composer copies this `dist` into each /<slug>/ directory), and the
// presentation is chosen at runtime from the URL path (see src/presentations.ts).
const shared = createBrowserShellViteConfig({
  slug: 'shell',
  buildInfo: getBuildInfo(),
  // Brand-generated PWA icons for the mobile install experience.
  publicDir: '../../packages/brand/brand-assets/assets/generated',
  plugins: [
    react(),
    tailwindcss(),
    // Emits the mobile PWA's service worker + manifest. Registration is manual
    // (createBrowserShellRoot → registerPwa) and gated to the mobile presentation
    // only (registerServiceWorker), so /web/ and /widget/ never adopt the SW even
    // though they share this origin and bundle. `scope`/`start_url` are relative so
    // the SW registers under whichever path serves it (always /mobile/ here), which
    // keeps it correct under any TINYTINKERER_DEPLOY_BASE sub-path too.
    VitePWA({
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
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: 'icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }
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

export default defineConfig({
  ...shared,
  // A relative base makes the emitted asset URLs resolve correctly when the exact
  // same build is served from /web/, /widget/, and /mobile/ (and under any deploy
  // sub-path). The factory's default `/shell/` base would only work at one path.
  base: './'
})
