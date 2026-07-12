export type IdeFileTreeNode =
  | {
      kind: 'directory'
      name: string
      path: string
      children: IdeFileTreeNode[]
    }
  | {
      kind: 'file'
      name: string
      path: string
    }

type DirectoryEntry = {
  name: string
  path: string
  directories: Map<string, DirectoryEntry>
  files: Map<string, IdeFileTreeNode>
}

const createDirectory = (name: string, path: string): DirectoryEntry => ({
  name,
  path,
  directories: new Map(),
  files: new Map()
})

const compareNodes = (left: IdeFileTreeNode, right: IdeFileTreeNode): number => {
  if (left.kind !== right.kind) return left.kind === 'directory' ? -1 : 1
  return left.name.localeCompare(right.name)
}

const toNodes = (entry: DirectoryEntry): IdeFileTreeNode[] => {
  const directories: IdeFileTreeNode[] = [...entry.directories.values()].map((directory) => ({
    kind: 'directory',
    name: directory.name,
    path: directory.path,
    children: toNodes(directory)
  }))

  return [...directories, ...entry.files.values()].sort(compareNodes)
}

export const buildIdeFileTree = (paths: string[]): IdeFileTreeNode[] => {
  const root = createDirectory('', '/')

  for (const path of paths) {
    const segments = path.split('/').filter(Boolean)
    const fileName = segments.at(-1)
    if (!fileName) continue

    let directory = root
    for (let index = 0; index < segments.length - 1; index += 1) {
      const name = segments[index]
      if (!name) continue
      const directoryPath = `/${segments.slice(0, index + 1).join('/')}`
      let child = directory.directories.get(name)
      if (!child) {
        child = createDirectory(name, directoryPath)
        directory.directories.set(name, child)
      }
      directory = child
    }

    const normalizedPath = `/${segments.join('/')}`
    directory.files.set(normalizedPath, {
      kind: 'file',
      name: fileName,
      path: normalizedPath
    })
  }

  return toNodes(root)
}
