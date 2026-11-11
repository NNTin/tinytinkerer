import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'
import { sentryVitePlugin } from '@sentry/vite-plugin'
import { getBuildInfo } from '../../scripts/build-info.mjs'
import { createBrowserShellViteConfig } from '../../scripts/browser-shell-vite.mjs'

// Sandpack reaches the `intersection-observer` polyfill through
// @react-hook/intersection-observer, which imports it for its side effect. The
// polyfill exits early wherever IntersectionObserver is native, which is every
// browser this build targets, so it was ~15 kB of dead code in the IDE stage
// chunk. Resolving it to an empty module drops that (issue #518, giving the
// stage budget in src/bundle-size.test.ts real headroom).
const noIntersectionObserverPolyfill = (): Plugin => ({
  name: 'tinytinkerer-ide:no-intersection-observer-polyfill',
  enforce: 'pre',
  resolveId: (id) => (id === 'intersection-observer' ? '\0ide-no-io-polyfill' : undefined),
  load: (id) => (id === '\0ide-no-io-polyfill' ? 'export {}' : undefined)
})

export default defineConfig({
  ...createBrowserShellViteConfig({
    slug: 'ide',
    buildInfo: getBuildInfo(),
    plugins: [noIntersectionObserverPolyfill(), react(), tailwindcss(), VitePWA({ disable: true })],
    sentryVitePlugin,
    server: { host: 'localhost' }
  })
})
