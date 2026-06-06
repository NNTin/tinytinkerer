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
the result safely. Read `../../README.md` first for the WAT framework.

## When to use

- A user asks to merge a specific commit, branch, PR, or ref into the current
  branch.
- A user asks to resolve merge conflicts and push the result.
- A protected branch rejects a direct merge push and the agent needs to route the
  exact merge commit through required checks without force-pushing or creating a
  duplicate PR.

## How

1. Follow `workflows/merge-and-push.md`.
2. Treat conflict resolution as judgment work: inspect both sides, preserve
   intended behavior, and keep unrelated changes untouched.
3. Report the merge commit, pushed branch, conflict files, and verification.

## Available tools

No skill-local tool scripts are provided. Merge conflicts cannot be solved
correctly by a generic script; use Git, repo tests, and semantic code review.

## Constraints

- Start with `git status --short --branch`; never overwrite unrelated dirty
  work.
- Do not use destructive commands such as `git reset --hard` or
  `git checkout --` unless the user explicitly asked for that operation.
- Resolve conflicts semantically, not by blindly choosing one side.
- Stage only files that belong to the merge resolution.
- Verify before pushing. If tests cannot be run, say exactly why.
- Before creating any PR or temporary branch, check whether an existing PR
  already covers the merge target. Reuse or update that PR instead of creating a
  duplicate.
- Never force-push to bypass protected branch rules. If rules reject a push
  because checks are missing, investigate which commit lacks checks. PR-head
  checks do not necessarily satisfy rules for the final merge commit.

## Success criteria

- The requested ref is merged into the intended branch.
- All conflicts are resolved and committed.
- Relevant checks/tests have passed or any inability to run them is reported.
- The intended remote branch contains the merge commit.
- Any existing PR for the target was reused or explicitly ruled out.
- The worktree is clean at handoff.
