// Pure, unit-testable recognizer for a fixed key sequence (the Konami code).
// Kept free of DOM/React so it can be exhaustively tested without a browser.

// Single-character keys are compared case-insensitively (so 'B'/'A' match
// regardless of shift/caps-lock); multi-character keys ('ArrowUp', etc.) are
// compared as-is since case doesn't vary for them.
const normalizeKey = (key: string): string => (key.length === 1 ? key.toLowerCase() : key)

// Returns a function that feeds one key at a time and reports whether the
// trailing keys now match `sequence`. The returned function closes over a
// rolling buffer that persists across calls — each `createKonamiRecognizer`
// call gets its own independent buffer.
//
// Implementation note: the buffer holds the last `sequence.length` normalized
// keys, and fires (then clears) exactly when it equals `sequence` — as opposed
// to an index that advances on a match and resets to 0 on a mismatch. A naive
// index-reset recognizer fails on inputs with an overlapping prefix, e.g.
// "Up Up Up Down Down Left Right Left Right b a": after the extra leading
// ArrowUp, an index-based matcher that reset to 0 on the "wrong" repeat would
// still be re-synchronizing when the real sequence starts, and can miss it. The
// rolling buffer sidesteps this entirely — it always holds exactly the last N
// keys, so it fires whenever THOSE N keys equal the sequence, regardless of what
// came before.
export const createKonamiRecognizer = (sequence: readonly string[]) => {
  const normalizedSequence = sequence.map(normalizeKey)
  const buffer: string[] = []

  return (key: string): boolean => {
    buffer.push(normalizeKey(key))
    if (buffer.length > normalizedSequence.length) {
      buffer.shift()
    }
    const matched =
      buffer.length === normalizedSequence.length &&
      buffer.every((k, i) => k === normalizedSequence[i])
    if (matched) {
      buffer.length = 0
    }
    return matched
  }
}
