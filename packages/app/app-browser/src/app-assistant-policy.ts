import type { ContentDocument } from '@tinytinkerer/contracts'

/**
 * What an app may contribute to its own assistant's reasoning and answers
 * (issue #478), beyond the tools it registers.
 *
 * The documentation assistant has to ground every cross-page claim in a
 * clickable authored-docs link and must never leave a fabricated one clickable.
 * None of that belongs in the shared prompts or the shared renderer, so this is
 * the seam: an app supplies a policy, and an app that supplies none — canvas,
 * mermaid, web, widget, mobile — sends byte-identical prompts and renders
 * byte-identical answers to before.
 *
 * Lives in its own module (rather than app.ts) for the same reason
 * `app-tool-group.ts` does: the chat store and the runtime import it, and
 * app.ts imports them.
 */

/**
 * A tool result a policy is allowed to build on.
 *
 * The two omissions are the contract, not an oversight:
 *
 * - only **successful** results are ever passed, so "a failed result can never
 *   create a citation" is a property of the type rather than of a check every
 *   policy has to remember;
 * - the tool's **input** is deliberately absent. A citation composed from what
 *   the model *asked for* is a citation composed from model text. Withholding
 *   the input makes that structurally impossible instead of merely forbidden.
 */
export type AppToolResultRecord = {
  toolId: string
  output: unknown
}

/** The three model-facing prompts an app can contribute instructions to. */
export type AppInstructionBoundary = 'planning' | 'decision' | 'synthesis'

export type AppAssistantPolicy = {
  /**
   * Extra system instructions for one reasoning boundary, appended to that
   * boundary's shared prompt.
   *
   * `toolIds` are the tools that actually **registered** for this run — after
   * the tool picker's per-tool disablement — so instructions never advertise a
   * tool the model cannot call.
   */
  instructions?: (input: {
    boundary: AppInstructionBoundary
    toolIds: readonly string[]
  }) => string | undefined

  /**
   * Rewrites the composed answer once, before it is persisted. Runs at
   * agent-core's synthesis boundary (see `AssistantContentFinalizer`), the only
   * point that has the whole answer and can replace it.
   */
  finalizeAnswer?: (input: {
    source: string
    results: readonly AppToolResultRecord[]
  }) => string | Promise<string>

  /**
   * Rewrites a *rendered* snapshot of an answer, live and after reload.
   *
   * `finalizeAnswer` alone is not enough: it runs when the stream settles, so
   * an unauthorized link would be clickable for the seconds the answer is
   * streaming. This is the display-time counterpart, applied to every snapshot
   * of the parsed document; it must return the document unchanged (by
   * identity) when it changes nothing, so a settled turn's memoized render is
   * not invalidated on every keystroke of the next one.
   */
  sanitizeRenderedContent?: (input: {
    document: ContentDocument
    results: readonly AppToolResultRecord[]
  }) => ContentDocument
}
