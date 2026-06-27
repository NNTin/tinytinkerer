import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'
import { sentryVitePlugin } from '@sentry/vite-plugin'
import { getBuildInfo } from '../../scripts/build-info.mjs'
import { createBrowserShellViteConfig } from '../../scripts/browser-shell-vite.mjs'

export default defineConfig(
  createBrowserShellViteConfig({
    slug: 'widget',
    buildInfo: getBuildInfo(),
    plugins: [
      react(),
      tailwindcss(),
      // Provides the `virtual:pwa-register` module so the shared bootstrap's
      // `registerPwa()` call resolves uniformly across shells. `disable: true`
      // emits no service worker — registerSW resolves to a no-op — so the widget
      // ships no PWA. Whether a shell is installable is purely this build-time
      // choice.
      VitePWA({ disable: true })
    ],
    sentryVitePlugin,
    server: {
      host: 'localhost'
    }
  })
)
