import { beforeEach, describe, expect, it } from 'vitest'
import { loadPluginModules, resetPluginModuleCache } from '../src/plugins/registry.js'

describe('loadPluginModules', () => {
  beforeEach(() => {
    resetPluginModuleCache()
  })

  it('discovers workspace plugins dynamically without a static import', async () => {
    const modules = await loadPluginModules()

    // The feedback plugin lives in packages/plugins and is found purely via the
    // import.meta.glob discovery — app-browser never imports it by name.
    expect(modules.map((mod) => mod.manifest.id)).toContain('send-feedback')
    for (const mod of modules) {
      expect(typeof mod.createPlugin).toBe('function')
      expect(typeof mod.manifest.label).toBe('string')
    }
  })

  it('memoizes discovery across calls', async () => {
    const first = await loadPluginModules()
    const second = await loadPluginModules()
    expect(first).toBe(second)
  })
})
