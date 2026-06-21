import type { PluginModule } from '@tinytinkerer/app-core'
import { useEffect, useState } from 'react'
import { loadPluginModules } from './registry'

// Discover the available plugin modules once and expose them to a host surface.
// Discovery itself is cached in ./registry, so multiple callers share a single
// load; this hook centralizes the load-once / cancel-on-unmount effect that the
// turn-activity panel, the status gauge, and the context inspector all need — each
// previously re-implemented it. Returns [] until discovery resolves; callers derive
// their own view from the manifests (a summarizer map, the first status/inspector
// descriptor, the settings list) with a memo.
export const usePluginModules = (): PluginModule[] => {
  const [modules, setModules] = useState<PluginModule[]>([])
  useEffect(() => {
    let cancelled = false
    void loadPluginModules().then((loaded) => {
      if (!cancelled) {
        setModules(loaded)
      }
    })
    return () => {
      cancelled = true
    }
  }, [])
  return modules
}
