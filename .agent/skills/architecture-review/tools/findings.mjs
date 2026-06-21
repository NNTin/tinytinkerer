// architecture-review findings tool
//
// Deterministic gatekeeper for the architecture-review skill. It owns the
// machine-checkable half of the confidence-gating contract so the auto/HITL
// split is enforced, not left to prose:
//
//   - `schema`            print the JSON Schema for a findings report
//   - `template`          print a blank report skeleton (one finding of each disposition)
//   - `validate [file]`   validate a report (path arg or stdin) against the schema
//                         AND the gating invariant; print the auto/HITL split
//   - `boundaries`        run the repo cross-package boundary check as an
//                         objective SoC/coupling signal (reuses scripts/check-boundaries.mjs)
//
// The gating invariant (beyond plain JSON Schema):
//   disposition:auto is allowed ONLY when confidence === 'High' AND
//   subjectivity === 'objective'. Directional categories (premature-abstraction,
//   missing-abstraction, maintenance-cost, churn-risk) are judgment by nature:
//   they must be subjectivity:judgment and disposition:HITL. Everything that
//   does not clear the bar is forced to HITL. When in doubt, escalate.
//
// No external deps by design (see scripts/*.mjs style): a tiny JSON Schema
// subset validator interprets the SCHEMA object below, so the schema stays the
// single source of truth for shape, and the invariant pass layers the
// semantic auto/HITL rule on top.

