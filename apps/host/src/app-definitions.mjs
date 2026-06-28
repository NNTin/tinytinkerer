import { join } from 'node:path'

// The host-owned route/build inventory. Dev serving, production composition,
// redirects, and host tests all consume this list so adding an app cannot leave
// one hosting mode behind.
export const HOSTED_APP_SPECS = Object.freeze([
  { slug: 'canvas', label: 'Canvas', mountPath: '/canvas/' },
  { slug: 'mobile', label: 'Mobile', mountPath: '/mobile/' },
  { slug: 'widget', label: 'Widget', mountPath: '/widget/' },
  { slug: 'web', label: 'Web', mountPath: '/web/' }
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
