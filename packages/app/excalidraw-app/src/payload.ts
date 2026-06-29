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
