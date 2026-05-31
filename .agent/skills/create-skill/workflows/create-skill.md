# SOP: create a new skill

## 1. Scaffold
```
node .agent/skills/create-skill/tools/create-skill.mjs <name>
```
`<name>` is kebab-case. This creates `.agent/skills/<name>/` with a `SKILL.md` template, `workflows/`, and `tools/`.

## 2. Write SKILL.md
Fill in every section and delete the `TODO` line:
- **When to use** — the trigger that makes an agent pick this skill.
- **How** — point to the workflow SOP(s) and tool(s).
- **Available tools** — list each script in `tools/` and what it does.
- **Constraints** — preconditions, auth, rate limits, what *not* to do.
- **Success criteria** — how the agent knows it's done correctly.

## 3. Add the first workflow SOP
Create `workflows/<task>.md` with numbered, deterministic steps. Keep filenames descriptive — agents scan filenames before opening files.

## 4. Add the tool(s)
Put the scripts the SOP calls under `tools/`. Match repo style: Node ESM `.mjs`, `node:` imports, no semicolons, single quotes (see `scripts/*.mjs`). Push deterministic work into the script; leave judgment to the agent.

## 5. Verify
```
find .agent/skills/<name>
```
Confirm `SKILL.md` is filled in and at least one workflow + tool exist.
