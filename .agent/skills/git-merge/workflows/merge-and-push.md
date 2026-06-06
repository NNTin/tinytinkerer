# SOP: merge and push a ref

Use this when a user asks you to merge a commit, branch, PR head, or remote ref
and push the result.

## 1. Establish the merge target and destination

From the repo root, capture the current state:

```bash
git status --short --branch
git rev-parse --abbrev-ref HEAD
git remote -v
git log --oneline --decorate -5
```

Confirm the target ref exists locally or remotely. If the user named a raw SHA,
`git merge <sha>` is enough; if they named a PR or branch, fetch the remote ref
first if needed.

Before creating branches or PRs, check whether a PR already exists for the same
target or source branch:

```bash
gh pr list --base <destination-branch> --state open --json number,title,headRefName,baseRefName,commits,statusCheckRollup
gh pr view <known-pr-number> --json number,state,url,headRefName,baseRefName,commits,statusCheckRollup
```

If an existing PR contains the target commit or source branch, treat it as the
canonical PR. Do not create a duplicate. If the final merge commit needs checks,
update or reuse that existing PR branch whenever possible.

Common trap: PR checks on the source head do not always satisfy protected-branch
rules for the final merge commit. If the source PR already passed but the push
rejects a new local merge commit, investigate the missing checks for that exact
merge commit instead of opening a second PR with the same commits.

If the worktree has unrelated dirty changes, do not overwrite or revert them.
Continue only when the dirty changes are irrelevant to the merge, or stop and
ask the user if they block a safe merge.

## 2. Run the merge

```bash
git merge <target-ref>
```

If Git reports no conflicts, continue to verification. If Git reports conflicts,
move deliberately:

```bash
git status --short
rg -n "^(<<<<<<<|=======|>>>>>>>)" .
git diff --cc
```

For each conflicted file:

- Inspect the conflict in context, including nearby code and tests.
- Compare both sides when necessary with `git show :1:<path>`,
  `git show :2:<path>`, and `git show :3:<path>`.
- Keep the behavior that satisfies both branches when possible.
- Preserve formatting conventions from the surrounding file.
- Remove all conflict markers.
- Validate structured files with their parser, such as `node -e` for JSON.

After resolving a file, stage it:

```bash
git add <path>
```

Use `git status --short` until no `UU` or other unmerged entries remain.

## 3. Verify before committing

Always run:

```bash
git diff --check
```

Then run focused verification for the touched packages or files. Prefer package
scripts over ad hoc commands, for example:

```bash
pnpm --filter <workspace-package> test
pnpm --filter <workspace-package> typecheck
```

If a test fails because the local environment is stale, refresh dependencies
with the repo's documented setup command and rerun the same verification. Do not
hide real failures.

## 4. Commit the merge

Inspect what is staged:

```bash
git diff --cached --stat
git diff --cached --name-only
```

Commit with Git's merge message unless hooks require a conventional merge
message:

```bash
git commit --no-edit
```

If the repository rejects the generated message, amend only the message into the
repo's accepted merge format.

## 5. Push safely

Push the current branch to its upstream or intended destination:

```bash
git push origin <current-branch>
```

If the remote rejects the push because a protected branch is waiting for CodeQL
or other required checks, investigate before creating anything:

1. Identify the rejected commit SHA from the push error.
2. Compare it to the existing PR head SHA and status checks:
   ```bash
   gh pr checks <existing-pr-number>
   gh api repos/<owner>/<repo>/commits/<rejected-sha>/check-runs --jq '.check_runs[] | [.name,.status,.conclusion] | @tsv'
   ```
3. If the existing PR checks are for the PR head but the rejection is for a new
   local merge commit, the checks did not fail; they ran on the wrong commit for
   the branch rule.
4. Reuse the existing PR branch by pushing the exact merge commit to that branch,
   if doing so will not overwrite unrelated work:
   ```bash
   git merge-base --is-ancestor <existing-pr-head-sha> HEAD
   git push origin HEAD:<existing-pr-branch>
   ```
   Only do this when the ancestor check succeeds, making the update a
   fast-forward. Otherwise ask the user before choosing a different branch.
5. Wait for checks on the exact merge commit, then retry the direct push if the
   rule allows the checked commit, or merge the existing PR.
6. Confirm the protected branch now points at the merge commit.

Only create a new temporary branch/PR when no existing PR covers the target, or
when updating the existing PR branch would overwrite unrelated work. Record why
the existing PR could not be reused.

Do not force-push or bypass repository rules.

## 6. Confirm and report

Finish with:

```bash
git status --short --branch
git rev-parse HEAD origin/<destination-branch>
```

If temporary remote branches were deleted by GitHub after the PR merge, run
`git fetch --prune origin` to clean stale remote-tracking refs.

Report:

- merge commit SHA
- branch pushed
- files that had conflicts
- verification commands and results
- PR URL reused or created, if a protected-branch check path was needed
