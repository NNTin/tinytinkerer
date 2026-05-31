# create-skill

Scaffold a new WAT skill in `.agent/skills/`. Read `../../README.md` first for the framework.

## When to use
You just solved something repeatable the hard way (a multi-step manual process, a fiddly tool dance) and want future agents to do it deterministically. Codify it into a skill.

## How
Follow `workflows/new-skill.md`. In short:
1. Run the scaffolder to generate the directory + `SKILL.md` template.
2. Fill in `SKILL.md` (when / how / tools / constraints / success).
3. Add the first workflow SOP and the tool script(s).

## Available tools
- `tools/create-skill.mjs <name>` — creates `.agent/skills/<name>/` with `SKILL.md`, `workflows/`, `tools/`. Refuses to overwrite an existing skill.

## Constraints
- Skill name must be kebab-case (`^[a-z][a-z0-9-]*$`), e.g. `sentry-debugging`.
- Never overwrite an existing skill — the tool errors if the dir exists.
- A skill is not done until `SKILL.md` is filled in and it has at least one workflow + tool.

## Success criteria
`.agent/skills/<name>/` exists with a filled-in `SKILL.md`, at least one SOP under `workflows/`, and the tool(s) it calls under `tools/`.
