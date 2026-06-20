/**
 * Pure helpers for composing the develop → main release PR body.
 *
 * The companion workflow (`.github/workflows/release-pr.yml`) owns every GitHub
 * API call: it resolves the compare range, fetches commits/PRs/files, and hands
 * a plain serialisable snapshot to {@link buildReleaseBody}. Everything in this
 * module is deterministic and side-effect free (the one exception is the
 * injected `resolveReference` callback, which the workflow wires to the issues
 * API and tests stub), so the parsing, classification, grouping, sorting, and
 * rendering can be exercised by `node --test` without touching the network.
 *
 * "GitHub only" references: we deliberately do not extract Jira/Linear-style
 * tickets (e.g. `TIN-42`). Only GitHub issues and pull requests are captured —
 * via shorthand (`#132`, `owner/repo#132`), canonical URLs, and prose PR refs
 * (`PR #132`, `pull request #132`).
 */

/**
 * Conventional-commit sections, in render order. `__other__` is the catch-all
 * bucket for anything that does not classify to a known type.
 */
const SECTIONS = [
  { title: '🚀 Features', types: ['feat'] },
  { title: '🐛 Fixes', types: ['fix'] },
  { title: '⚡ Performance', types: ['perf'] },
  { title: '♻️ Refactors', types: ['refactor'] },
  { title: '📝 Docs', types: ['docs'] },
  { title: '✅ Tests', types: ['test'] },
  { title: '🔧 Build/CI', types: ['build', 'ci'] },
  { title: '🧹 Chores', types: ['chore', 'style'] },
  { title: '📦 Other', types: ['__other__'] }
]

const TYPE_TO_SECTION = new Map()
for (const section of SECTIONS) {
  for (const type of section.types) TYPE_TO_SECTION.set(type, section.title)
}

const CONVENTIONAL_RE = /^(?<type>\w+)(?<scope>\([^)]*\))?(?<bang>!)?:\s*(?<desc>.+)$/

