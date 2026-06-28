# SOP: schedule a one-time future `ao send`

Queue a single `ao send <session> "<message>"` to fire at a future time using
`at`. The tool (`tools/schedule-ao-send.sh`) is dry-run by default and does the
deterministic work; this SOP covers the judgment steps around it.

## 1. Gather the three inputs

- **session** — the AO session to deliver to, e.g. `tin-orchestrator`. Confirm
  it exists (`ao status` / `ao session ls`) if unsure.
- **time spec** — anything `at` parses: `"now + 2 hours"`, `"14:30"`,
  `"2026-06-24 09:00"`, `"tomorrow"`, `"now + 30 minutes"`.
- **message** — the exact text to send.

## 2. Preview and confirm (do NOT schedule yet)

Run the tool **without** `--apply` to print exactly what would be queued:

```
bash .agent/skills/ao-scheduling/tools/schedule-ao-send.sh \
  tin-orchestrator "now + 2 hours" "Check the deploy and report status"
```

Show the user the printed session, resolved time spec, and `ao send` command.
The previewed command includes `--no-wait` — a deferred send is fire-and-queue,
so it must not block waiting for the session to go idle when it fires:

```
ao send tin-orchestrator "Check the deploy and report status" --no-wait
```

**Schedule nothing until the user explicitly confirms all three.**

## 3. Schedule

Once confirmed, re-run the identical command with `--apply`:

```
bash .agent/skills/ao-scheduling/tools/schedule-ao-send.sh \
  tin-orchestrator "now + 2 hours" "Check the deploy and report status" --apply
```

The tool prints the `at` confirmation (`job N at <date>`) and the new `atq`
entry, and reports the job id.

## Removing a scheduled job

If the user changes their mind before it fires, follow
`workflows/list-and-cancel-ao-schedules.md`. Preview the selected job with
`tools/cancel-ao-send.sh <job-id>`, obtain explicit confirmation, then re-run
with `--apply`. Do not call `atrm` directly.
