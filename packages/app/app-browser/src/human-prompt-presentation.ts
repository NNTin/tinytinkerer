import { useMemo } from 'react'
import { useStore } from 'zustand'
import {
  HUMAN_PROMPT_PRESENTATION_SETTING_KEY,
  type HumanPromptPresentation
} from '@tinytinkerer/contracts'
import { useBrowserApp, useChatStore, useSettingsStore } from './app'
import type { HumanPromptState, PendingHumanPrompt } from './human-prompt-bridge'

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
  useStore(useBrowserApp().stores.humanPrompts, selector)

// Resolves the head-of-queue human prompt and WHERE the host should draw it (issue
// #85). The presentation is a per-plugin setting: the view carries the originating
// plugin id as `source`, and the user's stored choice for that plugin
// (`pluginConfig[source].presentation`) selects the surface. `'modal'` is the safe
// universal default — a view with no source (the permissions prompt) or no stored
// choice is always the modal. The two renderers (HumanPromptHost = modal,
// HumanPromptComposerDock = composer) both call this and each renders only when the
// resolved presentation matches, so exactly one shows.
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
  const pending = useHumanPromptStore((state) => state.queue[0])
  const pluginConfig = useSettingsStore((state) => state.pluginConfig)
  const conversations = useChatStore((state) => state.conversations)
  const source = pending?.view.source
  const presentation = useMemo<HumanPromptPresentation>(() => {
    if (!source) return 'modal'
    return pluginConfig[source]?.[HUMAN_PROMPT_PRESENTATION_SETTING_KEY] === 'composer'
      ? 'composer'
      : 'modal'
  }, [source, pluginConfig])
  const scope = pending?.scope
  const conversationLabel = useMemo(() => {
    if (!scope || Object.keys(conversations).length <= 1) return undefined
    return conversations[scope]?.title
  }, [scope, conversations])
  return { pending, presentation, conversationLabel }
}
