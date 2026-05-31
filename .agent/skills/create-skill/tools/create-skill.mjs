import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const NAME_PATTERN = /^[a-z][a-z0-9-]*$/

const fail = (message) => {
  console.error(`error: ${message}`)
  process.exit(1)
}

const name = process.argv[2]

if (!name) {
  fail('usage: node create-skill.mjs <skill-name>  (kebab-case)')
}

if (!NAME_PATTERN.test(name)) {
  fail(`invalid name "${name}" — use kebab-case, e.g. sentry-debugging`)
}

// .agent/skills/create-skill/tools/ -> .agent/skills/
const skillsDir = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const skillDir = join(skillsDir, name)

if (existsSync(skillDir)) {
  fail(`skill "${name}" already exists at ${skillDir}`)
}

const skillTemplate = `# ${name}

TODO: fill in the sections below, then delete this line.

## When to use
When does an agent reach for this skill? Describe the trigger.

## How
Point to the workflow SOP(s) under \`workflows/\` and the tool(s) under \`tools/\`.
Scan workflow filenames first — don't read every file.

## Available tools
List the scripts in \`tools/\` and what each does.

## Constraints
What must the agent not do? Preconditions, rate limits, auth, etc.

## Success criteria
How does the agent know the task is done correctly?
`

mkdirSync(join(skillDir, 'workflows'), { recursive: true })
mkdirSync(join(skillDir, 'tools'), { recursive: true })
writeFileSync(join(skillDir, 'SKILL.md'), skillTemplate)

console.log(`created skill "${name}":`)
console.log(`  .agent/skills/${name}/`)
console.log(`    SKILL.md      <- fill this in`)
console.log(`    workflows/    <- add at least one SOP (*.md)`)
console.log(`    tools/        <- add the scripts the SOP calls`)
console.log('')
console.log('next: see .agent/skills/create-skill/workflows/new-skill.md')
