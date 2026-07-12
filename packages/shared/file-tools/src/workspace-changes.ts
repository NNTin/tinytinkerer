import type { ApplyFileChangesInput } from './contracts'

export type FileSnapshot = Record<string, string>
export type WorkspaceChangeState = {
  files: FileSnapshot
  revisions: Record<string, number>
  deletedPaths: ReadonlySet<string>
}
export type WorkspaceChangeResult = {
  files: FileSnapshot
  revisions: Record<string, number>
  deletedPaths: Set<string>
  touchedPaths: string[]
}

export const getFileRevision = (
  revisions: Readonly<Record<string, number>>,
  path: string
): number => revisions[path] ?? 0

const countOccurrences = (value: string, search: string): number => value.split(search).length - 1

export const applyWorkspaceChanges = (
  state: WorkspaceChangeState,
  { changes }: ApplyFileChangesInput
): WorkspaceChangeResult => {
  const nextFiles = { ...state.files }
  const nextDeletedPaths = new Set(state.deletedPaths)
  const touchedPaths = new Set<string>()

  for (const change of changes) {
    if (change.kind === 'create') {
      if (change.path in nextFiles) throw new Error(`File already exists: ${change.path}`)
      nextFiles[change.path] = change.content
      nextDeletedPaths.delete(change.path)
      touchedPaths.add(change.path)
      continue
    }

    if (!(change.path in nextFiles)) throw new Error(`File does not exist: ${change.path}`)
    const actualRevision = getFileRevision(state.revisions, change.path)
    if (actualRevision !== change.expectedRevision) {
      throw new Error(
        `Revision conflict for ${change.path}: expected ${change.expectedRevision}, ` +
          `current ${actualRevision}. Re-read ${change.path} and recompute the change before retrying.`
      )
    }

    if (change.kind === 'replace') {
      nextFiles[change.path] = change.content
      touchedPaths.add(change.path)
    } else if (change.kind === 'edit') {
      const occurrences = countOccurrences(nextFiles[change.path] ?? '', change.oldText)
      if (occurrences === 0) throw new Error(`Text was not found in ${change.path}`)
      if (occurrences > 1 && !change.replaceAll) {
        throw new Error(`Text is ambiguous in ${change.path}; set replaceAll to edit every match`)
      }
      nextFiles[change.path] = change.replaceAll
        ? (nextFiles[change.path] ?? '').split(change.oldText).join(change.newText)
        : (nextFiles[change.path] ?? '').replace(change.oldText, change.newText)
      touchedPaths.add(change.path)
    } else if (change.kind === 'move') {
      if (change.destination in nextFiles) {
        throw new Error(`Destination already exists: ${change.destination}`)
      }
      nextFiles[change.destination] = nextFiles[change.path] ?? ''
      delete nextFiles[change.path]
      nextDeletedPaths.add(change.path)
      nextDeletedPaths.delete(change.destination)
      touchedPaths.add(change.path)
      touchedPaths.add(change.destination)
    } else {
      delete nextFiles[change.path]
      nextDeletedPaths.add(change.path)
      touchedPaths.add(change.path)
    }
  }

  const nextRevisions = { ...state.revisions }
  for (const path of touchedPaths) {
    if (path in nextFiles) nextRevisions[path] = getFileRevision(state.revisions, path) + 1
    else delete nextRevisions[path]
  }
  return {
    files: nextFiles,
    revisions: nextRevisions,
    deletedPaths: nextDeletedPaths,
    touchedPaths: [...touchedPaths]
  }
}

// Compatibility name used by the IDE before the logic became shared.
export const getIdeFileRevision = getFileRevision
