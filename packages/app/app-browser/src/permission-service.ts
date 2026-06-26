import type { PermissionRequest, ToolGateResult } from '@tinytinkerer/app-core'
import { createHumanPromptBridge, type PendingPrompt } from './human-prompt-bridge'

// The permissions allow/deny prompt, built on the shared human-prompt bridge (see
// human-prompt-bridge.ts). The runtime factory wires `requestPermission` into the
// plugin host; the mounted <PermissionModal /> subscribes via `usePermissionStore`
// and resolves each request with the user's Allow/Deny choice. On run abort /
// conversation reset the chat-store calls resetAllHumanPrompts(), which settles any
// pending permission as a denial (the safe default for an unanswered gate).
const bridge = createHumanPromptBridge<PermissionRequest, ToolGateResult>({
  idPrefix: 'perm',
  resetValue: { allow: false, reason: 'cancelled' }
})

// A permission request awaiting a human decision — the bridge's pending-entry type
// specialised to this prompt. Re-exported under the stable name its consumers use.
export type PendingPermission = PendingPrompt<PermissionRequest, ToolGateResult>

export const requestPermission = bridge.request
export const usePermissionStore = bridge.useStore

// Settle every pending permission as denied and clear the queue. Used as the test
// seam and reached in production through resetAllHumanPrompts (run abort / reset).
export const resetPermissionStore = bridge.reset
