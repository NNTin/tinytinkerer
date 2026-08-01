import { existsSync, readFileSync } from 'node:fs'
import { join, normalize, resolve } from 'node:path'
import { defineConfig, type Plugin } from 'vite'
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

/**
 * Serve the Docusaurus 404 document for a missing `/docs/*` URL, mirroring the
 * `rewrites` entry in vercel.json (issue #480 review, finding 2).
 *
 * Without it, `vite preview` answers an unknown path from its SPA fallback — the
 * ROOT composition's index.html — so an e2e that visits a broken documentation
 * link exercises the host's fallback instead of the documentation's 404 page, and
 * silently cannot see the assistant that is supposed to be on it. Production had
 * the same shape of gap for a different reason (Vercel's own plain-text
 * NOT_FOUND), which is what the deployment rewrite fixes.
 *
 * Scoped to `/docs/`: everything else keeps the existing fallback. The check is
 * done against the filesystem rather than by middleware ordering so a real
 * documentation page always wins, exactly as a rewrite does on the platform.
 *
 * The status is 404 here, where a plain Node response can set one. The
 * deployment's rewrite serves the same document with 200, because vercel.json
 * cannot attach a status to a rewrite without moving the whole file to the legacy
 * `routes` form, which cannot coexist with its `headers` block. Worth revisiting
 * if the crawler impact ever matters more than the config churn.
 */
const serveDocsNotFoundOnPreview = (): Plugin => ({
  name: 'serve-docs-not-found-on-preview',
  configurePreviewServer(server) {
    const dist = resolve(import.meta.dirname, 'dist')
    const notFoundPage = join(dist, 'docs', '404.html')

    server.middlewares.use((req, res, next) => {
      const pathname = (req.url ?? '').split('?')[0] ?? ''
      if (!pathname.startsWith('/docs/') || !existsSync(notFoundPage)) {
        next()
        return
      }
      // `normalize` collapses any `..` before the prefix check below, so a
      // traversal attempt cannot reach outside the built output.
      const candidate = normalize(join(dist, decodeURIComponent(pathname)))
      if (!candidate.startsWith(dist)) {
        next()
        return
      }
      if (existsSync(candidate) || existsSync(join(candidate, 'index.html'))) {
        next()
        return
      }
      res.statusCode = 404
      res.setHeader('Content-Type', 'text/html; charset=utf-8')
      res.end(readFileSync(notFoundPage))
    })
  }
})

export default defineConfig(() => {
  const shared = createBrowserShellViteConfig({
    slug: 'host',
    buildInfo: getBuildInfo(),
    plugins: [react(), tailwindcss(), VitePWA({ disable: true }), serveDocsNotFoundOnPreview()],
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
    },
    // e2e (and any local `vite preview`) serve the composed dist from this config.
    // The Pixel Agents mount's sandboxed iframe has an opaque origin, so its asset
    // fetches carry `Origin: null`; production (GitHub Pages) already answers with
    // ACAO '*', so dev/preview must match it here.
    preview: {
      headers: { 'Access-Control-Allow-Origin': '*' }
    }
  }
})
