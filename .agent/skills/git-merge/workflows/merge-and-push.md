# SOP: merge and push a ref

Use this when a user asks you to merge a commit, branch, PR head, or remote ref
and push the result. This repo merges **locally** with `git merge` and publishes
with `git push`. Never merge through `gh` (`gh pr merge`), never rebase, never
squash.

**Fast path:** `bash .agent/skills/git-merge/tools/merge-and-push.sh <target-ref>`
runs steps 1, 3, and 6 below deterministically and verbosely (hooks → merge →
push). It stops with explicit next steps on a dirty worktree, unknown ref,
conflict, or rejected push — at which point you resume by hand from the matching
step. The rest of this SOP is the reasoning and the manual fallback.

## 1. Ensure the husky hooks are installed

The repo uses **husky v9**. The hook scripts live in `.husky/` (committed), but
Git only runs them through the generated wrapper at `core.hooksPath`, which is
`.husky/_`. That `.husky/_/` shim directory is **gitignored** and is regenerated
by the `prepare` script (`husky`) during `pnpm install`.

Why this matters: `.husky/prepare-commit-msg` rewrites a merge subject to
`chore(merge): merge <MERGED_COMMIT> into <TARGET_COMMIT>`. If the shims are
missing, the hook never fires and the merge lands with a raw `Merge branch ...`
subject that does not match the repo's conventional-commit format.

Check that the hooks are wired up **in the worktree you will commit in**
(`core.hooksPath` is relative to that worktree — if you merge in a separate
worktree, e.g. `develop` checked out elsewhere, the shims must exist there):

```bash
git config core.hooksPath          # expect: .husky/_
ls .husky/_/prepare-commit-msg     # must exist
```

If `.husky/_/prepare-commit-msg` is missing, regenerate the shims:

```bash
pnpm install
```

Do **not** use `pnpm setup:workspace` for this — it runs `pnpm install
--ignore-scripts`, which skips the `prepare`/husky step and does **not** install
the hooks. (`pnpm exec husky` or `pnpm prepare` also regenerate the shims if a
full install is undesirable.)

## 2. Establish the merge target and destination

From the repo root, capture the current state:

```bash
git status --short --branch
git rev-parse --abbrev-ref HEAD
git remote -v
git log --oneline --decorate -5
```

Confirm the target ref exists locally or remotely. If the user named a raw SHA,
`git merge <sha>` is enough; if they named a PR or branch, fetch the remote ref
first if needed (e.g. `git fetch origin <branch>`).

If the worktree has unrelated dirty changes, do not overwrite or revert them.
Continue only when the dirty changes are irrelevant to the merge, or stop and
ask the user if they block a safe merge.

## 3. Run the merge

```bash
git merge <target-ref>
```

Plain `git merge` is exactly what this repo wants: it **fast-forwards** when the
current branch is an ancestor of the target, and otherwise creates a **merge
commit** (Git's default `--ff`). Do not pass `--rebase`, do not `git rebase`
first, and do not squash.

When a merge commit is created, Git invokes `prepare-commit-msg` with
`COMMIT_SOURCE=merge` and the default `Merge branch '...'` subject, so the hook
rewrites it for you. Let it — do not hand-write a conventional merge subject and
do not pass `-m` to set one. `git merge -m "..."` still fires the hook with
`COMMIT_SOURCE=merge`, **but** the hook only rewrites a subject that begins with
`Merge ` — a custom `-m` subject does not match that pattern, so it is left as-is
and never gets the conventional `chore(merge): ...` format. Rely on the default
subject + the hook instead.

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

## 4. Verify before committing

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
with `pnpm install` and rerun the same verification. Do not hide real failures.

## 5. Commit the merge

This step only applies when the merge created a merge commit and/or you resolved
conflicts (a fast-forward leaves nothing to commit). Inspect what is staged:

```bash
git diff --cached --stat
git diff --cached --name-only
```

Commit with Git's merge message and let the hook rewrite the subject:

```bash
git commit --no-edit
```

Do not hand-edit the subject and do not pass `-m`. The `prepare-commit-msg` hook
rewrites it to `chore(merge): merge <MERGED_COMMIT> into <TARGET_COMMIT>`. After
committing, confirm the subject was rewritten:

```bash
git log -1 --pretty=%s
```

If it still reads `Merge branch ...`, the hooks were not installed — go back to
step 1, then `git commit --amend --no-edit` to let the hook run.

## 6. Push

Push the current branch to its intended destination:

```bash
git push origin <current-branch>
```

If a **protected branch rejects the push** (for example GH013, "Changes must be
made through a pull request"), **report the rejection and stop.** Do not
force-push, do not bypass repository rules, and do not fall back to `gh` or route
the merge through a PR. Surface the exact error to the user and let them decide.

(Note: direct pushes to `develop` have been succeeding in this repo, so treat a
rejection as the exception to surface — not the normal path.)

## 7. Confirm and report

Finish with:

```bash
git status --short --branch
git rev-parse HEAD origin/<destination-branch>
git log -1 --pretty=%s
```

Report:

- merge commit SHA (or "fast-forward, no merge commit")
- the rewritten merge subject (`chore(merge): ...`)
- branch pushed
- files that had conflicts
- verification commands and results
- any protected-branch rejection, verbatim, if the push was blocked
