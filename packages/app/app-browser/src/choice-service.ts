import type { ChoicePromptRequest, ChoicePromptResult } from '@tinytinkerer/contracts'
import { createHumanPromptBridge, type PendingPrompt } from './human-prompt-bridge'

// The choice poll prompt (issue #85), built on the shared human-prompt bridge (see
// human-prompt-bridge.ts). The runtime factory wires `requestUserChoice` into the
// plugin host; the mounted <ChoicePromptModal /> subscribes via `useChoiceStore` and
// resolves each request with the user's answer. On run abort / conversation reset the
// chat-store calls resetAllHumanPrompts(), which settles any open poll as `dismissed`
// (the honest "the user didn't answer" default).
const bridge = createHumanPromptBridge<ChoicePromptRequest, ChoicePromptResult>({
  idPrefix: 'choice',
  resetValue: { kind: 'dismissed' }
})

// A choice poll awaiting a human answer — the bridge's pending-entry type specialised
// to this prompt. Re-exported under the stable name its consumers use.
export type PendingChoice = PendingPrompt<ChoicePromptRequest, ChoicePromptResult>

export const requestUserChoice = bridge.request
export const useChoiceStore = bridge.useStore

// Settle every pending choice as dismissed and clear the queue. Used as the test seam
// and reached in production through resetAllHumanPrompts (run abort / reset).
export const resetChoiceStore = bridge.reset