// Closing keywords + the trailing list of refs they apply to. The captured
// group (clause[1]) is the refs portion; we use its position to decide which
// extracted references carry a "closing" relationship. The separator between
// refs allows a comma and/or `and` (including the Oxford-comma `, and`) so the
// whole list stays inside the closing range.
const CLOSING_CLAUSE_RE =
  /\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\s+((?:(?:https?:\/\/github\.com\/[\w.-]+\/[\w.-]+\/issues\/\d+|[\w.-]+\/[\w.-]+#\d+|#\d+)(?:\s*,?\s*(?:and\s+)?)?)+)/gi

// A single ordered alternation so the more specific forms win before the bare
// `#number` fallback can re-consume them (e.g. `PR #132` stays a PR ref, and
// `owner/repo#132` keeps its repo). The negative lookbehind on the bare form
// keeps `TIN-42`-style tokens and `word#1` out of the capture.
const REFERENCE_RE = new RegExp(
  [
    'https?://github\\.com/(?<issueRepo>[\\w.-]+/[\\w.-]+)/issues/(?<issueNum>\\d+)',
    'https?://github\\.com/(?<pullRepo>[\\w.-]+/[\\w.-]+)/pull/(?<pullNum>\\d+)',
    '(?:\\bpull request\\b|\\bPR\\b)\\s+(?:(?<proseRepo>[\\w.-]+/[\\w.-]+))?#(?<proseNum>\\d+)',
    '(?<shortRepo>[\\w.-]+/[\\w.-]+)#(?<shortRepoNum>\\d+)',
    '(?<!\\w)#(?<bareNum>\\d+)'
  ].join('|'),
  'gi'
)

// GitHub's generic documentation placeholders (`owner/repo`, `org/repo`,
// `user/repo`) routinely appear in commit/PR prose that explains the reference
// syntax itself — e.g. a commit body listing "shorthand #132, owner/repo#132".
// They never name a real repository, so extracting them only yields a perpetual
// "unresolved reference" warning. We drop them up front; a genuinely broken
// cross-repo ref (a real-looking slug that 404s) is still surfaced as unresolved.
const PLACEHOLDER_REPO_SLUGS = new Set(['owner/repo', 'org/repo', 'user/repo'])

const DEPENDENCY_FILE_RE =
  /^(?:package\.json|pnpm-lock\.yaml|pnpm-workspace\.yaml|apps\/[^/]+\/package\.json|packages\/.+\/package\.json|scripts\/(?:generate-sbom|generate-notices|enforce-licenses|license-policy|license-policy\.test)\.mjs|scripts\/lib\/dependency-licenses\.mjs|\.github\/workflows\/compliance\.yml)$/

const BREAKING_FOOTER_RE = /^BREAKING[ -]CHANGE:/im
const MARKDOWN_HEADER_RE = /^#{1,6}\s+\S.*$/gm

export const GITHUB_BODY_MAX_LENGTH = 65536

/** Classify a commit subject / PR title into a section + cleaned description. */
export function classifyConventional(text) {
  const match = text.match(CONVENTIONAL_RE)
  const type = match?.groups?.type?.toLowerCase()
  const desc = match?.groups?.desc ?? text
  const bang = Boolean(match?.groups?.bang)
  const section = (type && TYPE_TO_SECTION.get(type)) || TYPE_TO_SECTION.get('__other__')
  return { section, desc, type: type ?? null, bang }
}

/**
 * A breaking change is signalled either by a `!` after the conventional-commit
 * type (`feat!:` / `refactor(scope)!:`) or by a `BREAKING CHANGE:` footer in the
 * body. The subject line is the conventional header; the body is everything
 * after it.
 */
export function detectBreakingChange(subject, body = '') {
  const { bang } = classifyConventional(subject ?? '')
  return bang || BREAKING_FOOTER_RE.test(body ?? '')
}

/**
 * Split a release PR body into GitHub-sized chunks. Splits are only allowed at
 * Markdown ATX headings because headings are natural continuation boundaries in
 * the generated release notes.
 */
export function splitReleaseBody(body, { maxLength = GITHUB_BODY_MAX_LENGTH } = {}) {
  if (!Number.isSafeInteger(maxLength) || maxLength <= 0) {
    throw new Error(`maxLength must be a positive integer; received ${maxLength}`)
  }
  if (body.length <= maxLength) return [body]

  const allHeaderIndexes = [...body.matchAll(MARKDOWN_HEADER_RE)].map((match) => match.index)
  const headerIndexes = allHeaderIndexes.filter((index) => index > 0)

  if (allHeaderIndexes.length === 0) {
    throw new Error(
      `Release PR body is ${body.length} characters, which exceeds GitHub's ${maxLength}-character limit, and has no Markdown heading where it can be split.`
    )
  }

  const blockStarts = [0, ...headerIndexes]
  const blocks = blockStarts.map((start, index) => body.slice(start, blockStarts[index + 1]))
  const chunks = []
  let current = ''

  for (const block of blocks) {
    if (block.length > maxLength) {
      const header = block.match(MARKDOWN_HEADER_RE)?.[0] ?? 'body preamble'
      throw new Error(
        `Release PR body section starting "${header.slice(0, 80)}" is ${block.length} characters, which exceeds GitHub's ${maxLength}-character limit. Add another Markdown header inside that section before splitting.`
      )
    }

    if (!current) {
      current = block
    } else if (current.length + block.length <= maxLength) {
      current += block
    } else {
      chunks.push(current)
      current = block
    }
  }

  if (current) chunks.push(current)
  return chunks
}

const ownerRepoOf = (repoFullName) => {
  const [owner, repo] = repoFullName.split('/')
  return { owner, repo }
}

/** Markdown-safe label for a reference: `#132` in-repo, `owner/repo#132` else. */
function referenceLabel(repoFullName, number, currentRepo) {
  return repoFullName.toLowerCase() === currentRepo.toLowerCase()
    ? `#${number}`
    : `${repoFullName}#${number}`
}

const referenceUrl = (repoFullName, number, type) =>
  `https://github.com/${repoFullName}/${type === 'pull' ? 'pull' : 'issues'}/${number}`

const commitUrl = (repoFullName, sha) => `https://github.com/${repoFullName}/commit/${sha}`

/**
 * Extract every GitHub issue/PR reference from a blob of text.
 *
 * Returns one entry per occurrence (not deduplicated) so callers can attribute
 * each to its source. `type` is derived from the textual form: explicit URLs and
 * prose `PR #n` are unambiguous; bare/shorthand `#n` is `ambiguous` and needs
 * API resolution to decide issue-vs-PR. `closing` is true when the reference
 * falls inside a `close/fix/resolve` clause.
 */
export function extractReferences(text, { repoFullName }) {
  if (!text) return []

  // Map out the character ranges covered by closing clauses up front.
  const closingRanges = []
  for (const clause of text.matchAll(CLOSING_CLAUSE_RE)) {
    const refs = clause[1] ?? ''
    const refsStart = clause.index + clause[0].indexOf(refs)
    closingRanges.push([refsStart, refsStart + refs.length])
  }
  const inClosingClause = (start) => closingRanges.some(([from, to]) => start >= from && start < to)

  const results = []
  for (const match of text.matchAll(REFERENCE_RE)) {
    const g = match.groups
    let repo = repoFullName
    let number
    let type = 'ambiguous'

    if (g.issueNum) {
      repo = g.issueRepo
      number = g.issueNum
      type = 'issue'
    } else if (g.pullNum) {
      repo = g.pullRepo
      number = g.pullNum
      type = 'pull'
    } else if (g.proseNum) {
      repo = g.proseRepo ?? repoFullName
      number = g.proseNum
      type = 'pull'
    } else if (g.shortRepoNum) {
      const slug = g.shortRepo.toLowerCase()
      // Skip a documentation placeholder unless it happens to be this very repo.
      if (PLACEHOLDER_REPO_SLUGS.has(slug) && slug !== repoFullName.toLowerCase()) {
        continue
      }
      repo = g.shortRepo
      number = g.shortRepoNum
    } else if (g.bareNum) {
      number = g.bareNum
    } else {
      continue
    }

    const closing = inClosingClause(match.index)
    // A closing clause only makes sense for issues; treat an ambiguous ref in a
    // closing clause as an issue (that is the GitHub semantic of `fixes #n`).
    if (closing && type === 'ambiguous') type = 'issue'

    results.push({ repoFullName: repo, number: Number(number), type, closing })
  }
  return results
}

/**
 * Compose the full release PR title + body from a snapshot of the compare range.
 *
 * @param {object} context
 * @param {string} context.repoFullName  e.g. `owner/repo`
 * @param {string} context.base          base branch (main)
 * @param {string} context.head          head branch (develop)
 * @param {string} context.developSha
 * @param {string} context.mainSha
 * @param {Array}  context.mergedPrs     [{ number, title, body, author, commits:[{sha,subject,message}], files }]
 * @param {Array}  context.directCommits [{ sha, subject, message, author, files }]
 * @param {Array}  context.commitEntries [{ sha, subject, prNumber? }] in compare order
 * @param {Array}  context.contributors  [{ name, additions, deletions }]
 * @param {Array}  context.changedFiles  [{ filename, additions, deletions }]
 * @param {object} [options]
 * @param {(ref:{owner:string,repo:string,number:number,repoFullName:string}) => Promise<'issue'|'pull'|{type:'issue'|'pull'}|null>} [options.resolveReference]
 *   Resolves an ambiguous `#n` to an issue or PR. Failures (throw / null) are
 *   non-fatal: the reference is reported as unresolved instead of dropped.
 * @returns {Promise<{ title: string, body: string, warnings: string[] }>}
 */
export async function buildReleaseBody(context, options = {}) {
  const {
    repoFullName,
    base,
    head,
    developSha,
    mainSha,
    mergedPrs = [],
    directCommits = [],
    commitEntries = [],
    contributors = [],
    changedFiles = []
  } = context
  const { resolveReference } = options

  const compareUrl = `https://github.com/${repoFullName}/compare/${base}...${head}`
  const warnings = []

  // ── Reference index ──────────────────────────────────────────────────────
  // Deduplicate references by repo#number while accumulating their sources and
  // the strongest type/closing signal seen across all occurrences.
  const refs = new Map()
  const keyOf = (repo, number) => `${repo.toLowerCase()}#${number}`

  const ingest = (text, source) => {
    // key -> whether this text closes the ref (per-occurrence, OR-ed). The
    // closing flag is tracked per item rather than only globally so a closing
    // ref in one PR does not make a mere mention of the same issue in another
    // commit render as `closes`.
    const found = new Map()
    for (const ref of extractReferences(text, { repoFullName })) {
      const key = keyOf(ref.repoFullName, ref.number)
      let entry = refs.get(key)
      if (!entry) {
        entry = {
          key,
          repoFullName: ref.repoFullName,
          number: ref.number,
          type: ref.type,
          closing: false,
          sources: new Map()
        }
        refs.set(key, entry)
      }
      // Explicit types (issue/pull) win over ambiguous; closing implies issue.
      if (entry.type === 'ambiguous' && ref.type !== 'ambiguous') entry.type = ref.type
      if (ref.closing) {
        entry.closing = true
        if (entry.type === 'ambiguous') entry.type = 'issue'
      }
      const sourceKey = `${source.kind}:${source.prNumber ?? source.sha}`
      if (!entry.sources.has(sourceKey)) entry.sources.set(sourceKey, source)
      found.set(key, (found.get(key) ?? false) || ref.closing)
    }
    return found
  }

  // Merge per-text reference maps for one release item, OR-ing the closing flag.
  const mergeRefMaps = (...maps) => {
    const merged = new Map()
    for (const map of maps) {
      for (const [key, closing] of map) {
        merged.set(key, (merged.get(key) ?? false) || closing)
      }
    }
    return merged
  }

  // Index every PR and commit, recording per-item reference keys for the change
  // lines, and the merged-PR numbers so we never list them as "mentioned".
  const mergedPrNumbers = new Set(mergedPrs.map((pr) => keyOf(repoFullName, pr.number)))
  const sortedMergedPrs = [...mergedPrs].sort((a, b) => a.number - b.number)

  for (const pr of sortedMergedPrs) {
    const maps = [
      ingest(pr.title, { kind: 'pr-title', prNumber: pr.number }),
      ingest(pr.body, { kind: 'pr-body', prNumber: pr.number })
    ]
    for (const commit of pr.commits ?? []) {
      const subject = commit.subject ?? commit.message?.split('\n')[0] ?? ''
      maps.push(ingest(subject, { kind: 'commit-subject', sha: commit.sha }))
      const msgBody = (commit.message ?? '').split('\n').slice(1).join('\n')
      maps.push(ingest(msgBody, { kind: 'commit-body', sha: commit.sha }))
    }
    pr._refs = mergeRefMaps(...maps)
  }

  for (const entry of directCommits) {
    const subject = entry.subject ?? entry.message?.split('\n')[0] ?? ''
    const subjMap = ingest(subject, { kind: 'commit-subject', sha: entry.sha })
    const msgBody = (entry.message ?? '').split('\n').slice(1).join('\n')
    const bMap = ingest(msgBody, { kind: 'commit-body', sha: entry.sha })
    entry._refs = mergeRefMaps(subjMap, bMap)
  }

  // ── Resolve ambiguous references ─────────────────────────────────────────
  const resolutionCache = new Map()
  for (const entry of refs.values()) {
    if (entry.type !== 'ambiguous') continue
    if (resolutionCache.has(entry.key)) {
      entry.type = resolutionCache.get(entry.key)
      continue
    }
    let resolved = null
    if (resolveReference) {
      try {
        const { owner, repo } = ownerRepoOf(entry.repoFullName)
        const result = await resolveReference({
          owner,
          repo,
          number: entry.number,
          repoFullName: entry.repoFullName
        })
        resolved = typeof result === 'string' ? result : (result?.type ?? null)
      } catch {
        resolved = null
      }
    }
    if (resolved === 'issue' || resolved === 'pull') {
      entry.type = resolved
    } else {
      entry.type = 'unresolved'
      warnings.push(
        `Could not resolve GitHub reference ${referenceLabel(entry.repoFullName, entry.number, repoFullName)} to an issue or pull request.`
      )
    }
    resolutionCache.set(entry.key, entry.type)
  }

  // ── Bucket references ────────────────────────────────────────────────────
  const closingIssues = []
  const mentionedIssues = []
  const mentionedPrs = []
  const unresolved = []
  for (const entry of [...refs.values()].sort((a, b) =>
    referenceLabel(a.repoFullName, a.number, repoFullName).localeCompare(
      referenceLabel(b.repoFullName, b.number, repoFullName),
      undefined,
      { numeric: true }
    )
  )) {
    if (entry.type === 'unresolved') {
      unresolved.push(entry)
    } else if (entry.type === 'issue') {
      ;(entry.closing ? closingIssues : mentionedIssues).push(entry)
    } else if (entry.type === 'pull') {
      if (!mergedPrNumbers.has(entry.key)) mentionedPrs.push(entry)
    }
  }

  // ── Helpers for rendering references ─────────────────────────────────────
  const linkFor = (entry) =>
    `[${referenceLabel(entry.repoFullName, entry.number, repoFullName)}](${referenceUrl(
      entry.repoFullName,
      entry.number,
      entry.type === 'pull' ? 'pull' : 'issues'
    )})`

  const issueLinkByKey = (key) => {
    const entry = refs.get(key)
    return entry ? linkFor(entry) : null
  }

  // ── Conventional grouping + workspace impact ─────────────────────────────
  const grouped = new Map(SECTIONS.map((s) => [s.title, []]))
  const workspaceGrouped = new Map()
  const breakingChanges = []

  const workspaceLabelsForFiles = (files) => {
    const labels = new Set()
    for (const file of files ?? []) {
      const parts = file.filename.split('/')
      if (parts[0] === 'apps' && parts[1]) {
        labels.add(`apps/${parts[1]}`)
      } else if (
        parts[0] === 'packages' &&
        parts[1] === 'content' &&
        parts[2] === 'renderers' &&
        parts[3]
      ) {
        labels.add(`packages/content/renderers/${parts[3]}`)
      } else if (parts[0] === 'packages' && parts[1] && parts[2]) {
        labels.add(`packages/${parts[1]}/${parts[2]}`)
      }
    }
    return labels.size > 0 ? [...labels].sort() : ['Repository']
  }

  const rememberReleaseItem = ({ sourceText, line, files }) => {
    const { section } = classifyConventional(sourceText)
    grouped.get(section).push(line)
    for (const label of workspaceLabelsForFiles(files)) {
      if (!workspaceGrouped.has(label)) workspaceGrouped.set(label, [])
      workspaceGrouped.get(label).push(line)
    }
  }

  // Split an item's referenced issues into closing vs mentioned link lists,
  // using the per-item closing flag (not the global one) so the relationship is
  // accurate for this specific PR/commit.
  const issueSuffixForRefs = (refMap) => {
    const closing = []
    const mentioned = []
    for (const [key, isClosing] of refMap ?? []) {
      const entry = refs.get(key)
      if (!entry || entry.type !== 'issue') continue
      ;(isClosing ? closing : mentioned).push(linkFor(entry))
    }
    closing.sort()
    mentioned.sort()
    const parts = []
    if (closing.length) parts.push(`closes ${closing.join(', ')}`)
    if (mentioned.length) parts.push(`refs ${mentioned.join(', ')}`)
    return parts.length ? ` · ${parts.join(' · ')}` : ''
  }

  for (const pr of sortedMergedPrs) {
    const firstCommit = pr.commits?.[0]
    const sha = firstCommit?.sha
    const shaLink = sha ? `[\`${sha.slice(0, 7)}\`](${commitUrl(repoFullName, sha)})` : '`unknown`'
    const { desc } = classifyConventional(pr.title)
    const prLink = `[#${pr.number}](${referenceUrl(repoFullName, pr.number, 'pull')})`
    const suffix = issueSuffixForRefs(pr._refs)
    rememberReleaseItem({
      sourceText: pr.title,
      line: `- ${desc} (${prLink}) ${shaLink} — ${formatContributor(pr.author)}${suffix}`,
      files: pr.files
    })

    const prBody = pr.commits?.map((c) => c.message).join('\n\n') ?? ''
    if (detectBreakingChange(pr.title, `${pr.body ?? ''}\n${prBody}`)) {
      breakingChanges.push(`- ${desc} (${prLink})`)
    }
  }

  for (const entry of directCommits) {
    const shaLink = `[\`${entry.sha.slice(0, 7)}\`](${commitUrl(repoFullName, entry.sha)})`
    const { desc } = classifyConventional(entry.subject)
    const suffix = issueSuffixForRefs(entry._refs)
    rememberReleaseItem({
      sourceText: entry.subject,
      line: `- ${desc} ${shaLink} — ${formatContributor(entry.author)}${suffix}`,
      files: entry.files
    })
    if (detectBreakingChange(entry.subject, entry.message ?? '')) {
      breakingChanges.push(`- ${desc} ${shaLink}`)
    }
  }

  // ── Stats / dependency files ─────────────────────────────────────────────
  const additions = changedFiles.reduce((sum, f) => sum + (f.additions ?? 0), 0)
  const deletions = changedFiles.reduce((sum, f) => sum + (f.deletions ?? 0), 0)
  const dependencyFiles = changedFiles
    .map((file) => file.filename)
    .filter((filename) => DEPENDENCY_FILE_RE.test(filename))
    .sort()

  // ── Compose ──────────────────────────────────────────────────────────────
  const MARKER = '<!-- release-pr -->'
  const lines = [MARKER, '']
  lines.push(`Promotes [\`${head}\`](${compareUrl}) into \`${base}\`.`, '')

  lines.push('### 📊 Stats', '')
  lines.push(
    `**${commitEntries.length}** commits · ` +
      `**${mergedPrs.length}** merged PRs · ` +
      `**${changedFiles.length}** files changed · ` +
      `**+${additions} / −${deletions}** · ` +
      `**${contributors.length}** contributors`
  )
  lines.push('', `[Compare ${base}...${head}](${compareUrl})`, '')

  if (breakingChanges.length > 0) {
    lines.push('### ⚠️ Breaking Changes', '', ...breakingChanges, '')
  }

  lines.push('### 🔗 Related Links', '')
  const relatedRows = []
  const renderGroup = (label, entries, asPull = false) => {
    if (entries.length === 0) return
    const links = entries
      .map(
        (e) =>
          `[${referenceLabel(e.repoFullName, e.number, repoFullName)}](${referenceUrl(e.repoFullName, e.number, asPull ? 'pull' : 'issues')})`
      )
      .join(', ')
    relatedRows.push(`**${label}:** ${links}`)
  }
  renderGroup('Closing Issues', closingIssues)
  renderGroup('Mentioned Issues', mentionedIssues)
  if (sortedMergedPrs.length > 0) {
    const links = sortedMergedPrs
      .map((pr) => `[#${pr.number}](${referenceUrl(repoFullName, pr.number, 'pull')})`)
      .join(', ')
    relatedRows.push(`**Merged Pull Requests:** ${links}`)
  }
  renderGroup('Mentioned Pull Requests', mentionedPrs, true)
  if (unresolved.length > 0) {
    const links = unresolved
      .map((e) => `${referenceLabel(e.repoFullName, e.number, repoFullName)}`)
      .join(', ')
    relatedRows.push(`**Unresolved GitHub References:** ${links}`)
  }
  lines.push(relatedRows.length ? relatedRows.join('\n\n') : '_None detected._', '')

  lines.push('### 📦 Dependency Changes', '')
  if (dependencyFiles.length > 0) {
    lines.push(`Detected in **${dependencyFiles.length}** file(s):`, '')
    for (const filename of dependencyFiles.slice(0, 20)) {
      lines.push(`- \`${filename}\``)
    }
    if (dependencyFiles.length > 20) {
      lines.push(`- _${dependencyFiles.length - 20} more dependency files omitted._`)
    }
    lines.push('')
  } else {
    lines.push('_None detected._', '')
  }

  lines.push('### 🔀 Changes', '')
  let anyChanges = false
  for (const section of SECTIONS) {
    const items = grouped.get(section.title)
    if (items.length === 0) continue
    anyChanges = true
    lines.push(`#### ${section.title}`, '', ...items, '')
  }
  if (!anyChanges) lines.push('_No conventional-commit changes detected._', '')

  lines.push('### 🧭 Workspace Impact', '')
  const workspaceLabels = [...workspaceGrouped.keys()].sort((a, b) => {
    if (a === 'Repository') return 1
    if (b === 'Repository') return -1
    return a.localeCompare(b)
  })
  if (workspaceLabels.length > 0) {
    for (const label of workspaceLabels) {
      lines.push(`#### ${label}`, '', ...workspaceGrouped.get(label), '')
    }
  } else {
    lines.push('_No workspace impact detected._', '')
  }

  // ── Reference sources audit ──────────────────────────────────────────────
  const auditEntries = [...refs.values()]
    .filter((e) => e.type !== 'unresolved')
    .sort((a, b) =>
      referenceLabel(a.repoFullName, a.number, repoFullName).localeCompare(
        referenceLabel(b.repoFullName, b.number, repoFullName),
        undefined,
        { numeric: true }
      )
    )
  if (auditEntries.length > 0) {
    lines.push('<details>', '<summary>🔎 Reference sources</summary>', '')
    for (const entry of auditEntries) {
      const sources = [...entry.sources.values()].map((s) => renderSource(s, repoFullName))
      lines.push(`- ${issueLinkByKey(entry.key)}: ${sources.join(', ')}`)
    }
    lines.push('', '</details>', '')
  }

  lines.push('<details>', '<summary>📜 Commits (full SHAs)</summary>', '')
  for (const entry of commitEntries) {
    const prRef = entry.prNumber
      ? ` ([#${entry.prNumber}](${referenceUrl(repoFullName, entry.prNumber, 'pull')}))`
      : ''
    lines.push(
      `- [\`${entry.sha}\`](${commitUrl(repoFullName, entry.sha)}) ${entry.subject}${prRef}`
    )
  }
  lines.push('', '</details>', '')

  lines.push('### 🙌 Contributors', '')
  const contributorLines = [...contributors]
    .sort((a, b) => {
      const aTotal = (a.additions ?? 0) + (a.deletions ?? 0)
      const bTotal = (b.additions ?? 0) + (b.deletions ?? 0)
      return bTotal - aTotal || a.name.localeCompare(b.name)
    })
    .map((c) => `- ${formatContributor(c.name)}: +${c.additions ?? 0} / −${c.deletions ?? 0}`)
  lines.push(contributorLines.length ? contributorLines.join('\n') : '_None detected._')

  const body = lines.join('\n')
  const title = `chore(release): merge ${head} (${developSha}) into ${base} (${mainSha})`

  return { title, body, warnings }
}

/** GitHub logins get an `@`; multi-word display names are left as-is. */
function formatContributor(name) {
  const value = name ?? 'unknown'
  return value.includes(' ') ? value : `@${value}`
}

/** Render one audit source as a markdown fragment with its origin link. */
function renderSource(source, repoFullName) {
  switch (source.kind) {
    case 'pr-title':
      return `merged PR [#${source.prNumber}](${referenceUrl(repoFullName, source.prNumber, 'pull')}) title`
    case 'pr-body':
      return `merged PR [#${source.prNumber}](${referenceUrl(repoFullName, source.prNumber, 'pull')}) body`
    case 'commit-subject':
      return `commit [\`${source.sha.slice(0, 7)}\`](${commitUrl(repoFullName, source.sha)}) subject`
    case 'commit-body':
      return `commit [\`${source.sha.slice(0, 7)}\`](${commitUrl(repoFullName, source.sha)}) body`
    default:
      return source.kind
  }
}
