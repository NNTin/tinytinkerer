/**
 * Test-only stand-in for the `@docusaurus/useGlobalData` alias — see the
 * MDXComponents stub for why a plain Vite resolver needs an alias target at all.
 *
 * This one is not a convenience: it is what lets `docs-page`'s tests drive the
 * *real* `@docusaurus/plugin-content-docs/client` (`useActiveDocContext` and the
 * upstream `matchPath` route matching underneath it) instead of a hand-rolled
 * imitation of Docusaurus' active-document rules. That client module reads its
 * versions and documents through exactly these three functions.
 *
 * The real module derives global data from the Docusaurus React context; that
 * context is provided by core's own `DocusaurusContextProvider`, which a plain
 * Vitest render has no way to mount. So the data lives in a mutable module
 * object here, with the same `failfast` semantics upstream implements.
 */
type PluginGlobalData = Record<string, unknown>

const globalData: Record<string, PluginGlobalData | undefined> = {}

export const __setDocusaurusGlobalData = (
  pluginName: string,
  pluginId: string,
  data: unknown
): void => {
  globalData[pluginName] = { ...globalData[pluginName], [pluginId]: data }
}

export const __resetDocusaurusGlobalData = (): void => {
  for (const key of Object.keys(globalData)) {
    delete globalData[key]
  }
}

export default function useGlobalData(): Record<string, PluginGlobalData | undefined> {
  return globalData
}

export function useAllPluginInstancesData(
  pluginName: string,
  options: { failfast?: boolean } = {}
): PluginGlobalData | undefined {
  const pluginGlobalData = globalData[pluginName]
  if (!pluginGlobalData && options.failfast) {
    throw new Error(`Docusaurus plugin global data not found for "${pluginName}" plugin.`)
  }
  return pluginGlobalData
}

export function usePluginData(
  pluginName: string,
  pluginId = 'default',
  options: { failfast?: boolean } = {}
): unknown {
  const pluginInstanceGlobalData = useAllPluginInstancesData(pluginName)?.[pluginId]
  if (!pluginInstanceGlobalData && options.failfast) {
    throw new Error(
      `Docusaurus plugin global data not found for "${pluginName}" plugin with id "${pluginId}".`
    )
  }
  return pluginInstanceGlobalData
}
