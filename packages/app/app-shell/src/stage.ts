// The side-effect-free stage facade for embedding hosts (issue #523, G1),
// published as `@nntin/tinytinkerer-embed/stage`.
//
// A host's EAGER editor module installs its stage controller on a handle at
// startup, long before the assistant's runtime chunk is fetched. Importing the
// package root there would put the whole runtime in the host's startup bundle,
// so this module re-exports the two stage helpers and nothing else: both
// modules import only types, and the embed build's check-package.mjs asserts
// that the subpath's chunk graph stays that way.
export { createStageControllerHandle } from './stage-controller'
export type { StageControllerHandle, StageControllerMethod } from './stage-controller'
export { createStageTools } from './stage-tools'
export type {
  CreateControllerStageToolsOptions,
  CreateStageToolsOptions,
  StageToolDefinition,
  StageToolRequestHandle
} from './stage-tools'
