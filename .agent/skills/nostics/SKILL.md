# nostics

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

Define and read **developer-facing structured diagnostics** with [`nostics`](https://github.com/vercel-labs/nostics). Read `../../README.md` first for the WAT framework.

`nostics` replaces ad-hoc `console.error('...')` / `throw new Error('...')` strings with **stable, code-named diagnostics**: each carries a `why`, an actionable `fix`, an optional `cause`, source locations, and a docs link. It is a **local-development DX layer** — wired through `@nostics/unplugin`'s strip transform so it is **completely removed from the production bundle**.

## When to use

- You are adding (or improving) an **error / warning surfaced to a developer** in the browser shells and want it to be greppable, looked-up by code, and self-explaining instead of an opaque string.
- You are debugging locally and want to **read the diagnostics the running app emitted** (they are collected to `.nostics.log`).

**When NOT to use — this is the important boundary:**

- **Production error handling is NOT nostics.** The prod source of truth is the **edge error contract** (`edgeErrorResponseSchema` in `@tinytinkerer/contracts`) plus **Sentry telemetry** (`@tinytinkerer/sentry-telemetry`). A diagnostic is stripped from prod, so it can never be the thing prod relies on. If your job is "an error showed up in prod / Sentry", use the **`sentry-debugging`** skill, not this one.
- nostics is the **dev ergonomics layer on top of** those contracts, never a replacement for them.

## How

1. **Define or reuse a code** — all codes live in one foundation module, `packages/app/app-browser/src/diagnostics.ts` (`defineDiagnostics(...)`). To add one, follow `workflows/define-a-diagnostic.md`.
2. **Use it at an error site** — `import { diagnostics } from './diagnostics'` (relative; respect the package boundaries) and either _report_ it (`diagnostics.CODE({...})`) or _throw_ it (`throw diagnostics.CODE({...})`). The report-vs-throw choice decides what survives the prod build — see the workflow.
3. **Read what the app emitted in dev** — run `node .agent/skills/nostics/tools/read-diagnostics.mjs`. Full SOP: `workflows/read-dev-diagnostics.md`.
4. Scan `workflows/` filenames for the matching SOP. Capture a new SOP if you solve something repeatable.

## Available tools

- `tools/read-diagnostics.mjs [--watch] [--code <CODE>] [--file <path>]` — parses the NDJSON `.nostics.log` that the dev-server collector writes (searches `apps/web`, `apps/mobile`, `apps/widget`, then a repo-root fallback; first existing wins) and pretty-prints each diagnostic's code / why / fix / sources / docs / cause. `--watch` tails it; `--code` filters to one code. Run this instead of `cat`-ing the raw log.
- `nostics` (runtime, MIT) — `defineDiagnostics`, `createConsoleReporter`, `formatDiagnostic`, and the `nostics/reporters/{dev,node,fetch}` + `nostics/formatters/{ansi,json}` subpaths.
- `@nostics/unplugin` (build tooling, MIT) — `@nostics/unplugin/strip-transform` (`nosticsStrip`) and `@nostics/unplugin/dev-server-collector` (`nosticsCollector`), wired into every browser shell's vite config (`apps/web`, `apps/mobile`, `apps/widget`).

## Constraints

- **One foundation module.** Define every code in `packages/app/app-browser/src/diagnostics.ts`. Do not scatter `defineDiagnostics()` calls — the strip transform and the docs page both assume a single source of truth.
- **Respect package boundaries** (`scripts/check-boundaries.mjs`). The diagnostics module lives in `@tinytinkerer/app-browser`; import it with a **relative** path from sibling files. Do not add a cross-package `@tinytinkerer/*` import to reach it, and do not pull `nostics` into the edge worker or a leaf package — prod error handling there is the edge contract + Sentry.
- **Report-only diagnostics strip; thrown diagnostics stay.** The strip transform guards _expression-statement_ diagnostic calls with `process.env.NODE_ENV !== 'production'` (gone in prod) but keeps `throw diagnostics.CODE(...)` (a real error). If you need the error to exist in prod, `throw` it **and** know its `Diagnostic` (an `Error` subclass) ships; if it is purely a dev hint, _report_ it so it vanishes. Reporters are additionally gated on `import.meta.env.DEV`, so dev machinery never ships either way.
- **The age-gate exception is time-boxed.** `nostics@1.0.0` + `@nostics/unplugin@1.0.0` are pinned under a documented `minimumReleaseAgeExclude` waiver in `pnpm-workspace.yaml` (granted 2026-06-17, remove ~2026-06-22). Do not bump to `1.1.x` under that waiver; if you need a newer version, stop and ask a human (the gate forbids it otherwise).
- **Verify the strip after touching the wiring.** If you change `vite.config.ts` or the diagnostics module, re-prove prod is clean: `pnpm --filter @tinytinkerer/web exec vite build` then grep `apps/web/dist` for your code name / `why` text / `nostics:report` — expect zero matches.

## Success criteria

A new diagnostic is defined in the one foundation module with typed `why`/`fix` and a docs entry; the error site uses it (report or throw, chosen deliberately); `pnpm -r typecheck`, `-r lint`, `node scripts/check-boundaries.mjs`, and `pnpm format:check` pass; and a production `vite build` of `apps/web` contains **no** nostics dev machinery (code name, `why`/`fix` text, reporters, `nostics:report` collector channel).
