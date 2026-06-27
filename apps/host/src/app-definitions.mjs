import { join } from 'node:path'

// The host-owned route/build inventory. Dev serving, production composition,
// redirects, and host tests all consume this list so adding an app cannot leave
// one hosting mode behind.
export const HOSTED_APP_SPECS = Object.freeze([
  { slug: 'canvas', mountPath: '/canvas/' },
  { slug: 'excalidraw-app', mountPath: '/excalidraw-app/' },
  { slug: 'mobile', mountPath: '/mobile/' },
  { slug: 'widget', mountPath: '/widget/' },
  { slug: 'web', mountPath: '/web/' }
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
