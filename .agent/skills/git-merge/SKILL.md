# git-merge

<!-- BEGIN GENERATED: .agent/README.md — do not edit; run `pnpm sync:skill-readme`

# `.agent` — WAT skills (Workflow · Agent · Tools)

Skills the agent uses to work in this repo. Core idea: **offload deterministic steps to scripts so you stay focused on decisions.** Chained 90%-accurate manual steps decay fast (0.9^5 ≈ 59%) — scripts don't drift, and they save tokens.

## Skill layout

```
.agent/skills/<skill-name>/
  SKILL.md      # when to use, how, available tools, constraints, success criteria
  workflows/    # markdown SOPs (step-by-step procedures)
  tools/        # deterministic scripts the workflows call
```

## How you (the agent) work

1. Match the task to a skill, read its `SKILL.md`.
2. Scan workflow **filenames** for a relevant SOP — don't read every file.
3. Follow the SOP; run the tool scripts instead of doing the steps by hand.
4. **Self-evolve:** if you solved something repeatable the hard way, capture it as a new workflow SOP (+ tool). Future agents thank you.

END GENERATED: .agent/README.md -->

Merge a commit, branch, PR head, or remote ref into the current branch and push
it — **locally**, with `git merge` + `git push`, never `gh`. Read
`../../README.md` first for the WAT framework.

## When to use

- A user asks to merge a specific commit, branch, PR, or ref into the current
  branch.
- A user asks to resolve merge conflicts and push the result.

## How

Run the tool — it is the procedure, and it prints the exact next steps every
time it stops:

```bash
bash .agent/skills/git-merge/tools/merge-and-push.sh <target-ref>
```

It installs the husky hooks if needed, runs the fast-forward-else-merge-commit,
lets the hook rewrite the merge subject, and pushes — verbosely. It stops without
clobbering anything on a dirty worktree, an unknown ref, a merge conflict, or a
rejected push; resume by hand from the steps it prints. Conflict resolution is
judgment work the tool hands back to you: resolve semantically, inspecting both
sides.

## Available tools

- `tools/merge-and-push.sh <target-ref> [--no-push]` — the full merge→push
  procedure. Exit codes: 0 ok, 1 usage, 2 dirty worktree, 3 ref not found,
  4 conflicts (left in progress for manual resolution), 5 push rejected. Read its
  header for details.

## Constraints

- Local `git merge` only: fast-forward when possible, otherwise a merge commit
  (Git's default `--ff`). **Never** rebase, squash, or use `gh` to land commits.
- Hooks must be installed (husky v9, shims in gitignored `.husky/_/`, regenerated
  by `pnpm install` — not `setup:workspace`) so `prepare-commit-msg` rewrites the
  subject to `chore(merge): merge <X> into <Y>`. Let it — never hand-write the
  subject or pass `-m`.
- Never force-push, `git reset --hard`, or `git checkout --` unless explicitly
  asked. If a protected branch rejects the push (e.g. GH013), report it and stop.

## Success criteria

- The ref is merged via local `git merge` with the hook-rewritten subject;
  conflicts (if any) resolved and committed.
- The remote branch contains the merge commit — or a protected-branch rejection
  was reported without falling back to `gh`.
- The worktree is clean at handoff.
