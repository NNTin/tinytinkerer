# SOP: list and cancel scheduled `ao send` jobs

Inspect one-time `ao send` jobs in the current user's `at` queue and, when
requested, cancel exactly one job after explicit confirmation. These tools
manage only jobs recognized as output from `tools/schedule-ao-send.sh`;
unrelated `at` jobs are never canceled.

## Listing upcoming schedules

List every recognized AO send:

```bash
bash .agent/skills/ao-scheduling/tools/list-ao-sends.sh
```

Inspect one job by id:

```bash
bash .agent/skills/ao-scheduling/tools/list-ao-sends.sh 12
```

For each schedule, report the job id, timestamp and timezone, owner, queue,
destination AO session, message, and exact queued command.

## Previewing a cancellation

Run the cancellation tool without `--apply`:

```bash
bash .agent/skills/ao-scheduling/tools/cancel-ao-send.sh 12
```

The dry run validates that job `12` exists and is a recognized AO send, then
prints its full details and the exact `atrm 12` command. Show that preview to
the user and obtain explicit confirmation of the job id, time, session, and
message. **Cancel nothing before that confirmation.**

## Canceling after confirmation

Re-run the identical command with `--apply`:

```bash
bash .agent/skills/ao-scheduling/tools/cancel-ao-send.sh 12 --apply
```

The tool revalidates the job, removes it with `atrm`, and verifies that the job
id no longer appears in `atq`. If the job has already fired or disappeared,
report the error and do not substitute a different job id.
