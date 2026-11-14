/**
 * `@nntin/tinytinkerer-embed/stage` — the stage helpers for a host's EAGER code
 * (issue #523, G1).
 *
 * A host's editor module installs its stage controller at startup —
 * `handle.setController(controller)` when the editor mounts — while the
 * assistant, and with it the runtime, is still behind a dynamic `import()`.
 * Which root exports a host's bundler can drop the runtime for is a build
 * detail that can change between releases; this subpath is the contract. It is
 * side-effect free and imports nothing: no React, no Zod, no stores.
 * `scripts/check-package.mjs` fails the build if its chunk graph grows past a
 * few kilobytes, and the acceptance host imports it eagerly and measures its own
 * startup chunk.
 *
 * The same functions are exported from the package root, which is unchanged; a
 * handle created here works with tools built from either entry.
 */
export { createStageControllerHandle, createStageTools } from '@tinytinkerer/app-shell/stage'
export type {
  CreateControllerStageToolsOptions,
  CreateStageToolsOptions,
  StageControllerHandle,
  StageControllerMethod,
  StageToolDefinition,
  StageToolRequestHandle
} from '@tinytinkerer/app-shell/stage'
