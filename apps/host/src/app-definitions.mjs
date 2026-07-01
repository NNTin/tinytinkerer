import { join } from 'node:path'

// The host-owned route/build inventory. Dev serving, production composition,
// redirects, and host tests all consume this list so adding an app cannot leave
// one hosting mode behind.
export const HOSTED_APP_SPECS = Object.freeze([
  { slug: 'canvas', label: 'Canvas', mountPath: '/canvas/' },
  { slug: 'mobile', label: 'Mobile', mountPath: '/mobile/' },
  { slug: 'widget', label: 'Widget', mountPath: '/widget/' },
  { slug: 'web', label: 'Web', mountPath: '/web/' },
  // The root composition app (single document, all three shells over one shared
  // App). Its mountPath '/' matches every pathname in findTargetApp, so it MUST
  // stay last; the /<slug>/ prefixes above are matched first. It is the root Vite
  // app under apps/host itself, not a separate apps/<slug> shell.
  { slug: 'host', label: 'Root', mountPath: '/' }
])

/**
 * @param {string} rootDir
 * @returns {Array<{ mountPath: string, root: string, server?: import('vite').ViteDevServer }>}
 */
export const createAppDefinitions = (rootDir) =>
  HOSTED_APP_SPECS.map(({ slug, mountPath }) => ({
    mountPath,
    root: join(rootDir, 'apps', slug)
  }))
