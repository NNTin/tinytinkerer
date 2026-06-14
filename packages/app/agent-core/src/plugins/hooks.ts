import type {
  AgentHookContribution,
  ChatEventHookContext,
  ToolExecutionContext,
  ToolGateResult
} from './types'

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

export const runToolBeforeExecuteHooks = async (
  hooks: readonly AgentHookContribution[],
  context: ToolExecutionContext,
  timeoutMs: number
): Promise<ToolGateResult> => {
  for (const hook of hooks) {
    if (hook.event !== 'tool.beforeExecute') {
      continue
    }

    try {
      const result = await withTimeout(
        Promise.resolve(hook.handler(context)),
        timeoutMs,
        'tool.beforeExecute hook timed out'
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
