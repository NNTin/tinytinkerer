// lint-staged configuration, run on git-staged files by the Husky pre-commit
// hook (.husky/pre-commit) via `lint-staged --config config/lint-staged.config.mjs`.
//
// It mirrors the CI quality gates so problems are fixed locally before they reach
// CI, keeping the ESLint/Prettier division of responsibility (see
// docs/ARCHITECTURE.md#enforcement):
//
//   - Prettier formats every staged file it understands. `--ignore-unknown` skips
//     files Prettier has no parser for, and .prettierignore keeps it off generated
//     and vendored files (lockfile, build outputs, **/*.generated.ts, …). This is
//     the local counterpart to the `format:check` CI gate.
//   - ESLint --fix runs ONLY on staged TypeScript sources that the type-aware
//     config can actually resolve — files under a package/app `src` or `tests`
//     directory, exactly what the per-package `eslint src` / `eslint src tests`
//     scripts cover. Root-level scripts and config files (scripts/*.mjs,
//     eslint.config.mjs, …) live outside every tsconfig, so `projectService`
//     rejects them; including them here would fail every commit. They are still
//     formatted by Prettier above.
//
// The function form is used (rather than glob→command mapping) so Prettier can run
// across all staged files in a single pass while ESLint is limited to the
// resolvable subset, with no overlapping globs racing to rewrite the same file.

// Matches staged paths like `packages/.../src/x.ts` or `apps/web/tests/y.tsx`.
const ESLINT_SOURCE_RE = /(?:^|\/)(?:apps|packages)\/.*\/(?:src|tests)\/.*\.(?:ts|tsx|mts|cts)$/

// Quote each path so lint-staged's argv parser keeps filenames with spaces intact.
const toArgs = (files) => files.map((file) => JSON.stringify(file)).join(' ')

export default (stagedFiles) => {
  const tasks = []

  const eslintTargets = stagedFiles.filter((file) => ESLINT_SOURCE_RE.test(file))
  if (eslintTargets.length > 0) {
    tasks.push(`eslint --fix ${toArgs(eslintTargets)}`)
  }

  // Prettier runs last so it owns final formatting (after any ESLint --fix edits).
  if (stagedFiles.length > 0) {
    tasks.push(`prettier --write --ignore-unknown ${toArgs(stagedFiles)}`)
  }

  return tasks
}
