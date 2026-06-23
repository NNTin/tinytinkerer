# SOP: schedule a one-time future `ao send`

Queue a single `ao send <session> "<message>"` to fire at a future time using
`at`. The tool (`tools/schedule-ao-send.sh`) is dry-run by default and does the
deterministic work; this SOP covers the judgment steps around it.

## 1. Validate `at` availability

```
bash .agent/skills/ao-scheduling/tools/schedule-ao-send.sh --check
```

This confirms `at` and `atq` are installed, that the current user is permitted
to use `at` (`atq` exits 0), and warns if `atd` is not running.

If it exits non-zero: you are not in an environment where scheduling works
(typically: not inside the `ao` container, or the `ao` image predates the `at`
support). **Stop.** The fix is to rebuild/restart the `ao` service so the image
ships `at` and its entrypoint starts `atd` — lair repo
`projects/nntin-labs/services/ao/`. Do not invent a workaround.

## 2. Gather the three inputs

- **session** — the AO session to deliver to, e.g. `tin-orchestrator`. Confirm
  it exists (`ao status` / `ao session ls`) if unsure.
- **time spec** — anything `at` parses: `"now + 2 hours"`, `"14:30"`,
  `"2026-06-24 09:00"`, `"tomorrow"`, `"now + 30 minutes"`.
- **message** — the exact text to send.

## 3. Preview and confirm (do NOT schedule yet)

Run the tool **without** `--apply` to print exactly what would be queued:

```
bash .agent/skills/ao-scheduling/tools/schedule-ao-send.sh \
  tin-orchestrator "now + 2 hours" "Check the deploy and report status"
```

Show the user the printed session, resolved time spec, and `ao send` command.
**Schedule nothing until the user explicitly confirms all three.**

## 4. Schedule

Once confirmed, re-run the identical command with `--apply`:

```
bash .agent/skills/ao-scheduling/tools/schedule-ao-send.sh \
  tin-orchestrator "now + 2 hours" "Check the deploy and report status" --apply
```

The tool prints the `at` confirmation (`job N at <date>`) and the new `atq`
entry, and reports the job id.

## 5. Verify

```
atq                 # the job appears with its fire time
at -c <job>         # read back the queued command — confirm the ao send line
```

Confirm the job id, the scheduled time, and that the embedded command is the
exact `ao send <session> "<message>"` you intended.

## Removing a scheduled job

If the user changes their mind before it fires:

```
atq                 # find the job id
atrm <job>          # cancel it
```
