import { useMemo } from 'react'
import { useStore } from 'zustand'
import {
  HUMAN_PROMPT_PRESENTATION_SETTING_KEY,
  type HumanPromptPresentation
} from '@tinytinkerer/contracts'
import { useBrowserApp, useChatStore } from './app'
import { createHumanPromptStore, type PendingHumanPrompt } from './human-prompt-bridge'

// An app that declares `humanInput: false` has no queue, and a hook cannot be
// called conditionally — so reads for such an app fall through to this, which is
// empty and stays empty. Nothing can enqueue onto it: `request` is only ever
// handed out from the store `createBrowserApp` built for an app that declares
// the capability, and this one is never given to anybody.
//
// This is the ONLY fallback here. An app is still required: every surface that
// draws a prompt lives under an `AppBrowserProvider`, and briefly tolerating its
// absence — to spare a layout unit test from mounting one — turned a broken
// composition into a silent no-op.
const NO_QUEUE = createHumanPromptStore()

/**
 * The head-of-queue prompt and WHERE it should be drawn — the half of the
 * resolution that callers other than the two renderers need.
 *
 * Split out for issue #498: `ChatAppLayout` has to know that a `composer` prompt
 * is waiting so a minimized floating widget can raise an attention badge, and it
 * has no use for the conversation label. Deriving that from a second source, or
 * copying the `pluginConfig` lookup, would have given the same question two
 * answers that could disagree.
 *
 * The presentation is a per-plugin setting: the view carries the originating
 * plugin id as `source`, and the reader's stored choice for that plugin
 * (`pluginConfig[source].presentation`) selects the surface. `'modal'` is the safe
 * universal default — a view with no source (the permissions prompt) or no stored
 * choice is always the modal.
 */
export const useHumanPromptSurface = (): {
  pending: PendingHumanPrompt | undefined
  presentation: HumanPromptPresentation
} => {
  const app = useBrowserApp()
  const pending = useStore(app.stores.humanPrompts ?? NO_QUEUE, (state) => state.queue[0])
  const source = pending?.view.source
  // Selects the RESOLVED presentation rather than subscribing to the whole
  // `pluginConfig`: any unrelated plugin setting a reader changes would otherwise
  // re-render both renderers and — since #498 — every chat surface.
  const presentation = useStore(app.stores.settings, (state): HumanPromptPresentation => {
    if (!source) return 'modal'
    return state.pluginConfig[source]?.[HUMAN_PROMPT_PRESENTATION_SETTING_KEY] === 'composer'
      ? 'composer'
      : 'modal'
  })
  return { pending, presentation }
}

// Resolves the head-of-queue human prompt, where to draw it, and which
// conversation is asking (issue #85). The two renderers (HumanPromptHost = modal,
// HumanPromptComposerDock = composer) both call this and each renders only when
// the resolved presentation matches, so exactly one shows.
export const useHumanPromptPresentation = (): {
  pending: PendingHumanPrompt | undefined
  presentation: HumanPromptPresentation
  // The originating conversation's title (issue #430), so the renderer can tell the
  // user WHICH conversation is asking. Only set when there is something to
  // disambiguate: the store manages more than one conversation AND the prompt's
  // scope still names one of them (a conversation deleted mid-prompt resolves to
  // undefined, same as no scope). undefined with a single conversation, matching
  // pre-#430 behavior exactly (nothing new renders).
  conversationLabel: string | undefined
} => {
  const { pending, presentation } = useHumanPromptSurface()
  const conversations = useChatStore((state) => state.conversations)
  const scope = pending?.scope
  const conversationLabel = useMemo(() => {
    if (!scope || Object.keys(conversations).length <= 1) return undefined
    return conversations[scope]?.title
  }, [scope, conversations])
  return { pending, presentation, conversationLabel }
}
