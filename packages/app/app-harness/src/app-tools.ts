import type { Tool } from '@tinytinkerer/app-browser'
import type { AppBridgeHandle } from './bridge-handle'

// One verb the harness exposes to the chat model as an always-on tool. The model
// sees `description` plus the JSON Schema derived from `schema` (the same canonical
// Zod → JSON Schema path plugin tools use, issue #287); at call time the input is
// validated against `schema` by the runtime before `execute` runs. Keeping the
// schema type as `Tool['schema']` means the harness needs no direct Zod dependency
// and never drifts from the runtime's tool contract.
export type VerbDefinition = {
  description: string
  schema: Tool<unknown, unknown>['schema']
}

export type AppToolsFromVerbsOptions = {
  handle: AppBridgeHandle
  verbs: Record<string, VerbDefinition>
}

// Turn an app's declared verbs into the `appTools` array for
// `createBrowserShellRoot({ appTools })`. Each tool forwards to the shared bridge
// handle, which rejects with an actionable message if the verb is called before
// the app is ready (or after it became unavailable) — so the model gets a clear
// error instead of a hang.
export const appToolsFromVerbs = ({
  handle,
  verbs
}: AppToolsFromVerbsOptions): Tool<unknown, unknown>[] =>
  Object.entries(verbs).map(([verb, definition]) => ({
    id: verb,
    description: definition.description,
    schema: definition.schema,
    execute: (input: unknown) => handle.request(verb, input)
  }))
