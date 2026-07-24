import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

// This suite hardens the evaluator/builder information architecture (see
// docs/*.md and their _category_.json siblings) against regressions: it does not
// replace the Docusaurus build's own onBrokenLinks check, it catches the same class
// of mistake without paying for a full webpack build.

const testsDir = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(testsDir, '..', '..', '..')
const docsDir = join(repoRoot, 'docs')
const readmePath = join(repoRoot, 'README.md')

interface CategoryConfig {
  label: string
  position: number
}

const readCategoryConfig = (categoryDir: string): CategoryConfig =>
  JSON.parse(readFileSync(join(categoryDir, '_category_.json'), 'utf8')) as CategoryConfig

const JOURNEY_CATEGORIES = [
  'overview',
  'using-tinytinkerer',
  'plugins-and-tools',
  'extending',
  'self-hosting',
  'architecture',
  'contributing'
]

const readFrontmatter = (markdown: string): Record<string, string> => {
  const match = /^---\n([\s\S]*?)\n---\n/.exec(markdown)
  if (!match) return {}
  const fields: Record<string, string> = {}
  for (const line of match[1].split('\n')) {
    const fieldMatch = /^([A-Za-z_]+):\s*(.*)$/.exec(line)
    if (fieldMatch) fields[fieldMatch[1]] = fieldMatch[2].trim()
  }
  return fields
}

const listMarkdownFiles = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = join(dir, entry.name)
    if (entry.isDirectory()) return listMarkdownFiles(entryPath)
    if (/\.mdx?$/.test(entry.name)) return [entryPath]
    return []
  })

const allDocFiles = listMarkdownFiles(docsDir)

// A link target is "internal" if it points at another file in this repo rather than
// an external URL, a same-page anchor, or the documented `pathname://` escape hatch
// used to leave the Docusaurus router (see docs/index.mdx).
const isInternalFileLink = (target: string): boolean => {
  if (target.length === 0) return false
  if (target.startsWith('#')) return false
  if (/^[a-z][a-z0-9+.-]*:/i.test(target)) return false // any URL scheme, incl. pathname://
  return true
}

const extractLinks = (markdown: string): string[] => {
  const links: string[] = []
  const pattern = /\]\(([^)]+)\)/g
  let match: RegExpExecArray | null
  while ((match = pattern.exec(markdown))) {
    links.push(match[1].split(' ')[0])
  }
  return links
}

