# SOP: plan review — review a plan before it is built

Review a **written implementation plan** (or a PR's diff against its plan) through the
**predict-the-regret** lens (see `../SKILL.md`) _before_ the design hardens. Spawnable inline:
a planning or implementing agent invokes it, and it **returns the architectural risks as open
points** for the user (via the calling agent) to weigh in on. It does not auto-apply anything —
architecture calls are the user's.

## 1. Read the inputs

- **The artifact** — the plan text, or a PR diff + the plan it claims to implement.
- **`timing`** ∈ `before | after | both`. **Default `after`.**
  - `after` (default) — review the concrete drafted plan. Right for most work: you review a
    real artifact, not a sketch.
  - `before` — opt-in for **foundational / high-stakes** designs (a new package, a new layer, a
    contract every caller will depend on): catch a regret before the plan hardens.
  - `both` — ideal but token-expensive; reserve for the highest-stakes foundational designs.

## 2. Anchor on the architecture the plan touches

Read the `docs/ARCHITECTURE.md` Layers + Dependency Rules and the `docs/packages-concept.md`
blocks for the layers the plan changes, plus the subsystem doc if relevant
(`plugin-infrastructure.md`, `content-platform.md`, `sentry-telemetry.md`,
`mcp-integration.md`). The plan is judged against these, not against taste.

## 3. Run the lens — failure analysis first

Apply every lens question to the plan: what hidden coupling does it add, which interface it
introduces will churn, does it let logic settle in the wrong layer, is it abstracting for one
caller or duplicating instead of sharing, what will it cost to maintain, what will it let a
future developer accidentally break. **Do not propose directions until the failure analysis is
done.**

Aim above CI: `pnpm lint` / `pnpm typecheck` will catch a physical boundary or type violation
once the code exists. Spend the review on the risks they can't — the design choices that are
green today and regret tomorrow.

## 4. Return the risks as open points

Hand the calling agent / user the findings as **open points**, each with: area, the regret (why
it bites at 6 months / 10× growth), the doc reference where one applies, and a suggested
direction phrased as a recommendation. Note the timing the review ran under. **Do not apply
anything** — surface the risks and let the user decide before the plan is built.
