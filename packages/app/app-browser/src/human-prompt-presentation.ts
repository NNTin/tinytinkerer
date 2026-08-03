import { useMemo } from 'react'
import { useStore } from 'zustand'
import { createStore } from 'zustand/vanilla'
import {
  HUMAN_PROMPT_PRESENTATION_SETTING_KEY,
  type HumanPromptPresentation,
  type PluginConfigState
} from '@tinytinkerer/contracts'
import { useChatStore, useOptionalBrowserApp } from './app'
import {
  createHumanPromptStore,
  type HumanPromptState,
  type PendingHumanPrompt
} from './human-prompt-bridge'

// An app with no human-input capability has no queue, and a hook cannot be
// called conditionally — so reads for such an app fall through to this, which is
// empty and stays empty. Nothing can enqueue onto it: `request` is only ever
// handed out from the store `createBrowserApp` built for an app that declares
// the capability, and this one is never given to anybody.
//
// A surface rendered with no app in context at all lands here too. That is the
// same answer for the same reason — no app, no queue, nothing to draw — and it
// keeps a layout-only consumer from having to mount a provider just to be told
// there are no prompts.
const NO_QUEUE = createHumanPromptStore()

// The settings half of the same "no app in context" answer. `useSettingsStore`
// requires a provider, and `useHumanPromptSurface` is now called from
// `ChatAppLayout`, which a layout-only consumer can render without one. With no
// app there is no prompt either, so the only correct value here is "no stored
// choice" — which resolves to the universal `modal` default and is never read,
// because nothing is pending.
const NO_PLUGIN_CONFIG = createStore<{ pluginConfig: PluginConfigState }>(() => ({
  pluginConfig: {}
}))

// Subscription hook the two renderers use to read the head-of-queue prompt.
//
// It resolves the queue from the app in context (issue #489), which is what
// makes both renderers correct by construction: a prompt is drawn by the session
// that raised it, using that session's plugin settings and conversation titles,
// because that session's queue is the only one a mounted reader can reach.
//
// Lives here rather than in `human-prompt-bridge.ts` so the bridge stays a plain
// store factory with no import back into `./app` — the same cycle
// `pre-send-disclosure-key.ts` exists to avoid.
export const useHumanPromptStore = <T>(selector: (state: HumanPromptState) => T): T =>
  useStore(useOptionalBrowserApp()?.stores.humanPrompts ?? NO_QUEUE, selector)

// Resolves the head-of-queue human prompt and WHERE the host should draw it (issue
// #85). The presentation is a per-plugin setting: the view carries the originating
// plugin id as `source`, and the user's stored choice for that plugin
// (`pluginConfig[source].presentation`) selects the surface. `'modal'` is the safe
// universal default — a view with no source (the permissions prompt) or no stored
// choice is always the modal. The two renderers (HumanPromptHost = modal,
// HumanPromptComposerDock = composer) both call this and each renders only when the
// resolved presentation matches, so exactly one shows.
/**
 * The head-of-queue prompt and WHERE it should be drawn — the half of the
 * resolution that callers other than the two renderers need.
 *
 * Split out for issue #498: `ChatAppLayout` has to know that a `composer` prompt
 * is waiting so a minimized floating widget can raise an attention badge, and it
 * has no use for the conversation label. Deriving that from a second source, or
 * copying the `pluginConfig` lookup, would have given the same question two
 * answers that could disagree.
 */
export const useHumanPromptSurface = (): {
  pending: PendingHumanPrompt | undefined
  presentation: HumanPromptPresentation
} => {
  const app = useOptionalBrowserApp()
  const pending = useStore(app?.stores.humanPrompts ?? NO_QUEUE, (state) => state.queue[0])
  const pluginConfig = useStore(
    app?.stores.settings ?? NO_PLUGIN_CONFIG,
    (state) => state.pluginConfig
  )
  const source = pending?.view.source
  const presentation = useMemo<HumanPromptPresentation>(() => {
    if (!source) return 'modal'
    return pluginConfig[source]?.[HUMAN_PROMPT_PRESENTATION_SETTING_KEY] === 'composer'
      ? 'composer'
      : 'modal'
  }, [source, pluginConfig])
  return { pending, presentation }
}

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