describe('docs information architecture', () => {
  it('defines every evaluator/builder journey as a category with a _category_.json', () => {
    for (const category of JOURNEY_CATEGORIES) {
      const categoryDir = join(docsDir, category)
      expect(existsSync(categoryDir), `docs/${category} should exist`).toBe(true)
      const categoryJsonPath = join(categoryDir, '_category_.json')
      expect(existsSync(categoryJsonPath), `docs/${category}/_category_.json should exist`).toBe(
        true
      )
      const config = readCategoryConfig(categoryDir)
      expect(typeof config.label).toBe('string')
      expect(typeof config.position).toBe('number')
    }
  })

  it('gives every top-level journey category a distinct sidebar position', () => {
    const positions = JOURNEY_CATEGORIES.map(
      (category) => readCategoryConfig(join(docsDir, category)).position
    )
    expect(new Set(positions).size).toBe(positions.length)
  })

  it('places every doc under docs/ in a navigable category or marks it unlisted', () => {
    const orphans: string[] = []
    for (const filePath of allDocFiles) {
      const relPath = relative(docsDir, filePath)
      if (relPath === 'index.mdx') continue // the site root landing page

      const content = readFileSync(filePath, 'utf8')
      const frontmatter = readFrontmatter(content)
      if (frontmatter.unlisted === 'true') continue

      const categoryDir = dirname(filePath)
      const hasCategoryJson = existsSync(join(categoryDir, '_category_.json'))
      if (!hasCategoryJson) orphans.push(relPath)
    }
    expect(orphans, `orphaned docs (no category, not unlisted): ${orphans.join(', ')}`).toEqual([])
  })

  it('reaches every existing root doc through the new structure without leaving a duplicate at the old flat path', () => {
    const rootEntries = readdirSync(docsDir, { withFileTypes: true })
    const flatMarkdownFiles = rootEntries
      .filter((entry) => entry.isFile() && /\.mdx?$/.test(entry.name))
      .map((entry) => entry.name)
    // Only the landing page itself is allowed to live directly in docs/.
    expect(flatMarkdownFiles).toEqual(['index.mdx'])
  })

  it('lets a first-time evaluator reach capabilities, privacy, and an interactive entry point from the landing page', () => {
    const landing = readFileSync(join(docsDir, 'index.mdx'), 'utf8')
    expect(landing).toMatch(/\]\(\.\/overview\/index\.md\)/)
    expect(landing).toMatch(/\]\(\.\/overview\/PRIVACY\.md\)/)
    expect(landing).toMatch(/\]\(pathname:\/\/\/\)/)
  })

  it('reaches builder material within two navigation choices (category, then doc)', () => {
    const builderDocs = [
      'plugins-and-tools/plugin-infrastructure.md',
      'plugins-and-tools/mcp-integration.md',
      'extending/content-platform.md',
      'extending/app-shell.md',
      'architecture/packages-concept.md',
      'self-hosting/vercel-deployment.md',
      'self-hosting/litellm-setup.md'
    ]
    for (const relPath of builderDocs) {
      const absPath = join(docsDir, relPath)
      expect(existsSync(absPath), `${relPath} should exist`).toBe(true)
      // Exactly one directory segment between docs/ and the file: docs/<category>/<file>.
      expect(relPath.split('/').length, `${relPath} should sit one level under docs/`).toBe(2)
    }
    // Architecture's own category link IS the architecture doc, so it's one click, not two.
    expect(existsSync(join(docsDir, 'architecture', 'ARCHITECTURE.md'))).toBe(true)
  })

  it('keeps README documentation links pointing at real files', () => {
    const readme = readFileSync(readmePath, 'utf8')
    const links = extractLinks(readme).filter((link) => link.startsWith('docs/'))
    expect(links.length).toBeGreaterThan(0)
    for (const link of links) {
      const [pathPart] = link.split('#')
      const target = join(repoRoot, pathPart)
      expect(existsSync(target), `README link target missing: ${link}`).toBe(true)
    }
  })

  it('resolves every internal markdown link between docs to a file that exists', () => {
    const broken: string[] = []
    for (const filePath of allDocFiles) {
      const content = readFileSync(filePath, 'utf8')
      for (const link of extractLinks(content)) {
        if (!isInternalFileLink(link)) continue
        const [pathPart] = link.split('#')
        if (pathPart.length === 0) continue // pure in-page anchor
        const target = resolve(dirname(filePath), pathPart)
        if (!existsSync(target)) {
          broken.push(`${relative(docsDir, filePath)} -> ${link}`)
        }
      }
    }
    expect(broken, `broken internal doc links: ${broken.join(', ')}`).toEqual([])
  })

  it('marks non-navigation policy/update docs unlisted instead of dropping them from the build', () => {
    const updateDocs = ['updates/PRIVACY-UPDATE.md', 'updates/ux-modernization-migration.md']
    for (const relPath of updateDocs) {
      const absPath = join(docsDir, relPath)
      expect(existsSync(absPath), `${relPath} should exist`).toBe(true)
      const frontmatter = readFrontmatter(readFileSync(absPath, 'utf8'))
      expect(frontmatter.unlisted, `${relPath} should be frontmatter unlisted: true`).toBe('true')
    }
  })

  it('keeps docs/overview/PRIVACY.md free of frontmatter so it renders unmodified in the app', () => {
    // PRIVACY.md is read verbatim by scripts/generate-privacy-policy.mjs into the in-app
    // privacy dialog. It doesn't need sidebar frontmatter (it's the only content doc in
    // its category), so keep it plain rather than relying on the generator's strip step.
    const privacyDoc = readFileSync(join(docsDir, 'overview', 'PRIVACY.md'), 'utf8')
    expect(readFrontmatter(privacyDoc)).toEqual({})
  })

  it('keeps onBrokenLinks set to throw so a broken internal link fails the Docusaurus build', () => {
    const config = readFileSync(join(repoRoot, 'apps', 'docs', 'docusaurus.config.ts'), 'utf8')
    expect(config).toMatch(/onBrokenLinks:\s*'throw'/)
  })
})

