# pnpm-workspace

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

Set up the pnpm workspace and keep its dependency updates deterministic, age-gated, exact-pinned, and supply-chain reviewed — so local work gets the same install-time protections as CI. Read `../../README.md` first for the WAT framework.

## When to use

- Setting up the workspace (first checkout, fresh clone, or after lockfile changes).
- Updating npm dependencies in this pnpm monorepo.
- Reviewing dependency drift, install lifecycle scripts, audit findings, or exact-version policy failures.
- Preparing CI or package-manager changes that affect dependency resolution/install security.

## How

1. To install the environment, follow `workflows/setup-workspace.md` (`pnpm setup:workspace`).
2. To change dependencies, follow `workflows/update-dependencies.md`.
3. Use the root `pnpm` scripts below instead of manually editing many package manifests.
4. Keep `peerDependencies` as compatibility ranges; exact-pin only direct `dependencies` and `devDependencies`.
5. Preserve the one-week `minimumReleaseAge` gate. Do **not** add `minimumReleaseAgeExclude`; if a dependency newer than the gate is required, stop and ask a human.

## Available tools

- `pnpm setup:workspace` — install the workspace the secure way: frozen, scriptless install, then rebuild only the reviewed native binaries via `pnpm bootstrap:scriptless-install`. (Named `setup:workspace`, not `setup`, because bare `pnpm setup` is a pnpm built-in command.)
- `pnpm dependency:status` — print pnpm policy settings and direct outdated dependency status.
- `pnpm pin:dependencies` — rewrite direct non-workspace dependencies/devDependencies to the exact resolved versions (run `pnpm install --lockfile-only` afterwards to refresh the lockfile).
- `tools/check-supply-chain.sh` — run exact-specifier, install-lifecycle, audit, and skill README checks in one shot.

## Constraints

- Use `pnpm update -r --latest` from the repo root so all workspaces resolve together under the configured age gate.
- Use scriptless CI installs (`pnpm install --frozen-lockfile --ignore-scripts`) and run `pnpm bootstrap:scriptless-install` only in jobs that need the reviewed native/CLI binaries.
- Any dependency with `preinstall`, `install`, or `postinstall` must be reviewed and named in either `onlyBuiltDependencies` (approved to run by explicit bootstrap/rebuild steps) or `ignoredBuiltDependencies` (blocked) in `pnpm-workspace.yaml`.
- For `pnpm audit --audit-level=moderate`: update a direct dependency when possible; for unavoidable transitive-only findings, add a root `overrides` entry in `pnpm-workspace.yaml` with a GHSA/CVE comment explaining the override.

## Success criteria

- Direct dependencies/devDependencies are exact and lockfile is frozen-installable.
- No unreviewed install lifecycle scripts are present.
- `pnpm audit --audit-level=moderate`, `pnpm check:skill-readme`, and the repo's normal build/typecheck/lint/test suite pass.
