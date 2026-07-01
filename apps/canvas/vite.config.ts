import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'
import { sentryVitePlugin } from '@sentry/vite-plugin'
import { getBuildInfo } from '../../scripts/build-info.mjs'
import { createBrowserShellViteConfig } from '../../scripts/browser-shell-vite.mjs'

export default defineConfig({
  ...createBrowserShellViteConfig({
    slug: 'canvas',
    buildInfo: getBuildInfo(),
    plugins: [react(), tailwindcss(), VitePWA({ disable: true })],
    sentryVitePlugin,
    server: { host: 'localhost' }
  }),
  // The Excalidraw whiteboard runs in a sandboxed iframe without `allow-same-origin`,
  // so it has an opaque origin and fetches its own ES-module assets in CORS mode
  // (Origin: null). `vite preview` must therefore send Access-Control-Allow-Origin or
  // the iframe never boots; production serves these assets with CORS, so this only
  // aligns local `vite preview` (and the e2e suite) with prod.
  preview: { headers: { 'Access-Control-Allow-Origin': '*' } }
})
