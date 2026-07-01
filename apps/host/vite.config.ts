import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'
import { sentryVitePlugin } from '@sentry/vite-plugin'
import { getBuildInfo } from '../../scripts/build-info.mjs'
import { createBrowserShellViteConfig } from '../../scripts/browser-shell-vite.mjs'

// The root composition app: unlike the four shells it is served at the site root
// (base '/'), and it builds to `dist-root` so it never collides with `dist`, which
// build-pages composes (root + each /<slug>/ shell) into the deployed output.
const deployBase = process.env.TINYTINKERER_DEPLOY_BASE?.replace(/\/+$/, '')

export default defineConfig(() => {
  const shared = createBrowserShellViteConfig({
    slug: 'host',
    buildInfo: getBuildInfo(),
    plugins: [react(), tailwindcss(), VitePWA({ disable: true })],
    sentryVitePlugin,
    server: {
      host: 'localhost'
    }
  })

  return {
    ...shared,
    base: deployBase ? `${deployBase}/` : '/',
    build: {
      ...shared.build,
      outDir: 'dist-root'
    }
  }
})
