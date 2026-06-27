import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'
import { sentryVitePlugin } from '@sentry/vite-plugin'
import { getBuildInfo } from '../../scripts/build-info.mjs'
import { createBrowserShellViteConfig } from '../../scripts/browser-shell-vite.mjs'

export default defineConfig(
  createBrowserShellViteConfig({
    slug: 'canvas',
    buildInfo: getBuildInfo(),
    plugins: [react(), tailwindcss(), VitePWA({ disable: true })],
    sentryVitePlugin,
    server: { host: 'localhost' }
  })
)
