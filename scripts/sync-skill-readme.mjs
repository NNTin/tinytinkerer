import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import process from 'node:process'

const rootDir = process.cwd()
const readmePath = join(rootDir, '.agent', 'README.md')
const skillsDir = join(rootDir, '.agent', 'skills')

// The README is embedded inside a single HTML comment: invisible in rendered
// Markdown, but present in the raw file an agent reads. BEGIN/END are the
// comment's open/close lines and double as the region markers the script
// finds and replaces on each sync.
const BEGIN_MARKER =
  '<!-- BEGIN GENERATED: .agent/README.md — do not edit; run `pnpm sync:skill-readme`'
const END_MARKER = 'END GENERATED: .agent/README.md -->'

// Discover every .agent/skills/<name>/SKILL.md from the filesystem so new (even
// untracked) skills are covered without extra wiring.
const listSkillFiles = () => {
  if (!existsSync(skillsDir)) {
    return []
  }
  return readdirSync(skillsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => join('.agent', 'skills', entry.name, 'SKILL.md'))
    .filter((relativePath) => existsSync(join(rootDir, relativePath)))
    .sort()
}

// Build the generated block: one HTML comment wrapping the verbatim README,
// so it is hidden in rendered Markdown but visible to agents reading the raw file.
const buildBlock = (readmeContent) => {
  if (readmeContent.includes('-->')) {
    throw new Error(
      '.agent/README.md contains "-->", which would close the embedded HTML comment early. ' +
        'Remove it before syncing.'
    )
  }
  return [
    BEGIN_MARKER,
    '',
    readmeContent.trimEnd(),
    '',
    END_MARKER
  ].join('\n')
}

// Return the desired full content of a SKILL.md with the block inserted/updated.
const applyBlock = (original, block) => {
  const beginIndex = original.indexOf(BEGIN_MARKER)
  const endIndex = original.indexOf(END_MARKER)

  if (beginIndex !== -1 && endIndex !== -1 && endIndex > beginIndex) {
    const before = original.slice(0, beginIndex)
    const after = original.slice(endIndex + END_MARKER.length)
    return `${before}${block}${after}`
  }

  // No markers yet: insert right after the first heading line (the title), so the
  // framework is the first substantive thing an LLM reads.
  const lines = original.split('\n')
  const titleIndex = lines.findIndex((line) => /^#\s/.test(line))
  const insertAt = titleIndex === -1 ? 0 : titleIndex + 1

  const head = lines.slice(0, insertAt).join('\n')
  const tail = lines.slice(insertAt).join('\n')

  return [head, '', block, '', tail.replace(/^\n+/, '')].join('\n')
}

const main = () => {
  const checkMode = process.argv.includes('--check')

  let readmeContent
  try {
    readmeContent = readFileSync(readmePath, 'utf8')
  } catch {
    throw new Error(
      `Source not found: .agent/README.md (looked at ${readmePath})`
    )
  }

  const block = buildBlock(readmeContent)
  const skillFiles = listSkillFiles()

  if (skillFiles.length === 0) {
    console.log('No .agent/skills/*/SKILL.md files found.')
    return
  }

  const outOfSync = []
  const updated = []

  for (const relativePath of skillFiles) {
    const absolutePath = join(rootDir, relativePath)
    const original = readFileSync(absolutePath, 'utf8')
    const desired = applyBlock(original, block)

    if (desired === original) {
      continue
    }

    if (checkMode) {
      outOfSync.push(relativePath)
    } else {
      writeFileSync(absolutePath, desired, 'utf8')
      updated.push(relativePath)
    }
  }

  if (checkMode) {
    if (outOfSync.length > 0) {
      console.error('SKILL.md files are out of sync with .agent/README.md:')
      for (const file of outOfSync) {
        console.error(`  - ${file}`)
      }
      console.error('\nRun `pnpm sync:skill-readme` and commit the result.')
      process.exitCode = 1
      return
    }
    console.log(
      `All ${skillFiles.length} SKILL.md file(s) are in sync with .agent/README.md.`
    )
    return
  }

  if (updated.length === 0) {
    console.log(`All ${skillFiles.length} SKILL.md file(s) already in sync.`)
    return
  }

  console.log(
    `Synced .agent/README.md into ${updated.length} SKILL.md file(s):`
  )
  for (const file of updated) {
    console.log(`  - ${file}`)
  }
}

try {
  main()
} catch (error) {
  const message = error instanceof Error ? error.message : String(error)
  console.error(message)
  process.exitCode = 1
}
