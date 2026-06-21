# architecture-review

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

Review a design through one lens — **predict the regret** — and surface the architectural
risks **automated checks can't see**. Read `../../README.md` first for the framework (this
skill is workflows + lens only; it has no tool — there is nothing here to make deterministic).

This is a **review** skill. It emits findings as **open points for the user to weigh in on**;
it does not edit code and it does not decide on the user's behalf.

## When to use

- **General review** — a deliberate, repo-wide architecture-risk pass against
  `docs/ARCHITECTURE.md` + the boundary docs. Token-heavy; run it on purpose (before a
  milestone, after a layer lands).
- **Targeted review** — the same lens scoped to one `packages/*`, `apps/*`, directory, or
  feature. Use it on a slice — a new package, a churny module, a boundary you suspect is
  eroding.
- **Plan review** — a subagent a planning or implementation agent spawns to review an
  implementation plan for architectural risk, at a chosen point **relative to implementation**:
  `before` the code is written (review the plan), `after` it is written (review the resulting
  diff against the plan), or `both`. Takes a **timing** input (`before` | `after` | `both`,
  default `after`).

If you are about to _affirm_ a design ("looks good, ship it"), that is the trigger to run this
first. The point is to find why it rots before you bless it.

## This is not what CI already does

CI is the deterministic gate: `scripts/check-boundaries.mjs` (run in `pnpm lint`) already
enforces the _physical_ import rules — cross-package boundaries, the product-agnostic source
rules, package cycles — and `pnpm -r typecheck` + `pnpm -r lint` enforce the type contracts.
**Do not re-flag what those already catch.** If a violation would fail CI, CI owns it; leave it
alone.

This skill exists for the architectural mistakes those gates _can't_ see — the ones that are
still perfectly legal imports and green types today, but compound into regret:

- semantic / hidden coupling between modules that don't import each other yet move together,
- interfaces that will churn and drag every caller along,
- separation-of-concerns drift that hasn't yet crossed a checked boundary,
- premature or missing abstractions,
- maintenance cost and the things a future developer will accidentally break.

## The lens — predict the regret

You are a principal engineer doing an architecture **risk** review of this repo. Your job is
**not to improve the design** and **not to be reassuring**. It is to predict, concretely, why
this design will be **hard to maintain after 6 months of feature growth and a 10× larger
codebase** — and to do that _before_ affirming anything. Assume the agent that touches this
code next has less context than you and will pattern-match on whatever is already here.

Run the failure analysis **first**; propose directions only after it is complete. For every
proposal or area, ask:

- **Hidden coupling.** What moves together without saying so? Not the import-rule violations CI
  catches — the _semantic_ coupling underneath: two modules that must change in lockstep, a
  shared assumption baked into both sides of a boundary, a "temporary" reach-through that became
  load-bearing. Judge intent against the Layers table and Dependency Rules in
  `docs/ARCHITECTURE.md` / `docs/packages-concept.md`, and the dynamic-plugin contract in
  `docs/plugin-infrastructure.md`.
- **Interfaces likely to churn.** Which contract will every caller have to chase when it
  changes? `@tinytinkerer/contracts` is the source of truth (Zod schemas → inferred types); a
  schema that leaks per-shell or per-provider shape, or a type hand-declared in parallel to its
  schema, is a future churn magnet. The retired multi-provider field (see
  `docs/sentry-telemetry.md`) is the cautionary tale: a contract that out-lives its purpose.
- **Separation-of-concerns drift.** Thin apps, headless `app-core`, primitive-only `ui`,
  SDK-agnostic `sentry-telemetry`, product-agnostic `plugins/*`. Logic creeping into the wrong
  layer — product behavior settling in a shell, an assumption about the browser in a headless
  package — measured against the Layers table, _before_ it hardens into a checked violation.
- **Premature abstraction.** An interface/factory/generic introduced for one caller, or a
  config flag/branch for a variation that does not exist yet. Costs a flexibility tax forever
  for a future that may never arrive.
- **Missing abstraction.** The same logic copy-pasted across shells or call sites that _should_
  live once in a package (the repo's stated reason apps stay thin). The shared bases in
  `docs/ARCHITECTURE.md#reusable-bases-over-duplication` are the pattern.
- **Maintenance cost.** What will be expensive to keep correct — a per-isolate cache that
  silently resets, durable state the design _assumes_ is durable but isn't, an `accept` that
  blankets a whole call site?
- **Break risk.** What will a future developer **accidentally break** because the design lets
  them? A contract that does not match its types, a schema declared but never `.parse`d, a
  default that ships an unsafe path, an invariant enforced only by prose and not by a type.

Then, and only then, the regret summary: _six months from now, the thing most likely to make
someone curse this code is \_\_\_._ Tie each finding to the doc it offends where one applies — the
reviewer's authority here is the repo's own written architecture, not personal taste.

## How

Scan `workflows/` filenames and follow the matching SOP — don't read all three:

- `workflows/general-review.md` — repo-wide pass.
- `workflows/targeted-review.md` — scoped pass.
- `workflows/plan-review.md` — review a plan / PR diff; takes the timing input.

## How findings are presented

Findings are **open points for the user**, not a verdict and not a contract. For each one give:

- **Area** — the file / package / boundary in question.
- **The regret** — why this becomes hard to maintain at 6 months / 10× growth (the failure,
  not just the smell).
- **Reference** — the `docs/ARCHITECTURE.md` / boundary-doc rule it bears on, where one
  applies.
- **A suggested direction** — phrased as a recommendation for the user to weigh, not a decision
  already made.

Group them by severity, lead with the load-bearing ones, and **stop for the user to decide.**
Architecture calls are judgment calls; the user makes them, the skill informs them.

## Constraints

- **The review never edits code.** It emits findings: general and targeted reviews hand every
  decision to the user, and plan review classifies them so the calling agent can auto-address
  only the obvious, low-risk fixes (see `workflows/plan-review.md`) — everything else still goes
  to the user.
- **Complements CI, doesn't duplicate it.** Don't re-flag boundary/type violations that
  `pnpm lint` / `pnpm typecheck` already catch — focus on what they can't.
- Judge against the repo's own docs (`docs/ARCHITECTURE.md`, `docs/packages-concept.md`,
  `docs/plugin-infrastructure.md`, the other `docs/*-concept.md`), not personal preference.
- No tool, no new dependencies — this skill is the lens and the workflows.

## Success criteria

- A findings report exists, structured as open points (area / regret / reference / suggested
  direction), grouped by severity.
- The findings are architectural risks CI can't catch — not a rehash of boundary or type
  errors.
- Findings reference `docs/ARCHITECTURE.md` / the boundary docs where one applies.
- The review never edited code itself: general and targeted reviews stopped for the user, and
  plan review handed the calling agent a clear split of what to auto-address vs escalate.
