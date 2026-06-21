# SOP: targeted review — one area (requires HITL)

The **predict-the-regret** lens (see `../SKILL.md`) scoped to a single directory, package,
app, or feature. Same contract as the general review — **emit a findings report and stop for a
human, no edits** — but bounded so it is cheap enough to run often (a new `packages/*`, a churny
module, a boundary you suspect is eroding).

## 1. Fix the scope

State exactly what is under review and what is out of scope — one package
(`packages/app-core`), one app (`apps/widget`), a directory, or a feature that spans a few
files. Everything outside the scope is context, not a finding target. You will pass this string
to the tool as `scope`.

## 2. Anchor on the relevant docs

Read the slices of the architecture docs that govern this area — don't re-read everything:

- Always: the row(s) for this layer in the `docs/ARCHITECTURE.md` Layers table + its
  Dependency Rules, and the matching `docs/packages-concept.md` responsibility block.
- A plugin? `docs/plugin-infrastructure.md`. Content? `docs/content-platform.md`. Telemetry?
  `docs/sentry-telemetry.md`. Edge/MCP? `docs/mcp-integration.md`. UI? `docs/ui-ux-concept.md`.

## 3. Objective coupling/SoC signal

```bash
node .agent/skills/architecture-review/tools/findings.mjs boundaries
```

The check is repo-wide; **read only the violations that touch your scope's package(s)**. Those
are objective `coupling`/`SoC` findings (`High` + `objective`). A clean run is not a pass on its
own — the boundary check catches _physical_ coupling, not the judgment-shaped risks the lens is
for.

## 4. Apply the lens within scope

Run every lens question against the scoped area: hidden coupling (does it reach past its
allowed dependencies?), churn-prone interfaces it exports, SoC (is anything here that belongs in
another layer?), premature/missing abstraction, maintenance cost, break risk. **Failure
analysis first, fixes second.**

## 5. Write structured findings and validate

One structured record per risk (same fields as the gating contract). Let `confidence` ×
`subjectivity` drive `disposition` — directional calls (`premature-abstraction`,
`missing-abstraction`, `maintenance-cost`, `churn-risk`) are always `HITL`. Cite doc anchors in
`references`. Then write the report (`"mode": "targeted"`, your `scope` string) to a file and:

```bash
node .agent/skills/architecture-review/tools/findings.mjs validate <report.json>
```

Fix anything the tool rejects and re-validate. The tool owns the auto/HITL split.

## 6. Stop for the human

Present the validated report and **stop. No edits** — targeted review classifies findings but
hands every decision (including `auto`-labeled ones) to a human. If the scope turns out to be
the wrong unit (the risk is really a cross-layer one), say so and recommend a general review
instead.
