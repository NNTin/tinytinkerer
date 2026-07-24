import { join } from 'node:path'

// Docusaurus is built and served by its own toolchain, so it is deliberately
// separate from the Vite app inventory below. Production composition copies its
// static output into the host; local development reverse-proxies this mount to
// the standalone Docusaurus dev server.
export const DOCS_SITE_SPEC = Object.freeze({
  slug: 'docs',
  label: 'Docs',
  mountPath: '/docs/',
  source: 'docs',
  outputDir: 'build',
  devOrigin: 'http://127.0.0.1:3112',
  webSocketPath: '/ws'
})

// The host-owned route/build inventory. Dev serving, production composition,
// redirects, and host tests all consume this list so adding an app cannot leave
// one hosting mode behind.
//
// `source` is the apps/<source> package that provides the build. The three browser
// endpoints (web/widget/mobile) are ONE source — the single `apps/shell` build,
// served at all three mount paths and morphing between presentations at runtime.
// Integrated stages and the root `host` app are their own sources.
export const HOSTED_APP_SPECS = Object.freeze([
  { slug: 'canvas', label: 'Canvas', mountPath: '/canvas/', source: 'canvas' },
  { slug: 'ide', label: 'IDE', mountPath: '/ide/', source: 'ide' },
  { slug: 'mermaid', label: 'Mermaid', mountPath: '/mermaid/', source: 'mermaid' },
  {
    slug: 'pixel-agents',
    label: 'Pixel Agents',
    mountPath: '/pixel-agents/',
    source: 'pixel-agents'
  },
  { slug: 'mobile', label: 'Mobile', mountPath: '/mobile/', source: 'shell' },
  { slug: 'widget', label: 'Widget', mountPath: '/widget/', source: 'shell' },
  { slug: 'web', label: 'Web', mountPath: '/web/', source: 'shell' },
  // The root composition app (single document, all three shells over one shared
  // App). Its mountPath '/' matches every pathname in findTargetApp, so it MUST
  // stay last; the /<slug>/ prefixes above are matched first. It is the root Vite
  // app under apps/host itself, not a separate apps/<slug> shell.
  { slug: 'host', label: 'Root', mountPath: '/', source: 'host' }
])

/**
 * @param {string} rootDir
 * @returns {Array<{ slug: string, mountPath: string, root: string, base: string, server?: import('vite').ViteDevServer }>}
 */
export const createAppDefinitions = (rootDir) =>
  HOSTED_APP_SPECS.map(({ slug, mountPath, source }) => ({
    slug,
    mountPath,
    root: join(rootDir, 'apps', source),
    // In dev each mount runs its own Vite server rooted at its `source`, but the
    // shell source (base './' for production multi-path serving) needs its dev base
    // set to the mount path so module/asset URLs resolve under /web/, /widget/,
    // /mobile/. For canvas/host this equals the base already in their vite.config,
    // so overriding is a no-op there.
    base: mountPath
  }))
