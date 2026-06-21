# SOP: general review — repo-wide

A deliberate, token-heavy architecture-risk pass over the whole repo through the
**predict-the-regret** lens (see `../SKILL.md`). It surfaces **open points for the user** and
stops — it never edits code. Run it on purpose, not casually.

## 1. Anchor on the written architecture

Read the docs the review judges against, in this order:

1. `docs/ARCHITECTURE.md` — the Layers table, Design Principles, Dependency Rules.
2. `docs/packages-concept.md` — what belongs in an app vs a package.
3. `docs/plugin-infrastructure.md` — dynamic discovery; no static plugin coupling.
4. Skim the other `docs/*-concept.md` / subsystem docs as the surface demands
   (`content-platform.md`, `sentry-telemetry.md`, `ui-ux-concept.md`, `mcp-integration.md`).

The repo's own docs are your authority. A finding that contradicts a doc is strong; one that is
only personal taste is weak — say so.

## 2. Run the lens across the layers

Walk the monorepo map (apps → app-browser → app-core → agent-core → contracts; the content
platform; plugins; edge; telemetry) and apply every question in the lens: hidden coupling,
churn-prone interfaces, SoC drift, premature/missing abstractions, maintenance cost, break
risk. **Do the failure analysis before proposing any direction.** Prefer the load-bearing
boundaries (the ones the docs call out as invariants); don't try to boil the ocean in one pass.

**Aim above CI.** `pnpm lint` (incl. `scripts/check-boundaries.mjs`) and `pnpm typecheck`
already fail the build on physical import-boundary and type-contract violations. Don't re-flag
those — hunt the architectural risks they can't see (semantic coupling, abstractions, drift
that's still legal today).

## 3. Present findings as open points and stop

Write up the risks as **open points for the user**, each with: area, the regret (why it bites
at 6 months / 10× growth), the doc reference where one applies, and a suggested direction
phrased as a recommendation — not a decision. Group by severity, lead with the load-bearing
ones, and close with the one-line regret summary.

**Do not edit code.** Architecture calls are the user's to make; this review informs them and
hands them the decision.
