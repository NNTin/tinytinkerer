import type {
  AgentHookContribution,
  ChatEventHookContext,
  ToolExecutionContext,
  ToolGateResult
} from '@tinytinkerer/contracts'

export const runChatEventHooks = async (
  hooks: readonly AgentHookContribution[],
  context: ChatEventHookContext
): Promise<void> => {
  for (const hook of hooks) {
    if (hook.event !== 'chat.event') {
      continue
    }

    try {
      await hook.handler(context)
    } catch {
      // Observer hooks are best-effort and must not change runtime behavior.
    }
  }
}

// Message a human-in-the-loop gate (`awaitsHumanInput`) surfaces when its budget
// elapses. Unlike the internal "hook timed out" string, this is user-facing: it
// becomes the runtime's "Tool execution blocked: …" reason shown in the UI, so it
// must read as an explanation to the person who was asked to approve the tool.
const HUMAN_GATE_TIMEOUT_MESSAGE = 'Timed out waiting for your approval.'

export const runToolBeforeExecuteHooks = async (
  hooks: readonly AgentHookContribution[],
  context: ToolExecutionContext,
  timeoutMs: number,
  // Budget for gates that declare `awaitsHumanInput`. A human needs far longer
  // than a machine hook to read and approve a tool, so these get a separate,
  // much larger timeout. It is still bounded (not unbounded) because it doubles
  // as the fail-safe backstop for a host that never renders an approval UI — see
  // app-browser's permission-service. Defaults to the machine timeout when the
  // caller supplies none.
  humanInputTimeoutMs: number = timeoutMs
): Promise<ToolGateResult> => {
  for (const hook of hooks) {
    if (hook.event !== 'tool.beforeExecute') {
      continue
    }

    const awaitsHumanInput = hook.awaitsHumanInput === true
    const budget = awaitsHumanInput ? humanInputTimeoutMs : timeoutMs
    const timeoutMessage = awaitsHumanInput
      ? HUMAN_GATE_TIMEOUT_MESSAGE
      : 'tool.beforeExecute hook timed out'

    try {
      const result = await withTimeout(
        Promise.resolve(hook.handler(context)),
        budget,
        timeoutMessage
      )
      if (!result.allow) {
        return {
          allow: false,
          reason: normalizeDenyReason(result.reason)
        }
      }
    } catch (error) {
      return {
        allow: false,
        reason:
          error instanceof Error
            ? error.message
            : 'tool.beforeExecute hook failed'
      }
    }
  }

  return { allow: true }
}

const normalizeDenyReason = (reason: string): string => {
  const normalized = reason.trim()
  return normalized.length > 0 ? normalized : 'Tool execution denied'
}

const withTimeout = async <T>(
  promise: Promise<T>,
  timeoutMs: number,
  message: string
): Promise<T> => {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), timeoutMs)
      })
    ])
  } finally {
    if (timer) {
      clearTimeout(timer)
    }
  }
}
