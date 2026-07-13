import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'
import { sentryVitePlugin } from '@sentry/vite-plugin'
import { getBuildInfo } from '../../scripts/build-info.mjs'
import { createBrowserShellViteConfig } from '../../scripts/browser-shell-vite.mjs'

export default defineConfig({
  ...createBrowserShellViteConfig({
    slug: 'pixel-agents',
    buildInfo: getBuildInfo(),
    plugins: [react(), tailwindcss(), VitePWA({ disable: true })],
    sentryVitePlugin,
    server: {
      host: 'localhost',
      // The stage embeds the upstream distribution in a sandboxed ('allow-scripts')
      // iframe, so its module-entry and font fetches carry `Origin: null`. Vite dev's
      // default CORS handling doesn't admit that origin. These are public static
      // assets, so ACAO '*' is never credentialed.
      headers: { 'Access-Control-Allow-Origin': '*' }
    }
  }),
  publicDir: 'generated'
})
