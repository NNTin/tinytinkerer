# create-skill

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
