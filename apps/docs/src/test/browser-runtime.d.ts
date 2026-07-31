// Test-only. The documentation assistant's conversation test (issue #478) has
// to drive the REAL runtime — the one that composes the three system prompts,
// executes the tools, and applies the app's answer finalizer — because the whole
// point of that test is that the grounding policy reaches every outgoing request
// and the citation policy reaches the persisted answer. A stand-in runtime would
// only assert that the test's own imitation behaves as the test expects.
//
// `createRuntime` is not on `@tinytinkerer/app-browser`'s barrel, and the barrel
// is unloadable outside a Vite app build anyway (it reaches
// `virtual:pwa-register`). Rather than widen the package's public surface for a
// test, apps/docs/vitest.config.ts resolves this specifier to the module itself
// — exactly the arrangement `@docs-test/react-router-dom` already uses, and for
// the same reason: a test needs the real implementation, not a second pinned
// copy of its contract.
//
// Only the surface the test drives is declared. Anything else it needed would
// have to be added here deliberately, which is the intended friction.
declare module '@docs-test/browser-runtime' {
  import type {
    AppAssistantPolicy,
    AppToolGroup,
    ChatEvent,
    AgentType
  } from '@tinytinkerer/app-browser'

  export function createRuntime(options: {
    baseUrl: string
    getToken: () => string | null | undefined
    getModel: () => string | null | undefined
    agentType?: AgentType
    appToolGroup?: AppToolGroup
    appAssistantPolicy?: AppAssistantPolicy
  }): {
    run: (prompt: string, options?: { signal?: AbortSignal }) => AsyncGenerator<ChatEvent>
  }
}
