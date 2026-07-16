// Memoized so concurrent callers (e.g. parallel sendPrompt runs, issue #430)
// share one import promise instead of re-entering the dynamic-import machinery
// per call.
let coreModulePromise: Promise<typeof import('@tinytinkerer/app-core')> | undefined

export const loadCoreModule = () => (coreModulePromise ??= import('@tinytinkerer/app-core'))
