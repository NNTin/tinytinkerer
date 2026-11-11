/**
 * Disarming annotation markers in comment prose (issue #518, F13).
 *
 * Rollup reads `@__PURE__` anywhere in a comment as an annotation, so a comment
 * that merely MENTIONS one is an annotation in the wrong place, and a host's
 * build warns "contains an annotation that Rollup cannot interpret". The one
 * shipped is Zod's own JSDoc on its `anchor()` helper.
 *
 * A comment that is exactly an annotation — `/*#__PURE__*\/` or the spaced
 * `/* @__PURE__ *\/` esbuild and oxc emit — is left alone, or the call after it
 * would stop being pure for this build and every host's. In any other comment
 * the marker loses its sigil, which is all Rollup keys on. Only block comments
 * that open a line are rewritten: a bundled parser's string literals are full of
 * `/*`, and a line-leading doc comment is never one of them.
 */

const HAS_MARKER = /[#@]__(?:PURE|NO_SIDE_EFFECTS)__/
const MARKER = /[#@](__(?:PURE|NO_SIDE_EFFECTS)__)/g
const LINE_LEADING_PROSE_COMMENT = /^[ \t]*\/\*(?!\s*[#@]__[A-Z_]+__\s*\*\/)[\s\S]*?\*\//gm

/** `code` with every line-leading prose comment's annotation markers disarmed. */
export const disarmAnnotationProse = (code) =>
  HAS_MARKER.test(code)
    ? code.replace(LINE_LEADING_PROSE_COMMENT, (comment) => comment.replace(MARKER, '$1'))
    : code
