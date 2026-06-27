import { browserShellManualChunks } from './browser-shell-chunks.mjs'

// Shared build composition for chat-bearing browser shells. Each app still owns
// its shell-specific plugins (notably mobile PWA configuration) and dev server,
// while deployment base, build identity, Sentry ordering, source-map policy, and
// chunk policy stay uniform.
export const createBrowserShellViteConfig = ({
  slug,
  buildInfo,
  plugins,
  server,
  sentryVitePlugin,
  publicDir
}) => {
  const deployBase = process.env.TINYTINKERER_DEPLOY_BASE?.replace(/\/+$/, '')
  const sentryAuthToken = process.env.SENTRY_AUTH_TOKEN
  const sentryEnabled = Boolean(sentryAuthToken)

  return {
    base: deployBase ? `${deployBase}/${slug}/` : `/${slug}/`,
    define: {
      __APP_VERSION__: JSON.stringify(buildInfo.appVersion),
      __BUILD_HASH__: JSON.stringify(buildInfo.buildHash)
    },
    ...(publicDir ? { publicDir } : {}),
    plugins: [
      ...plugins,
      ...(sentryEnabled
        ? [
            sentryVitePlugin({
              org: 'nntin-labs',
              project: 'tinytinkerer-frontend',
              authToken: sentryAuthToken,
              release: { name: buildInfo.buildHash, setCommits: { auto: true } },
              sourcemaps: { filesToDeleteAfterUpload: ['./dist/**/*.map'] }
            })
          ]
        : [])
    ],
    server,
    build: {
      sourcemap: sentryEnabled ? 'hidden' : false,
      rollupOptions: {
        output: { manualChunks: browserShellManualChunks }
      }
    }
  }
}
