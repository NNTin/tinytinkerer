// Test-only, and the same arrangement as `@docs-test/react-router-dom` and
// `@docs-test/browser-runtime` — see those declarations for the rationale.
//
// #478's rendered-link policy runs on the parsed snapshots the assistant
// transcript mounts, including every partial one produced while an answer
// streams. Testing it against hand-built content nodes would assert what the
// test believes the parser produces; testing it against the real incremental
// session asserts what the renderer is really handed. apps/docs does not depend
// on `@tinytinkerer/content-markdown` (the runtime imports it dynamically from
// inside app-browser), so the specifier is aliased for tests rather than added
// as a dependency this application would never use at runtime.
declare module '@docs-test/content-markdown' {
  import type { ContentDocument } from '@tinytinkerer/app-browser'

  type Snapshot = { source: string; document: ContentDocument }

  export function createMarkdownContentSession(initialSource?: string): {
    append(chunk: string): Snapshot
    replace(source: string): Snapshot
    snapshot(): Snapshot
  }
}
