import type { ContentDocument, ToolSource } from '@tinytinkerer/contracts'

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
 *
 * `source` is the host's own attribution, stamped at registration. A policy that
 * decides how far to trust an output needs it because a tool **id is a name, not
 * an origin**: ids are registered into one space where the first writer wins, so
 * a plugin can claim an id an app also wanted, and a schema-compatible payload
 * from it would otherwise be indistinguishable from the real tool's. Absent for
 * a tool registered before provenance existed, which fails closed.
 */
export type AppToolResultRecord = {
  toolId: string
  output: unknown
  source?: ToolSource
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
   * Compiles a display-time sanitizer for one turn's results, then applies it to
   * every rendered snapshot of that turn.
   *
   * `finalizeAnswer` alone is not enough: it runs when the stream settles, so an
   * unauthorized link would be clickable for the seconds an answer is streaming.
   * This is the display-time counterpart.
   *
   * Two stages rather than one call per render, because the two inputs change at
   * completely different rates: a turn's results change once per tool
   * completion, while its document changes on every streamed chunk. Validating a
   * 20,000-character read against its schema on every delta is work proportional
   * to `result-size x chunks`; compiling once makes it proportional to
   * completions. The host memoizes the returned sanitizer on the results, so a
   * policy may do arbitrary preparation here and should keep the returned
   * function cheap.
   *
   * The sanitizer must return its document unchanged **by identity** when it
   * changes nothing, so an unaffected render is not invalidated.
   */
  prepareRenderedContent?: (input: {
    results: readonly AppToolResultRecord[]
  }) => (document: ContentDocument) => ContentDocument
}