describe('generate-privacy-policy.mjs', () => {
  it('reads the privacy docs from their new information-architecture locations', () => {
    const script = readFileSync(join(repoRoot, 'scripts', 'generate-privacy-policy.mjs'), 'utf8')
    expect(script).toMatch(/'docs',\s*'overview',\s*'PRIVACY\.md'/)
    expect(script).toMatch(/'docs',\s*'updates',\s*'PRIVACY-UPDATE\.md'/)
  })

  it('strips frontmatter before hashing/embedding so doc metadata never reaches the UI', () => {
    const script = readFileSync(join(repoRoot, 'scripts', 'generate-privacy-policy.mjs'), 'utf8')
    expect(script).toMatch(/stripFrontmatter/)
  })
})

describe('docs directory hygiene', () => {
  it('has no empty leftover directories from the reorganization', () => {
    const empties: string[] = []
    const walk = (dir: string) => {
      const entries = readdirSync(dir, { withFileTypes: true })
      for (const entry of entries) {
        if (entry.isDirectory()) walk(join(dir, entry.name))
      }
      if (entries.length === 0) empties.push(relative(docsDir, dir))
    }
    walk(docsDir)
    expect(empties).toEqual([])
  })

  it('gives every category doc a title distinct from its raw filename', () => {
    // Regression guard for the class of bug where a leading HTML comment before the H1
    // makes Docusaurus fall back to the filename as the page title.
    for (const filePath of allDocFiles) {
      const relPath = relative(docsDir, filePath)
      if (relPath === 'index.mdx' || relPath.endsWith('index.md')) continue
      const content = readFileSync(filePath, 'utf8')
      const frontmatter = readFrontmatter(content)
      const withoutFrontmatter = content.replace(/^---\n[\s\S]*?\n---\n+/, '')
      const headingMatch = /^#\s+(.+)$/m.exec(withoutFrontmatter)
      const bareFilename = filePath
        .split('/')
        .pop()!
        .replace(/\.mdx?$/, '')
      if (frontmatter.title) {
        expect(frontmatter.title).not.toBe(bareFilename)
        continue
      }
      // No explicit title: the first heading must appear before any HTML comment,
      // otherwise Docusaurus's title inference falls back to the filename.
      const firstCommentIndex = withoutFrontmatter.indexOf('<!--')
      const firstHeadingIndex = headingMatch ? withoutFrontmatter.indexOf(headingMatch[0]) : -1
      expect(
        firstHeadingIndex,
        `${relPath} should have an H1 or explicit frontmatter title`
      ).toBeGreaterThanOrEqual(0)
      if (firstCommentIndex >= 0) {
        expect(
          firstHeadingIndex,
          `${relPath}: an H1 after a leading HTML comment needs frontmatter title`
        ).toBeLessThan(firstCommentIndex)
      }
    }
  })

  it('does not have every markdown link colliding with a folder-name convention', () => {
    // Docusaurus auto-picks a doc as its folder's index page when the doc's basename
    // case-insensitively equals the parent folder name. Two docs matching this in the
    // same folder produce duplicate routes (silently, unless caught here).
    for (const category of JOURNEY_CATEGORIES) {
      const categoryDir = join(docsDir, category)
      if (!statSync(categoryDir).isDirectory()) continue
      const basenames = readdirSync(categoryDir)
        .filter((name) => /\.mdx?$/.test(name))
        .map((name) => name.replace(/\.mdx?$/, '').toLowerCase())
      const indexLike = basenames.filter((name) => name === 'index' || name === category)
      expect(
        indexLike.length,
        `docs/${category} has ${indexLike.length} docs matching the index convention: ${indexLike.join(', ')}`
      ).toBeLessThanOrEqual(1)
    }
  })
})
