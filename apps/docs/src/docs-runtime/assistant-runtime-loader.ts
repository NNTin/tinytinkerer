/**
 * The single dynamic import of the assistant runtime chunk (issue #479).
 *
 * A module of its own for two reasons, both about honesty:
 *
 * 1. **A retry has to re-import.** `React.lazy` memoises rejection on its payload
 *    object, so remounting a boundary around one module-level `lazy(...)` rethrows
 *    the cached error without calling `import()` again — an "error, try again"
 *    status that could never succeed. The host builds a fresh payload from this
 *    loader per attempt instead.
 * 2. **A retry has to be testable.** With the `import()` behind a named export, a
 *    test can substitute a loader that fails once and succeeds next, and assert
 *    the loader really ran twice — rather than asserting that an enum changed.
 *
 * Light by construction: nothing here but the dynamic import, so importing this
 * module never pulls the product runtime.
 */
export const importAssistantRuntimeClient = (): Promise<{
  default: () => import('react').ReactNode
}> => import('./assistant-runtime-client')
