import type { ExcalidrawImperativeAPI } from '@excalidraw/excalidraw/types'

type UpdateLibraryInput = Parameters<ExcalidrawImperativeAPI['updateLibrary']>[0]

// Count the items in a `.excalidrawlib` file (v2 `libraryItems`, legacy `library`).
// Best-effort: only used to ack how many items the import contained.
const countLibraryItems = (content: string): number => {
  try {
    const parsed = JSON.parse(content) as { libraryItems?: unknown; library?: unknown }
    const items = parsed.libraryItems ?? parsed.library
    return Array.isArray(items) ? items.length : 0
  } catch {
    return 0
  }
}

// Import a `.excalidrawlib` (raw JSON text) into the running canvas. The text is handed
// to Excalidraw's own Blob loader via `updateLibrary`, so parsing, normalization, and
// validation stay in the upstream component. Merges into (rather than replaces) the
// current library and opens the library menu so the user sees the result.
export const importLibraryContent = async (
  api: ExcalidrawImperativeAPI,
  content: string
): Promise<{ ok: true; imported: number }> => {
  const libraryItems = new Blob([content], {
    type: 'application/json'
  }) as unknown as UpdateLibraryInput['libraryItems']
  await api.updateLibrary({
    libraryItems,
    merge: true,
    openLibraryMenu: true,
    defaultStatus: 'published'
  })
  return { ok: true, imported: countLibraryItems(content) }
}
