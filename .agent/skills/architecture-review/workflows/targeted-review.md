# SOP: targeted review — one area

The **predict-the-regret** lens (see `../SKILL.md`) scoped to a single directory, package, app,
or feature. Same contract as the general review — **surface open points for the user and stop,
no edits** — but bounded so it is cheap enough to run often (a new `packages/*`, a churny
module, a boundary you suspect is eroding).

## 1. Fix the scope

State exactly what is under review and what is out of scope — one package
(`packages/app-core`), one app (`apps/widget`), a directory, or a feature that spans a few
files. Everything outside the scope is context, not a finding target.

## 2. Anchor on the relevant docs

Read the slices of the architecture docs that govern this area — don't re-read everything:

- Always: the row(s) for this layer in the `docs/ARCHITECTURE.md` Layers table + its Dependency
  Rules, and the matching `docs/packages-concept.md` responsibility block.
- A plugin? `docs/plugin-infrastructure.md`. Content? `docs/content-platform.md`. Telemetry?
  `docs/sentry-telemetry.md`. Edge/MCP? `docs/mcp-integration.md`. UI? `docs/ui-ux-concept.md`.

## 3. Apply the lens within scope

Run every lens question against the scoped area: hidden (semantic) coupling, churn-prone
interfaces it exports, SoC drift, premature/missing abstraction, maintenance cost, break risk.
**Failure analysis first, directions second.**

Stay above CI: the boundary check and typecheck already gate the physical violations in this
package. The value here is the architectural risk those can't catch — an abstraction that
won't survive the next feature, a contract this package exports that every caller will chase.

## 4. Present findings as open points and stop

Write up the risks as **open points for the user** — area, the regret, the doc reference where
one applies, and a suggested direction phrased as a recommendation. Group by severity. **Stop;
do not edit.** If the scope turns out to be the wrong unit (the risk is really cross-layer), say
so and recommend a general review instead.
