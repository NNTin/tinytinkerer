const encoder = new TextEncoder()

export const serializedUtf8Bytes = (value: unknown): number =>
  encoder.encode(JSON.stringify(value)).byteLength

export const truncateUtf8 = (value: string, maximumBytes: number): string => {
  if (encoder.encode(value).byteLength <= maximumBytes) return value
  let result = ''
  let used = 0
  for (const character of value) {
    const characterBytes = encoder.encode(character).byteLength
    if (used + characterBytes > maximumBytes) break
    result += character
    used += characterBytes
  }
  return result
}

export const settleSerializedBytes = (value: {
  truncation: { serializedBytes: number }
}): number => {
  let previous = -1
  while (value.truncation.serializedBytes !== previous) {
    previous = value.truncation.serializedBytes
    value.truncation.serializedBytes = serializedUtf8Bytes(value)
  }
  return value.truncation.serializedBytes
}

// The one budget-trim policy shared by every paginated/bounded result: `build`
// produces a candidate for a given item count (and must settle its own
// `serializedBytes`); drop the trailing item until it fits, and throw if even the
// empty result overflows. Read verbs (`boundedResult`), the write receipt helper,
// and the audit/survey readers all funnel through this so the "shrink until it
// fits" invariant lives once.
export const trimToBudget = <T extends { truncation: { serializedBytes: number } }>(
  build: (count: number) => T,
  initialCount: number,
  budgetBytes: number
): T => {
  let count = initialCount
  let result = build(count)
  while (result.truncation.serializedBytes > budgetBytes && count > 0) {
    count -= 1
    result = build(count)
  }
  if (result.truncation.serializedBytes > budgetBytes)
    throw new Error(`result metadata exceeds the ${budgetBytes} byte payload budget`)
  return result
}
