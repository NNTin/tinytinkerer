# ao-scheduling

<!-- BEGIN GENERATED: .agent/README.md — do not edit; run `pnpm sync:skill-readme`

# `.agent` — WAT skills (Workflow · Agent · Tools)

Skills the agent uses to work in this repo. Core idea: **offload deterministic steps to scripts so you stay focused on decisions.** Chained 90%-accurate manual steps decay fast (0.9^5 ≈ 59%) — scripts don't drift, and they save tokens.

## Skill layout

```
.agent/skills/<skill-name>/
  SKILL.md      # when to use, how, available tools, constraints, success criteria
  workflows/    # OPTIONAL: markdown SOPs (some skills are just SKILL.md + tools/)
  tools/        # deterministic scripts SKILL.md / the workflows call
```

## How you (the agent) work

1. Match the task to a skill, read its `SKILL.md`.
2. If it has `workflows/`, scan their **filenames** for a relevant SOP — don't read every file.
3. Follow `SKILL.md` (and the SOP, if any); run the tool scripts instead of doing the steps by hand.
4. **Self-evolve:** if you solved something repeatable the hard way, capture it as a new workflow SOP (+ tool). Future agents thank you.

END GENERATED: .agent/README.md -->

Schedule a **one-time** future `ao send <session> "<message>"` using the Unix
`at` command. Read `../../README.md` first for the WAT framework.

## When to use

- A user wants an Agent-Orchestrator message delivered at a specific future time
  or after a delay — e.g. "remind the orchestrator in 2 hours", "ping
  tin-orchestrator at 14:30".
- You need a single deferred `ao send`, not a recurring schedule (`at` fires
  each job exactly once; use a different mechanism for cron-style repetition).

## How

1. Follow `workflows/schedule-ao-message.md`.
2. Gather and **confirm with the user** the three inputs — session, time spec,
   message.
3. Preview with the tool's default dry-run, then re-run the same command with
   `--apply` after confirmation.

## Available tools

- `tools/schedule-ao-send.sh <session> <at-time-spec> <message> [--apply]` —
  dry-run by default (prints the exact queued job and resolved time, schedules
  nothing); `--apply` queues it via `at` and prints the new `atq` entry. The
  time spec is anything `at` accepts (`"now + 2 hours"`, `"14:30"`,
  `"2026-06-24 09:00"`, `"tomorrow"`). Session and message are quoted safely
  into the job, and the queued command always includes `--no-wait` (see below).

## Why `--no-wait`

Deferred `ao send` jobs always pass `--no-wait`. A plain `ao send` blocks for up
to 600s waiting for the target session to become idle before delivering. A job
that fires at a future time is fire-and-queue: it must hand off the message and
return immediately, not stall the `at` job waiting on the session. The tool
bakes `--no-wait` into the queued command, so the emitted job is
`ao send <session> "<message>" --no-wait`.

## Constraints

- Runs where `at` and `ao` coexist — the **`ao` Agent-Orchestrator container**,
  whose entrypoint starts `atd` and permits the `ao` user via `/etc/at.allow`.
  If the tool reports missing or unusable `at`, abort; agents do not have the
  rights to install or configure it.
- **Never schedule until the user explicitly confirms** the session, time, and
  message. The tool stays in dry-run until `--apply` to enforce this.
- One-time only. `at` does not repeat jobs.
- The queued job runs detached as the submitting user; `ao` is resolved to an
  absolute path at schedule time so the job finds it.

## Success criteria

- The dry-run prints the exact queued `ao send <session> "<message>" --no-wait`
  command before anything is scheduled.
- After `--apply`, the tool reports the queued job id.
- The message is delivered once, at the chosen time.
