// Test-only stand-in for the `@generated/globalData` Docusaurus virtual
// module — see the MDXComponents stub for why a plain Vite resolver needs an
// alias target at all. Tests mutate this same object (via `__setPluginData`/
// `__resetGlobalData`) rather than re-importing, since consumers hold a live
// binding to it.
type GlobalData = Record<string, Record<string, unknown> | undefined>

const globalData: GlobalData = {}

export const __setPluginData = (pluginName: string, pluginId: string, data: unknown): void => {
  globalData[pluginName] = { ...globalData[pluginName], [pluginId]: data }
}

export const __resetGlobalData = (): void => {
  for (const key of Object.keys(globalData)) {
    delete globalData[key]
  }
}

export default globalData
