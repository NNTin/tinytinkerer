// Stable id minting shared by the write verbs. Ids are prefixed so generated
// elements, connectors, and groups are easy to recognize, and checked against a
// `used` set so a batch never collides with the existing scene or itself.
const randomSuffix = (): string => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function')
    return crypto.randomUUID()
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
}

export const uniqueId = (prefix: string, used: Set<string>): string => {
  let id: string
  do {
    id = `${prefix}-${randomSuffix()}`
  } while (used.has(id))
  used.add(id)
  return id
}
