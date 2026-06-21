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

Review a design through one lens — **predict the regret** — and emit structured,
confidence-gated findings. Read `../../README.md` first for the WAT framework.

This is a **review** skill. It produces a findings report; it does not refactor the
codebase on a whim. General and targeted reviews **always stop for a human**. Only the
plan-review subagent may fold findings in without a human, and only the ones the tool
certifies as `disposition: auto`.

## When to use

- **General review** — a deliberate, repo-wide architecture-risk pass against
  `docs/ARCHITECTURE.md` + the boundary docs. Token-heavy; run it on purpose (before a
  milestone, after a layer lands), not casually. Stops for HITL.
- **Targeted review** — the same lens scoped to one `packages/*`, `apps/*`, directory, or
  feature. Use it when reviewing a slice — a new package, a churny module, a boundary you
  suspect is eroding. Stops for HITL.
- **Plan review (subagent)** — a planning/implementing agent spawns this inline to review a
  written implementation plan (or a PR's diff against its plan) **with no human in the
  loop**. Runs `after` the plan is drafted by default; opt into `before` (or `both`) for
  foundational/high-stakes designs. Findings are gated so it can run unattended yet still
  escalate the calls a human should make.

If you are about to _affirm_ a design ("looks good, ship it"), that is the trigger to run
this first. The point is to find why it rots before you bless it.

## The lens — predict the regret

You are a principal engineer doing an architecture **risk** review of this repo. Your job is
**not to improve the design** and **not to be reassuring**. It is to predict, concretely, why
this design will be **hard to maintain after 6 months of feature growth and a 10× larger
codebase** — and to do that _before_ affirming anything. Assume the agent that touches this
code next has less context than you and will pattern-match on whatever is already here.

Run the failure analysis **first**; propose fixes only after it is complete. For every
proposal or area, ask:

- **Hidden coupling.** What depends on what without saying so? In this repo coupling has a
  _physical_ definition — the layer table and Dependency Rules in `docs/ARCHITECTURE.md` and
  `docs/packages-concept.md`. A browser app reaching past `@tinytinkerer/app-browser`, an
  `app-core` import of React/`fetch`/`window`, `edge` importing anything but `contracts` +
  `sentry-telemetry`, a **static** dependency on a concrete `plugin-*` package (plugins are
  discovered dynamically via `import.meta.glob` — see `docs/plugin-infrastructure.md`), a
  subpath import into another package, or a new package cycle — these are coupling defects you
  can _check_, not argue. `tools/findings.mjs boundaries` runs the repo's own boundary check
  for exactly these.
- **Interfaces likely to churn.** Which contract will every caller have to chase when it
  changes? `@tinytinkerer/contracts` is the source of truth (Zod schemas → inferred types); a
  schema that leaks per-shell or per-provider shape, or a type hand-declared in parallel to its
  schema, is a future churn magnet. The retired multi-provider field (see
  `docs/sentry-telemetry.md`) is the cautionary tale: a contract that out-lives its purpose.
- **Separation-of-concerns violations.** Thin apps, headless `app-core`, primitive-only `ui`,
  SDK-agnostic `sentry-telemetry`, product-agnostic `plugins/*`. Logic in the wrong layer —
  product behavior trapped in a shell, browser APIs in a headless package, a Sentry SDK in the
  telemetry core — is an SoC defect measured against the Layers table.
- **Premature abstraction.** An interface/factory/generic introduced for one caller, or a
  config flag/branch for a variation that does not exist yet. Costs flexibility tax forever for
  a future that may never arrive. (Directional — escalate.)
- **Missing abstraction.** The same logic copy-pasted across shells or call sites that _should_
  live once in a package (the repo's stated reason apps stay thin). The shared bases in
  `docs/ARCHITECTURE.md#reusable-bases-over-duplication` are the pattern. (Directional —
  escalate.)
- **Maintenance cost.** What will be expensive to keep correct — a per-isolate cache that
  silently resets, durable state the design _assumes_ is durable but isn't, an `accept` that
  blankets a whole call site? (Directional — escalate.)
- **Break risk.** What will a future developer **accidentally break** because the design lets
  them? A contract that does not match its types, a schema declared but never `.parse`d, a
  default that ships an unsafe path, an invariant enforced only by prose and not by a check or
  a type.

Then, and only then, the regret summary: _six months from now, the thing most likely to make
someone curse this code is \_\_\_._ Tie each finding to the doc it offends where one applies —
the reviewer's authority here is the repo's own written architecture, not personal taste.

## How

Scan `workflows/` filenames and follow the matching SOP — don't read all three:

- `workflows/general-review.md` — repo-wide pass; emit report; **stop for HITL**.
- `workflows/targeted-review.md` — scoped pass; emit report; **stop for HITL**.
- `workflows/plan-review.md` — spawnable subagent; takes a **timing** input
  (`before` | `after` | `both`, default `after`); emit gated findings; apply only
  `disposition: auto`.

Every workflow ends by running the findings through the tool, which **enforces** the
auto/HITL split. A report the tool rejects is not done.

## The confidence-gating contract

Gate every finding on **confidence × subjectivity**, never confidence alone. Each finding is a
structured record:

```
{ area, category, severity, confidence, subjectivity, disposition, rationale, suggestedChange, references? }
```

- `category` ∈ `coupling | churn-risk | SoC | premature-abstraction | missing-abstraction | maintenance-cost | break-risk`
- `severity` ∈ `low | medium | high`
- `confidence` ∈ `High | Med | Low` — **High** = a checkable fact (boundary violation, schema
  not applied, contract/type mismatch); **Med** = a strong pattern read needing one
  assumption; **Low** = a hunch / directional call.
- `subjectivity` ∈ `objective | judgment` — **objective** = the maintainer would unambiguously
  accept the fix; **judgment** = a trade-off, taste, or directional call that could conflict
  with the maintainer's intent.
- `disposition` ∈ `auto | HITL`.

The rule the tool enforces (so it is not vibes):

- **`auto`** — fold in without a human. Allowed **only** when `confidence: High` **and**
  `subjectivity: objective`, **and** the category is one that can be objective at all
  (`coupling`, `SoC`, `break-risk`). These are objective defects a maintainer would
  unambiguously accept: a schema not actually applied, a clear boundary/SoC violation,
  dead or duplicated coupling, a contract that doesn't match its types.
- **`HITL`** — surface to the human, never auto-applied. Anything `Low`/`Med` confidence **or**
  `judgment` subjectivity. The directional categories (`premature-abstraction`,
  `missing-abstraction`, `maintenance-cost`, `churn-risk`) are judgment **by nature** and are
  always HITL regardless of stated confidence — "this abstraction is premature", "this
  interface will churn", naming and trade-off opinions.
- **Calibration guardrail — when in doubt, escalate.** A false `auto` (an unwanted edit) is
  worse than a false `HITL` (a human glance). The threshold lives in `tools/findings.mjs`
  (`JUDGMENT_ONLY_CATEGORIES` + the `auto` requires `High`+`objective` rule) so it is tunable
  in one place, not scattered through prose.

## Available tools

- `tools/findings.mjs <command>` — the deterministic gatekeeper. No external deps.
  - `schema` — print the JSON Schema (draft-07) for a findings report.
  - `template` — print a blank report skeleton (one `auto`, one `HITL` finding).
  - `validate [file]` — validate a report (path arg or stdin) against the schema **and** the
    gating invariant; prints the auto/HITL split. Exit 0 = valid, 1 = rejected.
  - `boundaries` — run the repo's `scripts/check-boundaries.mjs` cross-package boundary check
    as an **objective** SoC/coupling signal. A reported violation is a `coupling`/`SoC`
    finding with `confidence: High`, `subjectivity: objective`.

## Constraints

- **This skill emits findings; it does not edit code on modes 1 & 2.** General and targeted
  reviews produce a report and **stop**. No auto-edits, ever.
- **Mode 3 may apply only `disposition: auto` findings** — schema-certified objective defects.
  Everything else is surfaced for the human and left untouched.
- **The tool is the gate, not advice.** A report that `validate` rejects is not finished. Do
  not hand-wave a finding into `auto`; if it doesn't pass, escalate it.
- **Judgment categories are never `auto`.** Don't relabel a premature-abstraction call as
  `SoC` to slip it past the gate.
- **No new dependencies.** The tool is dependency-free by design; keep it that way.
- Judge against the repo's own docs (`docs/ARCHITECTURE.md`, `docs/packages-concept.md`,
  `docs/plugin-infrastructure.md`, the other `docs/*-concept.md`), not personal preference.

## Success criteria

- A findings report exists, every finding is a structured record, and `tools/findings.mjs
validate` accepts it (schema + gating).
- Findings reference `docs/ARCHITECTURE.md` / the boundary docs where one applies.
- Modes 1 & 2 stopped for a human with no auto-edits. Mode 3 applied **only** `auto` findings
  and surfaced the rest, recording the timing it ran under.
- The auto/HITL split was decided by the tool, not by prose.