import { readFileSync, readSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import process from 'node:process'

const CATEGORIES = [
  'coupling',
  'churn-risk',
  'SoC',
  'premature-abstraction',
  'missing-abstraction',
  'maintenance-cost',
  'break-risk'
]

// Categories that are inherently directional / opinion-shaped. A reviewer can
// never auto-apply these without a human, regardless of stated confidence.
const JUDGMENT_ONLY_CATEGORIES = new Set([
  'premature-abstraction',
  'missing-abstraction',
  'maintenance-cost',
  'churn-risk'
])

const SEVERITIES = ['low', 'medium', 'high']
const CONFIDENCES = ['High', 'Med', 'Low']
const SUBJECTIVITIES = ['objective', 'judgment']
const DISPOSITIONS = ['auto', 'HITL']

// JSON Schema (draft-07 subset) — the single source of truth for report shape.
const SCHEMA = {
  $schema: 'http://json-schema.org/draft-07/schema#',
  title: 'architecture-review findings report',
  type: 'object',
  required: ['mode', 'scope', 'findings'],
  additionalProperties: false,
  properties: {
    mode: {
      type: 'string',
      enum: ['general', 'targeted', 'plan'],
      description: 'which review workflow produced this report'
    },
    timing: {
      type: 'string',
      enum: ['before', 'after', 'both'],
      description:
        'plan-review only: when the subagent ran relative to plan finalization (default after)'
    },
    scope: {
      type: 'string',
      minLength: 1,
      description:
        'what was reviewed (repo-wide / a package or dir / the plan or PR diff under review)'
    },
    findings: {
      type: 'array',
      items: { $ref: '#/definitions/finding' }
    }
  },
  definitions: {
    finding: {
      type: 'object',
      required: [
        'area',
        'category',
        'severity',
        'confidence',
        'subjectivity',
        'disposition',
        'rationale',
        'suggestedChange'
      ],
      additionalProperties: false,
      properties: {
        area: {
          type: 'string',
          minLength: 1,
          description: 'the file / package / boundary the finding is about'
        },
        category: { type: 'string', enum: CATEGORIES },
        severity: { type: 'string', enum: SEVERITIES },
        confidence: {
          type: 'string',
          enum: CONFIDENCES,
          description:
            'High = a checkable fact (boundary violation, schema not applied, contract/type mismatch); ' +
            'Med = strong pattern read needing one assumption; Low = a hunch / directional call'
        },
        subjectivity: {
          type: 'string',
          enum: SUBJECTIVITIES,
          description:
            'objective = the maintainer would unambiguously accept the fix; judgment = trade-off / taste / directional'
        },
        disposition: {
          type: 'string',
          enum: DISPOSITIONS,
          description:
            'auto = fold in without a human (requires High + objective); HITL = surface for a human, never auto-applied'
        },
        rationale: {
          type: 'string',
          minLength: 1,
          description:
            'why this becomes hard to maintain at 6 months / 10x growth, and the confidence basis'
        },
        suggestedChange: {
          type: 'string',
          minLength: 1,
          description:
            'the concrete change proposed (for HITL findings this is a suggestion, never auto-applied)'
        },
        references: {
          type: 'array',
          items: { type: 'string' },
          description: 'docs/ARCHITECTURE.md or boundary-doc anchors this finding is judged against'
        }
      }
    }
  }
}

const fail = (message) => {
  console.error(`error: ${message}`)
  process.exit(1)
}

// ---- tiny JSON Schema subset validator -------------------------------------
// Supports: type, required, properties, additionalProperties:false, enum,
// items, $ref (#/definitions/*), minLength, minItems. Enough for SCHEMA above.

const resolveRef = (ref) => {
  const path = ref.replace(/^#\//, '').split('/')
  let node = SCHEMA
  for (const key of path) {
    node = node?.[key]
  }
  return node
}

const validateAgainstSchema = (value, schema, path, errors) => {
  if (schema.$ref) {
    return validateAgainstSchema(value, resolveRef(schema.$ref), path, errors)
  }

  const typeOf = Array.isArray(value) ? 'array' : value === null ? 'null' : typeof value
  if (schema.type && schema.type !== typeOf) {
    errors.push(`${path}: expected ${schema.type}, got ${typeOf}`)
    return
  }

  if (schema.enum && !schema.enum.includes(value)) {
    errors.push(`${path}: ${JSON.stringify(value)} is not one of ${schema.enum.join(', ')}`)
  }

  if (schema.type === 'string' && typeof value === 'string') {
    if (typeof schema.minLength === 'number' && value.length < schema.minLength) {
      errors.push(`${path}: must not be empty`)
    }
  }

  if (schema.type === 'array' && Array.isArray(value)) {
    if (typeof schema.minItems === 'number' && value.length < schema.minItems) {
      errors.push(`${path}: needs at least ${schema.minItems} item(s)`)
    }
    if (schema.items) {
      value.forEach((item, index) =>
        validateAgainstSchema(item, schema.items, `${path}[${index}]`, errors)
      )
    }
  }

  if (schema.type === 'object' && typeOf === 'object') {
    for (const key of schema.required ?? []) {
      if (!(key in value)) {
        errors.push(`${path}: missing required property "${key}"`)
      }
    }
    if (schema.additionalProperties === false) {
      for (const key of Object.keys(value)) {
        if (!schema.properties?.[key]) {
          errors.push(`${path}: unknown property "${key}"`)
        }
      }
    }
    for (const [key, propSchema] of Object.entries(schema.properties ?? {})) {
      if (key in value) {
        validateAgainstSchema(value[key], propSchema, `${path}.${key}`, errors)
      }
    }
  }
}

// ---- the gating invariant (semantic, beyond plain shape) -------------------

const allowedDisposition = (finding) => {
  // Directional categories can never be auto-applied.
  if (JUDGMENT_ONLY_CATEGORIES.has(finding.category)) {
    return 'HITL'
  }
  // Auto only when it is both a high-confidence call AND an objective defect.
  return finding.confidence === 'High' && finding.subjectivity === 'objective' ? 'auto' : 'HITL'
}

const validateGating = (findings, errors) => {
  findings.forEach((finding, index) => {
    const at = `findings[${index}] (${finding.area ?? '?'})`

    if (JUDGMENT_ONLY_CATEGORIES.has(finding.category) && finding.subjectivity === 'objective') {
      errors.push(
        `${at}: category "${finding.category}" is directional and must be subjectivity:judgment, not objective`
      )
    }

    const allowed = allowedDisposition(finding)
    if (finding.disposition === 'auto' && allowed !== 'auto') {
      errors.push(
        `${at}: disposition:auto is not permitted — auto requires a non-directional category with ` +
          `confidence:High AND subjectivity:objective (got ${finding.category} / ${finding.confidence} / ${finding.subjectivity}). ` +
          `Escalate to HITL.`
      )
    }
  })
}

// Reading fd 0 directly can throw EAGAIN when stdin is a non-blocking pipe
// (common when another process is piping into us). Read in a chunk loop that
// retries EAGAIN until EOF, so `... | validate` is as reliable as a file arg.
const readStdin = () => {
  const chunks = []
  const buffer = Buffer.alloc(65536)
  while (true) {
    let bytesRead
    try {
      bytesRead = readSync(0, buffer, 0, buffer.length, null)
    } catch (error) {
      if (error.code === 'EAGAIN') {
        continue
      }
      if (error.code === 'EOF') {
        break
      }
      throw error
    }
    if (bytesRead === 0) {
      break
    }
    chunks.push(Buffer.from(buffer.subarray(0, bytesRead)))
  }
  return Buffer.concat(chunks).toString('utf8')
}

const readInput = (file) => {
  try {
    return file ? readFileSync(file, 'utf8') : readStdin()
  } catch (error) {
    fail(`could not read ${file ? file : 'stdin'}: ${error.message}`)
  }
}

const TEMPLATE = {
  mode: 'plan',
  timing: 'after',
  scope: 'describe what was reviewed (e.g. the drafted plan for packages/app-core auth refactor)',
  findings: [
    {
      area: 'packages/app-core/src/example.ts',
      category: 'SoC',
      severity: 'medium',
      confidence: 'High',
      subjectivity: 'objective',
      disposition: 'auto',
      rationale:
        'Objective, checkable defect the maintainer would unambiguously accept — High + objective, so it auto-applies.',
      suggestedChange: 'The concrete fix.',
      references: ['docs/ARCHITECTURE.md#dependency-rules']
    },
    {
      area: 'packages/app-core/src/example-abstraction.ts',
      category: 'premature-abstraction',
      severity: 'medium',
      confidence: 'Med',
      subjectivity: 'judgment',
      disposition: 'HITL',
      rationale:
        'Directional call about whether this abstraction earns its keep at 10x — surfaced for a human, never auto-applied.',
      suggestedChange: 'What you would propose, for the human to weigh.',
      references: ['docs/packages-concept.md']
    }
  ]
}

const runValidate = (file) => {
  const raw = readInput(file)
  let report
  try {
    report = JSON.parse(raw)
  } catch (error) {
    fail(`input is not valid JSON: ${error.message}`)
  }

  const errors = []
  validateAgainstSchema(report, SCHEMA, 'report', errors)

  // Only run the gating pass if the shape is sane enough to read findings.
  if (errors.length === 0 && Array.isArray(report.findings)) {
    validateGating(report.findings, errors)
  }

  if (errors.length > 0) {
    console.error('INVALID — findings report rejected:')
    for (const error of errors) {
      console.error(`  - ${error}`)
    }
    process.exit(1)
  }

  const findings = report.findings
  const auto = findings.filter((finding) => finding.disposition === 'auto')
  const hitl = findings.filter((finding) => finding.disposition === 'HITL')

  console.log(`VALID — ${report.mode} review of "${report.scope}"`)
  if (report.mode === 'plan') {
    console.log(`  timing: ${report.timing ?? 'after (default)'}`)
  }
  console.log(`  findings: ${findings.length} (${auto.length} auto, ${hitl.length} HITL)`)
  for (const finding of auto) {
    console.log(`  [auto] ${finding.severity}/${finding.category} — ${finding.area}`)
  }
  for (const finding of hitl) {
    console.log(`  [HITL] ${finding.severity}/${finding.category} — ${finding.area}`)
  }
  if (report.mode !== 'plan' && auto.length > 0) {
    console.log(
      '\nnote: general/targeted reviews never auto-edit. "auto" here only classifies the ' +
        'finding; modes 1 & 2 still emit a report and stop for a human.'
    )
  }
}

const runBoundaries = () => {
  // .agent/skills/architecture-review/tools/ -> repo root
  const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..')
  const script = join(repoRoot, 'scripts', 'check-boundaries.mjs')
  const result = spawnSync(process.execPath, [script], {
    cwd: repoRoot,
    stdio: 'inherit'
  })
  // A non-zero exit is a real, objective SoC/coupling signal — surface it as
  // High + objective candidate findings. Pass through the exit code.
  process.exit(result.status ?? 0)
}

const main = () => {
  const command = process.argv[2]
  switch (command) {
    case 'schema':
      console.log(JSON.stringify(SCHEMA, null, 2))
      break
    case 'template':
      console.log(JSON.stringify(TEMPLATE, null, 2))
      break
    case 'validate':
      runValidate(process.argv[3])
      break
    case 'boundaries':
      runBoundaries()
      break
    default:
      fail(
        'usage: node findings.mjs <schema|template|validate [file]|boundaries>\n' +
          '  schema      print the JSON Schema for a findings report\n' +
          '  template    print a blank report skeleton\n' +
          '  validate    validate a report (file arg or stdin); enforces the auto/HITL gate\n' +
          '  boundaries  run the repo cross-package boundary check (objective SoC/coupling signal)'
      )
  }
}

main()
