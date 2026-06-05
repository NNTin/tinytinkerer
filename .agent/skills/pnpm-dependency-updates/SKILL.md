# pnpm-dependency-updates

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

Keep pnpm workspace dependency updates deterministic, age-gated, exact-pinned, and supply-chain reviewed. Read `../../README.md` first for the WAT framework.

## When to use

- Updating npm dependencies in this pnpm monorepo.
- Reviewing dependency drift, install lifecycle scripts, audit findings, or exact-version policy failures.
- Preparing CI or package-manager changes that affect dependency resolution/install security.

## How

1. Follow `workflows/update-dependencies.md`.
2. Use the tools under `tools/` or the equivalent root scripts instead of manually editing many package manifests.
3. Keep `peerDependencies` as compatibility ranges; exact-pin only direct `dependencies` and `devDependencies`.
4. Preserve the one-week `minimumReleaseAge` gate. Do **not** add `minimumReleaseAgeExclude`; if a dependency newer than the gate is required, stop and ask a human.

## Available tools

- `tools/dependency-status.sh` / `pnpm dependency:status` — print pnpm policy settings and direct outdated dependency status.
- `tools/pin-direct-dependencies.sh` / `pnpm pin:dependencies` — rewrite direct non-workspace dependencies/devDependencies to the exact resolved versions, then refresh the lockfile.
- `tools/check-supply-chain.sh` — run exact-specifier, install-lifecycle, audit, and skill README checks.

## Constraints

- Use `pnpm update -r --latest` from the repo root so all workspaces resolve together under the configured age gate.
- Use scriptless CI installs (`pnpm install --frozen-lockfile --ignore-scripts`) and run `pnpm bootstrap:scriptless-install` only in jobs that need the reviewed native/CLI binaries.
- Any dependency with `preinstall`, `install`, or `postinstall` must be reviewed and named in either `onlyBuiltDependencies` (approved to run by explicit bootstrap/rebuild steps) or `ignoredBuiltDependencies` (blocked) in `pnpm-workspace.yaml`.
- For `pnpm audit --audit-level=moderate`: update a direct dependency when possible; for unavoidable transitive-only findings, add a root `overrides` entry in `pnpm-workspace.yaml` with a GHSA/CVE comment explaining the override.

## Success criteria

- Direct dependencies/devDependencies are exact and lockfile is frozen-installable.
- No unreviewed install lifecycle scripts are present.
- `pnpm audit --audit-level=moderate`, `pnpm check:skill-readme`, and the repo's normal build/typecheck/lint/test suite pass.
