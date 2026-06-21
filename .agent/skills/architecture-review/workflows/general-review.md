# SOP: general review — repo-wide (requires HITL)

A deliberate, token-heavy architecture-risk pass over the whole repo through the
**predict-the-regret** lens (see `../SKILL.md`). It **emits a findings report and stops for a
human** — it never edits code. Run it on purpose, not casually.

## 1. Anchor on the written architecture

Read the docs the review judges against, in this order:

1. `docs/ARCHITECTURE.md` — the Layers table, Design Principles, Dependency Rules.
2. `docs/packages-concept.md` — what belongs in an app vs a package.
3. `docs/plugin-infrastructure.md` — dynamic discovery; no static plugin coupling.
4. Skim the other `docs/*-concept.md` / subsystem docs as the surface demands
   (`content-platform.md`, `sentry-telemetry.md`, `ui-ux-concept.md`, `mcp-integration.md`).

The repo's own docs are your authority. A finding that contradicts a doc is strong; a finding
that is only personal taste is weak — gate it accordingly (judgment → HITL).

## 2. Get the objective coupling/SoC signal first

```bash
node .agent/skills/architecture-review/tools/findings.mjs boundaries
```

This runs `scripts/check-boundaries.mjs` (cross-package import rules, product-agnostic source
rules, cycle detection). Every violation it reports is an **objective** `coupling`/`SoC`
finding — `confidence: High`, `subjectivity: objective`. Record those before you start reading
for the judgment-shaped risks; the deterministic signal is free and unarguable.

## 3. Run the lens across the layers

Walk the monorepo map (apps → app-browser → app-core → agent-core → contracts; the content
platform; plugins; edge; telemetry) and apply every question in the lens: hidden coupling,
churn-prone interfaces, SoC violations, premature/missing abstractions, maintenance cost, break
risk. **Do the failure analysis before proposing any fix.** Don't try to boil the ocean in one
pass — prefer the load-bearing boundaries (the ones the docs call out as invariants).

## 4. Write each risk as a structured finding

One record per risk, with the fields from the gating contract:

```
{ area, category, severity, confidence, subjectivity, disposition, rationale, suggestedChange, references? }
```

Set `confidence`/`subjectivity` honestly and let the rule decide `disposition`: `auto` only for
a non-directional category (`coupling`/`SoC`/`break-risk`) that is `High` + `objective`;
everything else `HITL`. Cite `docs/...` anchors in `references` where one applies. **When in
doubt, escalate.** Print the skeleton if useful:

```bash
node .agent/skills/architecture-review/tools/findings.mjs template
```

## 5. Validate the report

Write the report to a file (e.g. `architecture-review.json` — do not commit it) and validate:

```bash
node .agent/skills/architecture-review/tools/findings.mjs validate architecture-review.json
```

Use `"mode": "general"`. A report the tool rejects is **not done** — fix the records (usually a
mislabeled `auto`) and re-validate until it passes. The tool decides the auto/HITL split, not
your prose.

## 6. Stop for the human

Present the validated report (the auto/HITL split + each finding's rationale). **Do not edit
code.** Even findings the tool labeled `auto` are _not_ auto-applied in general review — `auto`
here only classifies them; mode 1 always hands the triage to a human. Recommend an order
(highest severity / objective defects first) and stop.
