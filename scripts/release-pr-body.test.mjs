import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  buildReleaseBody,
  classifyConventional,
  detectBreakingChange,
  extractReferences
} from './release-pr-body.mjs'

const REPO = 'owner/repo'

const refs = (text) => extractReferences(text, { repoFullName: REPO })

// ── extractReferences ──────────────────────────────────────────────────────

test('captures closing issue refs and distinguishes them from general mentions', () => {
  const result = refs('fixes #1 and also mentions #2 for context')
  const one = result.find((r) => r.number === 1)
  const two = result.find((r) => r.number === 2)
  assert.equal(one.type, 'issue')
  assert.equal(one.closing, true)
  assert.equal(two.closing, false)
  // A non-closing bare ref stays ambiguous until API resolution.
  assert.equal(two.type, 'ambiguous')
})

test('keeps every ref in a comma/and/Oxford-comma closing list closing', () => {
  for (const text of [
    'fixes #1, #2',
    'fixes #1 and #2',
    'fixes #1, and #2',
    'closes #1, #2, and #3'
  ]) {
    const result = refs(text)
    assert.ok(result.length >= 2, `expected multiple refs in: ${text}`)
    for (const ref of result) {
      assert.equal(ref.closing, true, `${text} -> #${ref.number} should close`)
      assert.equal(ref.type, 'issue')
    }
  }
})

test('captures explicit issue URLs', () => {
  const [ref] = refs('see https://github.com/owner/repo/issues/132')
  assert.deepEqual(
    { repo: ref.repoFullName, number: ref.number, type: ref.type },
    { repo: 'owner/repo', number: 132, type: 'issue' }
  )
})

test('captures explicit PR URLs', () => {
  const [ref] = refs('superseded by https://github.com/owner/repo/pull/77')
  assert.equal(ref.type, 'pull')
  assert.equal(ref.number, 77)
})

test('captures shorthand #132 as ambiguous', () => {
  const [ref] = refs('related to #132')
  assert.equal(ref.number, 132)
  assert.equal(ref.type, 'ambiguous')
  assert.equal(ref.repoFullName, REPO)
})

test('captures cross-repo owner/repo#132 shorthand', () => {
  const [ref] = refs('depends on other/project#9')
  assert.equal(ref.repoFullName, 'other/project')
  assert.equal(ref.number, 9)
  assert.equal(ref.type, 'ambiguous')
})

test('ignores generic placeholder repo slugs (doc examples) in shorthand', () => {
  // Commit/PR prose that documents the ref syntax — e.g. a body listing
  // "shorthand owner/repo#132" — must not register as a real cross-repo
  // reference and then surface as a perpetual unresolved warning.
  const found = extractReferences(
    'supports owner/repo#132, org/repo#7 and user/repo#9 shorthand',
    { repoFullName: 'NNTin/tinytinkerer' }
  )
  assert.deepEqual(found, [])
})

test('keeps a placeholder slug when it is the current repo', () => {
  const [ref] = extractReferences('see owner/repo#5', {
    repoFullName: 'owner/repo'
  })
  assert.equal(ref.repoFullName, 'owner/repo')
  assert.equal(ref.number, 5)
})

test('captures prose PR references as pull requests', () => {
  const result = refs('follows PR #132 and pull request #45')
  assert.deepEqual(
    result.map((r) => ({ n: r.number, t: r.type })),
    [
      { n: 132, t: 'pull' },
      { n: 45, t: 'pull' }
    ]
  )
})

test('does not capture Jira-style ticket refs like TIN-42', () => {
  assert.deepEqual(refs('working on TIN-42 and JIRA-7'), [])
})

// ── classify / breaking ─────────────────────────────────────────────────────

test('classifyConventional extracts type, description, and bang', () => {
  assert.deepEqual(classifyConventional('feat(api)!: add thing'), {
    section: '🚀 Features',
    desc: 'add thing',
    type: 'feat',
    bang: true
  })
})

test('detectBreakingChange flags ! in the subject', () => {
  assert.equal(detectBreakingChange('refactor(core)!: drop legacy path'), true)
})

test('detectBreakingChange flags a BREAKING CHANGE footer in the body', () => {
  assert.equal(
    detectBreakingChange(
      'feat: new flow',
      'body text\n\nBREAKING CHANGE: removes old flow'
    ),
    true
  )
})

