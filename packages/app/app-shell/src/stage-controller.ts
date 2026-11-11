/** The keys of `TController` whose values are methods: what a handle can `request`. */
export type StageControllerMethod<TController extends object> = {
  [TKey in keyof TController]: TController[TKey] extends (...args: never[]) => unknown
    ? TKey
    : never
}[keyof TController]

export type StageControllerHandle<TController extends object> = {
  setController(controller: TController | null): void
  request(method: StageControllerMethod<TController>, input?: unknown): Promise<unknown>
}

const normalizeError = (error: unknown): Error =>
  error instanceof Error ? error : new Error(String(error))

/**
 * A stable handle to a stage controller that mounts later: tools built at
 * startup call `request(method, input)`, and the stage calls
 * `setController(controller)` when it mounts (and `setController(null)` when it
 * unmounts). Until then every request rejects with `notMountedMessage`, which
 * the model reads as the tool's error.
 *
 * In-process indirection, not a transport: the controller is trusted, and
 * inputs and outputs are passed by reference.
 */
export const createStageControllerHandle = <TController extends object>(
  notMountedMessage: string
): StageControllerHandle<TController> => {
  let controller: TController | null = null

  return {
    setController(next) {
      controller = next
    },
    request(method, input) {
      if (!controller) return Promise.reject(new Error(notMountedMessage))
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
