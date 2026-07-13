type ControllerMethodKey<TController extends object> = {
  [TKey in keyof TController]: TController[TKey] extends (...args: never[]) => unknown
    ? TKey
    : never
}[keyof TController]

export type StageControllerHandle<TController extends object> = {
  setController(controller: TController | null): void
  request(method: ControllerMethodKey<TController>, input?: unknown): Promise<unknown>
}

const normalizeError = (error: unknown): Error =>
  error instanceof Error ? error : new Error(String(error))

// Stable in-process indirection between tools created during shell bootstrap and a
// stage controller that mounts later. This is the trusted-stage equivalent of the
// iframe bridge handle, without transport or serialization concerns.
export const createStageControllerHandle = <TController extends object>(
  loadingMessage: string
): StageControllerHandle<TController> => {
  let controller: TController | null = null

  return {
    setController(next) {
      controller = next
    },
    request(method, input) {
      if (!controller) return Promise.reject(new Error(loadingMessage))
      const member = controller[method]
      if (typeof member !== 'function') {
        return Promise.reject(
          new Error(`Stage controller method is not callable: ${String(method)}`)
        )
      }
      try {
        return Promise.resolve(member.call(controller, input)).catch((error: unknown) =>
          Promise.reject(normalizeError(error))
        )
      } catch (error) {
        return Promise.reject(normalizeError(error))
      }
    }
  }
}
