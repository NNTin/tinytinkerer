# SOP: plan review — spawnable subagent (no HITL, confidence-gated)

Review a **written implementation plan** (or a PR's diff against its plan) through the
**predict-the-regret** lens (see `../SKILL.md`), **with no human in the loop**. A planning or
implementing agent spawns this inline so a design gets a regret-review before it is built.

Because there is no human watching, the auto/HITL gate is load-bearing: this workflow may fold
in **only** `disposition: auto` findings (schema-certified objective defects) and must
**surface everything else** without applying it. When in doubt, escalate.

## 1. Read the inputs

The caller provides:

- **The artifact** — the plan text, or a PR diff + the plan it claims to implement.
- **`timing`** ∈ `before | after | both`. **Default `after`.**
  - `after` (default) — review the concrete drafted plan. The right call for most work: you
    review a real artifact, not a sketch.
  - `before` — opt-in for **foundational / high-stakes** designs (a new package, a new layer,
    a contract every caller will depend on): catch a regret before the plan hardens.
  - `both` — ideal but token-expensive; reserve for the highest-stakes foundational designs.
    Run a `before` pass on the sketch, then an `after` pass on the drafted plan.

  Record the timing you ran under; it goes in the report's `timing` field.

## 2. Anchor on the architecture the plan touches

Read the `docs/ARCHITECTURE.md` Layers + Dependency Rules and the `docs/packages-concept.md`
blocks for the layers the plan changes, plus the subsystem doc if relevant
(`plugin-infrastructure.md`, `content-platform.md`, `sentry-telemetry.md`,
`mcp-integration.md`). The plan is judged against these, not against taste.

## 3. If a diff exists, get the objective signal

When reviewing a PR/diff (not a pure plan), run the boundary check — a plan that _introduces_ a
boundary violation is an objective, auto-eligible defect:

```bash
node .agent/skills/architecture-review/tools/findings.mjs boundaries
```

Pure-plan-text review can't run this (no code yet); rely on the lens and escalate coupling
calls you can't verify.

## 4. Run the lens — failure analysis first

Apply every lens question to the plan: what hidden coupling does it add, which interface it
introduces will churn, does it put logic in the wrong layer, is it abstracting for one caller
or duplicating instead of sharing, what will it cost to maintain, what will it let a future
developer accidentally break. **Do not propose fixes until the failure analysis is done.**

## 5. Classify honestly — the gate is the whole point

Write one structured record per risk and set `confidence` × `subjectivity` truthfully:

- **`auto`** — the plan has an **objective defect** the maintainer would unambiguously accept:
  a schema declared but never applied, a boundary/SoC violation, a contract that doesn't match
  its types, dead/duplicated coupling. Requires a non-directional category
  (`coupling`/`SoC`/`break-risk`) with `confidence: High` **and** `subjectivity: objective`.
- **`HITL`** — a judgment or directional call: "this abstraction is premature", "this interface
  will churn", a naming/trade-off opinion, anything your preferred fix could conflict with the
  maintainer's intent on. Always for the directional categories.

Do **not** inflate confidence or relabel a judgment call as `SoC` to make it `auto`. The tool
will reject a mislabeled `auto`, but the honesty is yours to keep — a false `auto` is the one
outcome this whole gate exists to prevent.

## 6. Validate — the tool enforces the split

Write the report (`"mode": "plan"`, the `timing` you ran under) to a file and:

```bash
node .agent/skills/architecture-review/tools/findings.mjs validate <report.json>
```

If it rejects the report, you mislabeled a finding — fix it (almost always: an `auto` that
should be `HITL`) and re-validate. **Do not proceed on a rejected report.**

## 7. Apply auto, surface HITL

- **Apply only the `disposition: auto` findings** to the plan/code — these are the
  schema-certified objective defects. Fold them in directly.
- **Surface every `HITL` finding** back to the calling agent / the human: the rationale, the
  suggested change, the doc it offends. **Do not apply them.** They are the calls a human
  makes.
- Return the validated report so the caller has the full record (what was auto-applied, what is
  waiting on a human, and the timing the review ran under).
