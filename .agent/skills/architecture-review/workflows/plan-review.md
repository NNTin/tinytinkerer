# SOP: plan review — spawnable subagent

A subagent a planning or implementation agent spawns to review an implementation plan for
architectural risk through the **predict-the-regret** lens (see `../SKILL.md`), at a chosen
point **relative to implementation**: `before` the code is written, `after` it is written, or
`both`. It **classifies the architectural risks by the action they warrant** (see the action
policy) and returns them — the review itself never edits code; the calling agent auto-addresses
only the obvious, low-risk fixes and escalates everything else for the user to decide.

`before`/`after` are relative to **implementation**, never to how finished the plan is.

## 1. Read the inputs

- **Implementation plan text** — required for every mode. The design under review.
- **Implementation evidence** — required for `after` (and the after half of `both`): a PR diff,
  `git diff`, changed-file list, or a written summary of what was actually implemented.
- **Optional** — scope (which part of the plan/diff to focus on), architecture docs the caller
  already has in hand, and any specific concerns from the user or planning agent.

**`timing`** ∈ `before | after | both`. **Default `after`.**

- `before` — review the **written plan before any code is implemented**, to catch a regret
  while the design is still cheap to change.
- `after` — review the **implemented diff after the code is written**, comparing it against the
  original plan _and_ the repo architecture: did the implementation drift, and did the drift
  introduce risk?
- `both` — run a `before` review on the plan, then later run an `after` review on the
  implementation/diff against that same plan.

If `after` (or the after half of `both`) is requested **without implementation evidence**, do
not pretend to review it — report that the after review is **blocked / incomplete** for want of
a diff or change summary, and offer the `before` review you _can_ do from the plan.

## 2. Anchor on the architecture under review

Read the `docs/ARCHITECTURE.md` Layers + Dependency Rules and the `docs/packages-concept.md`
blocks for the layers the plan (or diff) touches, plus the subsystem doc if relevant
(`plugin-infrastructure.md`, `content-platform.md`, `sentry-telemetry.md`,
`mcp-integration.md`). The work is judged against these, not against taste. Use any docs the
caller already supplied before re-reading.

## 3. Run the lens — failure analysis first

Apply every lens question to the plan (and, for `after`, to the diff): what hidden coupling
does it add, which interface it introduces will churn, does it let logic settle in the wrong
layer, is it abstracting for one caller or duplicating instead of sharing, what will it cost to
maintain, what will it let a future developer accidentally break. **Do not propose directions
until the failure analysis is done.**

For `after`, also ask the drift question: does the implementation **preserve, weaken, or
change** the plan's architectural intent?

Aim above CI: `pnpm lint` / `pnpm typecheck` will catch a physical boundary or type violation
once the code exists. Spend the review on the risks they can't — the design choices that are
green today and regret tomorrow.

## 4. Classify each risk by action policy

Sort every risk into one of three actions:

- **Auto-addressed obvious mistake** — the calling agent should fix it without a human when the
  fix is **low-risk, local, and clearly implied by the plan or the repo architecture**. For
  example:
  - the implementation contradicts an explicit plan step;
  - a file/update the plan plainly required was missed;
  - logic is duplicated where the plan explicitly said to share it;
  - code is misplaced when the relevant architecture doc gives it an unambiguous home;
  - naming or structure drift makes the implementation inconsistent with the accepted plan.
- **Needs human decision** — anything involving product/design tradeoffs, boundary-ownership
  decisions, new abstractions, contract changes, unclear intent, scope expansion, or multiple
  reasonable solutions. Surface it; do not act on it.
- **No action / informational** — a real risk worth recording that warrants no change now.

**When in doubt, classify it as needing human input.** A wrong auto-fix is worse than a human
glance.

## 5. Return the report

Hand the caller/user a report that states:

- **what artifact(s) were reviewed** (the plan, the diff, or both) and **which timing mode ran**
  (`before` / `after` / `both`);
- the findings split into three groups, each item with: area, the regret (why it bites at 6
  months / 10× growth), the architecture reference where one applies, and a suggested direction
  phrased as a recommendation —
  1. **Auto-addressed obvious mistakes**
  2. **Needs human decision**
  3. **No action / informational risks**
- for `after`, whether the implementation appears to **preserve, weaken, or change** the plan's
  architectural intent.

The review never applies code changes itself: the calling agent acts only on group 1 and leaves
groups 2 and 3 for the user.
