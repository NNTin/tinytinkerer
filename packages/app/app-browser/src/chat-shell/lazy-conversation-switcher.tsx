import { lazy } from 'react'

// Lazy form of the conversation switcher (issue #430), mirroring
// LazyBrowserSettingsModal: the switcher ships in its own chunk so the
// tightly-budgeted chat-surface chunk only carries this wrapper. Both chat
// surfaces render it inside a `Suspense fallback={null}` — the trigger pops in
// once the (tiny) chunk loads, exactly like the plugin-gated header slots that
// render nothing until discovery resolves.
export const LazyConversationSwitcher = lazy(() =>
  import('./conversation-switcher').then((module) => ({
    default: module.ConversationSwitcher
  }))
)