test('detectBreakingChange is false for ordinary changes', () => {
  assert.equal(detectBreakingChange('fix: small bug', 'just a fix'), false)
})

// ── buildReleaseBody integration ────────────────────────────────────────────

const baseContext = {
  repoFullName: REPO,
  base: 'main',
  head: 'develop',
  developSha: 'a'.repeat(40),
  mainSha: 'b'.repeat(40),
  mergedPrs: [],
  directCommits: [],
  commitEntries: [],
  contributors: [],
  changedFiles: []
}

test('renders canonical PR/issue/commit markdown links', async () => {
  const sha = 'c'.repeat(40)
  const { body } = await buildReleaseBody(
    {
      ...baseContext,
      mergedPrs: [
        {
          number: 10,
          title: 'feat: add widget',
          body: 'closes #1',
          author: 'octocat',
          commits: [
            {
              sha,
              subject: 'feat: add widget',
              message: 'feat: add widget\n\ncloses #1'
            }
          ],
          files: [{ filename: 'apps/web/index.ts', additions: 5, deletions: 1 }]
        }
      ],
      commitEntries: [{ sha, subject: 'feat: add widget', prNumber: 10 }],
      contributors: [{ name: 'octocat', additions: 5, deletions: 1 }],
      changedFiles: [
        { filename: 'apps/web/index.ts', additions: 5, deletions: 1 }
      ]
    },
    { resolveReference: async () => 'issue' }
  )

  assert.match(body, /\[#10\]\(https:\/\/github\.com\/owner\/repo\/pull\/10\)/)
  assert.match(body, /\[#1\]\(https:\/\/github\.com\/owner\/repo\/issues\/1\)/)
  assert.match(
    body,
    new RegExp(
      `\\[\`${sha.slice(0, 7)}\`\\]\\(https://github\\.com/owner/repo/commit/${sha}\\)`
    )
  )
  // change line separates closing semantics
  assert.match(body, /closes \[#1\]/)
})

test('does not leak closing state across release items sharing an issue', async () => {
  const prSha = 'c'.repeat(40)
  const commitSha = 'd'.repeat(40)
  const { body } = await buildReleaseBody(
    {
      ...baseContext,
      mergedPrs: [
        {
          number: 10,
          title: 'feat: a',
          body: 'closes #5',
          author: 'x',
          commits: [{ sha: prSha, subject: 'feat: a', message: 'feat: a' }],
          files: []
        }
      ],
      directCommits: [
        {
          sha: commitSha,
          subject: 'fix: b',
          message: 'fix: b\n\nmentions #5',
          author: 'y',
          files: []
        }
      ],
      commitEntries: [
        { sha: prSha, subject: 'feat: a', prNumber: 10 },
        { sha: commitSha, subject: 'fix: b' }
      ],
      contributors: [{ name: 'x', additions: 1, deletions: 0 }]
    },
    { resolveReference: async () => 'issue' }
  )

  const prLine = body.split('\n').find((l) => l.startsWith('- a ('))
  const commitLine = body.split('\n').find((l) => l.startsWith('- b '))
  // The PR closes #5; the commit only mentions it, so it must say `refs`.
  assert.match(prLine, /closes \[#5\]/)
  assert.doesNotMatch(commitLine, /closes \[#5\]/)
  assert.match(commitLine, /refs \[#5\]/)
})

test('resolves ambiguous #132 to an issue or a PR via the injected resolver', async () => {
  const asIssue = await buildReleaseBody(
    {
      ...baseContext,
      directCommits: [
        {
          sha: 'd'.repeat(40),
          subject: 'docs: note',
          message: 'docs: note\n\nrelates to #132',
          author: 'a',
          files: []
        }
      ],
      commitEntries: [{ sha: 'd'.repeat(40), subject: 'docs: note' }],
      contributors: [{ name: 'a', additions: 0, deletions: 0 }]
    },
    { resolveReference: async () => 'issue' }
  )
  assert.match(
    asIssue.body,
    /\*\*Mentioned Issues:\*\* \[#132\]\(https:\/\/github\.com\/owner\/repo\/issues\/132\)/
  )

  const asPull = await buildReleaseBody(
    {
      ...baseContext,
      directCommits: [
        {
          sha: 'd'.repeat(40),
          subject: 'docs: note',
          message: 'docs: note\n\nrelates to #132',
          author: 'a',
          files: []
        }
      ],
      commitEntries: [{ sha: 'd'.repeat(40), subject: 'docs: note' }],
      contributors: [{ name: 'a', additions: 0, deletions: 0 }]
    },
    { resolveReference: async () => 'pull' }
  )
  assert.match(
    asPull.body,
    /\*\*Mentioned Pull Requests:\*\* \[#132\]\(https:\/\/github\.com\/owner\/repo\/pull\/132\)/
  )
})

test('API resolution failure yields unresolved references without dropping the link', async () => {
  const { body, warnings } = await buildReleaseBody(
    {
      ...baseContext,
      directCommits: [
        {
          sha: 'e'.repeat(40),
          subject: 'chore: tidy',
          message: 'chore: tidy\n\nsee #999',
          author: 'a',
          files: []
        }
      ],
      commitEntries: [{ sha: 'e'.repeat(40), subject: 'chore: tidy' }],
      contributors: [{ name: 'a', additions: 0, deletions: 0 }]
    },
    {
      resolveReference: async () => {
        throw new Error('boom')
      }
    }
  )
  assert.match(body, /\*\*Unresolved GitHub References:\*\* #999/)
  assert.equal(warnings.length, 1)
  assert.match(warnings[0], /#999/)
})

test('deduplicates audit sources for a reference seen in multiple places', async () => {
  const sha = 'f'.repeat(40)
  const { body } = await buildReleaseBody(
    {
      ...baseContext,
      mergedPrs: [
        {
          number: 20,
          title: 'fix: handle #1',
          body: 'this also references #1 again',
          author: 'dev',
          commits: [
            {
              sha,
              subject: 'fix: handle #1',
              message: 'fix: handle #1\n\ncloses #1'
            }
          ],
          files: []
        }
      ],
      commitEntries: [{ sha, subject: 'fix: handle #1', prNumber: 20 }],
      contributors: [{ name: 'dev', additions: 1, deletions: 0 }]
    },
    { resolveReference: async () => 'issue' }
  )

  const auditLine = body
    .split('\n')
    .find((l) => l.startsWith('- [#1]') && l.includes('merged PR'))
  assert.ok(auditLine, 'audit line for #1 exists')
  // pr-title and pr-body are distinct sources; the title is referenced once
  // even though `#1` appears in title text — dedup keys are per (kind, source).
  assert.equal(
    (auditLine.match(/merged PR \[#20\]\([^)]+\) title/g) ?? []).length,
    1
  )
  assert.match(auditLine, /merged PR \[#20\]\([^)]+\) body/)
  assert.match(auditLine, /commit \[`fffffff`\]\([^)]+\) subject/)
})

test('merged PR numbers are not listed as mentioned pull requests', async () => {
  const sha = '1'.repeat(40)
  const { body } = await buildReleaseBody(
    {
      ...baseContext,
      mergedPrs: [
        {
          number: 30,
          title: 'feat: thing (relates to PR #30)',
          body: '',
          author: 'dev',
          commits: [{ sha, subject: 'feat: thing', message: 'feat: thing' }],
          files: []
        }
      ],
      commitEntries: [{ sha, subject: 'feat: thing', prNumber: 30 }],
      contributors: [{ name: 'dev', additions: 1, deletions: 0 }]
    },
    { resolveReference: async () => 'pull' }
  )
  assert.doesNotMatch(body, /Mentioned Pull Requests/)
  assert.match(body, /\*\*Merged Pull Requests:\*\* \[#30\]/)
})

test('renders a Breaking Changes section when signalled', async () => {
  const sha = '2'.repeat(40)
  const { body } = await buildReleaseBody(
    {
      ...baseContext,
      directCommits: [
        {
          sha,
          subject: 'feat!: overhaul api',
          message: 'feat!: overhaul api\n\nBREAKING CHANGE: removes v1',
          author: 'dev',
          files: []
        }
      ],
      commitEntries: [{ sha, subject: 'feat!: overhaul api' }],
      contributors: [{ name: 'dev', additions: 9, deletions: 9 }]
    },
    { resolveReference: async () => null }
  )
  assert.match(body, /### ⚠️ Breaking Changes/)
  assert.match(body, /overhaul api/)
})

test('produces a stable title from the develop/main SHAs', async () => {
  const { title } = await buildReleaseBody(baseContext)
  assert.equal(
    title,
    `chore(release): merge develop (${'a'.repeat(40)}) into main (${'b'.repeat(40)})`
  )
})
