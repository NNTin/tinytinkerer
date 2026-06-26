import { lazy } from 'react'

// Lazy so the human-prompt modal's heavier dependencies (the content-code CodeMirror
// view it uses to render a permission body) code-split into their own chunk instead of
// bloating every shell's entry bundle — the modal is mounted in the shell root but only
// renders when a plugin raises a prompt.
export const LazyHumanPromptHost = lazy(() =>
  import('./human-prompt-host').then((module) => ({
    default: module.HumanPromptHost
  }))
)
