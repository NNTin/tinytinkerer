import { lazy } from 'react'

// Lazy like its mountGlobals siblings (LazyHumanPromptHost, the telemetry gates):
// the listener component plus the recognizer and konami-config it statically
// imports code-split into their own chunk instead of counting against every
// shell's entry-bundle budget (the canvas entry sits within ~1 kB of its 94 kB
// guard). The chunk still loads right after boot — the component mounts
// unconditionally so the window keydown listener is armed from the start; only
// the ENTRY size is spared. The preset/animation modules stay a second, deeper
// lazy layer that loads only when the sequence actually completes (see
// konami-cheat-code.tsx).
export const LazyKonamiCheatCode = lazy(() =>
  import('./konami-cheat-code').then((module) => ({
    default: module.KonamiCheatCode
  }))
)
