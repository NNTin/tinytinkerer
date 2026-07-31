/**
 * Deleting a documentation surface's own IndexedDB database (issue #479).
 *
 * Generalized from `live-lab/client-runtime.tsx`'s `resetDocsLabSession`, minus
 * the page reload: a lab embedded in one page can afford to reload, a site-wide
 * assistant cannot, and the two callers now want different things afterwards.
 * The deletion itself is identical, and it is deliberately the ONLY destructive
 * storage operation in the docs app — it names one database, so it can never
 * reach the product's own (`tinytinkerer`) or another docs surface's.
 */
export const deleteDocsStorageNamespace = (storageNamespace: string): Promise<void> =>
  new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase(storageNamespace)
    request.onsuccess = () => resolve()
    // A connection from this same page may still be open; the delete completes
    // once it closes, so this is not a failure.
    request.onblocked = () => resolve()
    request.onerror = () =>
      reject(request.error ?? new Error(`Failed to reset the ${storageNamespace} session.`))
  })
