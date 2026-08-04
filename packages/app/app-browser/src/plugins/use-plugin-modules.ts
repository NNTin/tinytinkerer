import type { PluginModule } from '@tinytinkerer/app-core'
import { useEffect, useState } from 'react'
import { useBrowserApp } from '../app'

// Load THIS app's plugin modules once and expose them to a host surface.
//
// The catalogue is per `BrowserApp` (issue #495) and reached from context, not
// from a module-global registry: a document can hold several apps — the
// documentation assistant beside its live labs — and a surface must see the
// plugins of the app it is mounted under, not the document's. Reading it from
// context rather than taking it as a prop is what keeps that true without every
// call site having to know it: the turn-activity panel, the status gauge, the
// context inspector, the tool tree, the empty state and the settings list all
// call this unchanged.
//
// Loading itself is memoized on the app, so multiple callers share a single
// load; this hook centralizes the load-once / cancel-on-unmount effect each of
// those surfaces would otherwise re-implement. Returns [] until the load
// resolves; callers derive their own view from the manifests (a summarizer map,
// the first status/inspector descriptor, the settings list) with a memo.
export const usePluginModules = (): PluginModule[] => {
  const { loadPlugins } = useBrowserApp()
  const [modules, setModules] = useState<PluginModule[]>([])
  useEffect(() => {
    let cancelled = false
    void loadPlugins().then((loaded) => {
      if (!cancelled) {
        setModules(loaded)
      }
    })
    return () => {
      cancelled = true
    }
  }, [loadPlugins])
  return modules
}
