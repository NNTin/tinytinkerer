/**
 * Test-only stand-in for `@docusaurus/plugin-content-docs/client`, the module
 * src/docs-page reads the active document from.
 *
 * The package itself is real and installed, but its client barrel cannot be
 * loaded outside a Docusaurus webpack build: it re-exports `docsUtils`, which
 * pulls in `@docusaurus/renderRoutes` and `@docusaurus/theme-common/internal`,
 * and theme-common ships **untranspiled JSX inside `.js` files** for Docusaurus'
 * own build to compile. A plain Vite/Vitest resolver cannot parse that.
 *
 * So this re-implements exactly one hook, `useActiveDocContext`, and only its
 * three-line wrapper — verbatim from upstream's `lib/client/index.js`:
 *
 *     const data = useDocsData(pluginId)
 *     const { pathname } = useLocation()
 *     return getActiveDocContext(data, pathname)
 *
 * Everything that actually decides which document a route maps to
 * (`getActiveDocContext`, version sorting, `matchPath` exactness) is imported
 * from upstream's own `docsClientUtils.js`, which depends only on
 * `@docusaurus/router` and is therefore loadable as-is. That is the code
 * #476's route behavior is pinned against; nothing here imitates it.
 *
 * Keeping this in sync is part of upgrading Docusaurus: if `useActiveDocContext`
 * ever stops being that wrapper, update this file or the docs-page tests quietly
 * stop exercising real behavior.
 */
import type { ActiveDocContext, GlobalPluginData } from '@docusaurus/plugin-content-docs/client'
import { getActiveDocContext } from '@docusaurus/plugin-content-docs/lib/client/docsClientUtils.js'
import { useLocation } from '@docusaurus/router'
import { usePluginData } from './docusaurus-use-global-data-stub'

const DOCS_PLUGIN_NAME = 'docusaurus-plugin-content-docs'

export function useActiveDocContext(pluginId: string | undefined): ActiveDocContext {
  const data = usePluginData(DOCS_PLUGIN_NAME, pluginId, { failfast: true }) as GlobalPluginData
  const { pathname } = useLocation()
  return getActiveDocContext(data, pathname)
}
