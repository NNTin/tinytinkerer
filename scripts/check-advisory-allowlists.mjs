import { readFile } from 'node:fs/promises'

const readYamlList = (source, key, file) => {
  const lines = source.split(/\r?\n/)
  const start = lines.findIndex((line) => line.trim() === `${key}:`)
  if (start < 0) throw new Error(`${file}: missing ${key} list`)

  const indentation = lines[start].search(/\S/)
  const values = []
  for (const line of lines.slice(start + 1)) {
    if (line.trim() === '' || line.trimStart().startsWith('#')) continue
    const currentIndentation = line.search(/\S/)
    if (currentIndentation <= indentation) break
    const match = line.trim().match(/^-\s+(GHSA-[a-z0-9-]+)$/i)
    if (match?.[1]) values.push(match[1])
  }
  return values
}

const workspaceFile = 'pnpm-workspace.yaml'
const dependencyReviewFile = '.github/dependency-review-config.yml'
const [workspaceSource, dependencyReviewSource] = await Promise.all([
  readFile(workspaceFile, 'utf8'),
  readFile(dependencyReviewFile, 'utf8')
])

const auditAllowlist = readYamlList(workspaceSource, 'ignoreGhsas', workspaceFile)
const dependencyReviewAllowlist = readYamlList(
  dependencyReviewSource,
  'allow-ghsas',
  dependencyReviewFile
)

const duplicateValues = (values) => values.filter((value, index) => values.indexOf(value) !== index)
const duplicates = [
  ...duplicateValues(auditAllowlist),
  ...duplicateValues(dependencyReviewAllowlist)
]
if (duplicates.length > 0) {
  throw new Error(`Duplicate advisory allow-list entries: ${[...new Set(duplicates)].join(', ')}`)
}

const auditSet = new Set(auditAllowlist)
const dependencyReviewSet = new Set(dependencyReviewAllowlist)
const auditOnly = auditAllowlist.filter((ghsa) => !dependencyReviewSet.has(ghsa))
const dependencyReviewOnly = dependencyReviewAllowlist.filter((ghsa) => !auditSet.has(ghsa))

if (auditOnly.length > 0 || dependencyReviewOnly.length > 0) {
  throw new Error(
    [
      'Advisory allow-lists are out of sync.',
      auditOnly.length > 0 ? `Only in ${workspaceFile}: ${auditOnly.join(', ')}` : '',
      dependencyReviewOnly.length > 0
        ? `Only in ${dependencyReviewFile}: ${dependencyReviewOnly.join(', ')}`
        : ''
    ]
      .filter(Boolean)
      .join('\n')
  )
}

console.log(`Advisory allow-lists are synchronized (${auditAllowlist.length} entries).`)
