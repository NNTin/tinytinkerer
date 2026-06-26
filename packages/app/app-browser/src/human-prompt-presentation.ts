import { useMemo } from 'react'
import {
  HUMAN_PROMPT_PRESENTATION_SETTING_KEY,
  type HumanPromptPresentation
} from '@tinytinkerer/contracts'
import { useSettingsStore } from './app'
import { useHumanPromptStore, type PendingHumanPrompt } from './human-prompt-bridge'

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
} => {
  const pending = useHumanPromptStore((state) => state.queue[0])
  const pluginConfig = useSettingsStore((state) => state.pluginConfig)
  const source = pending?.view.source
  const presentation = useMemo<HumanPromptPresentation>(() => {
    if (!source) return 'modal'
    return pluginConfig[source]?.[HUMAN_PROMPT_PRESENTATION_SETTING_KEY] === 'composer'
      ? 'composer'
      : 'modal'
  }, [source, pluginConfig])
  return { pending, presentation }
}
