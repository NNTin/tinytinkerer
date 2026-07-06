// Parse a JSON string without throwing, returning a discriminated result so the
// "parse failed" signal is explicit in the type (a parsed JSON value can itself
// be any `unknown`, including null, so a bare sentinel could not be narrowed).
// A malformed upstream body resolves to `{ ok: false }` and flows into the
// caller's typed upstream-failure response, instead of surfacing as an
// unhandled framework 500.
export type JsonParseResult = { ok: true; value: unknown } | { ok: false }

export const safeJsonParse = (raw: string): JsonParseResult => {
  try {
    return { ok: true, value: JSON.parse(raw) }
  } catch {
    return { ok: false }
  }
}
