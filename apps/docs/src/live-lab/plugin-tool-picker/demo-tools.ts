import { z } from 'zod'
import type { AppToolGroup, Tool } from '@tinytinkerer/app-browser'

// Three small, self-contained tools that stand in for a "plugin" in this lab
// (issue #453). They are NOT a plugin: they travel to the runtime as this docs
// app's OWN intrinsic `appToolGroup`, exactly the mechanism
// apps/canvas/apps/mermaid use for their real stage tools (see
// packages/app/app-browser/src/app-tool-group.ts) — a REAL, unmodified runtime
// path, not a simulation. Because these are app tools rather than a plugin,
// there is no activation toggle for them: the group is always present, and
// individual tools are narrowed only through per-tool disablement (the same
// tool-tree picker a plugin's tools would use).
//
// The original reason they were a stand-in no longer holds. This file used to
// say docs "cannot discover a plugin dynamically either", because
// `import.meta.glob` had no webpack equivalent and discovery was aliased to an
// empty stub. Since issue #495 the lab app carries a REAL catalogue — see
// ../../docs-runtime/plugin-subsets.ts, which puts `plugin-code-exec` in this
// very lab. These tools stay because the lab teaches BOTH halves: an app tool
// group with no activation gate, beside a real plugin that has one.

const rollDiceInputSchema = z.object({
  sides: z
    .number()
    .int()
    .min(2)
    .max(100)
    .default(6)
    .describe('Number of sides on each die (2-100). Defaults to a standard six-sided die.'),
  count: z
    .number()
    .int()
    .min(1)
    .max(10)
    .default(1)
    .describe('How many dice to roll (1-10). Defaults to one die.')
})

type RollDiceInput = z.infer<typeof rollDiceInputSchema>
type RollDiceOutput = { rolls: number[]; total: number }

const rollDiceTool: Tool<RollDiceInput, RollDiceOutput> = {
  id: 'lab_roll_dice',
  description:
    'Roll one or more dice and report each result plus the total. Use this when the user asks ' +
    'to roll dice or wants a random number in a small range.',
  schema: rollDiceInputSchema,
  execute({ sides, count }) {
    const rolls = Array.from({ length: count }, () => 1 + Math.floor(Math.random() * sides))
    return Promise.resolve({ rolls, total: rolls.reduce((sum, roll) => sum + roll, 0) })
  }
}

const CONCEPT_EXPLANATIONS: Record<string, string> = {
  manifest:
    'A PluginManifest is host-agnostic metadata a plugin package ships: an id, Settings-modal ' +
    'copy (label/description), the planner descriptors for any tools it contributes ' +
    '(toolDescriptors), and up to one each of a status/inspector/tool-tree descriptor. The host ' +
    'never hard-codes a concrete plugin — it only ever reads this shape.',
  activation:
    'Activation is a simple per-plugin on/off stored as PluginActivationState (pluginId -> ' +
    "boolean). A missing entry falls back to the manifest's defaultEnabled (off unless the " +
    'plugin opts in, like web search). An explicit user choice always wins over that default.',
  'tool-descriptors':
    'A PluginToolDescriptor names a tool the model can call: an id, planner-facing description, ' +
    'and the canonical Zod input schema the runtime also validates against — so the JSON Schema ' +
    'the model sees can never drift from what the tool actually accepts.',
  'per-tool-enablement':
    'Beyond turning a whole plugin on/off, a user can disable individual tools it contributes. ' +
    'This is stored as a DENYLIST (PluginToolDisablementState) — a missing entry means enabled, ' +
    'so a plugin update that adds a new tool ships it enabled by default.'
}

const explainConceptInputSchema = z.object({
  topic: z
    .enum(['manifest', 'activation', 'tool-descriptors', 'per-tool-enablement'])
    .describe('Which plugin-system concept to explain.')
})

type ExplainConceptInput = z.infer<typeof explainConceptInputSchema>
type ExplainConceptOutput = { topic: string; explanation: string }

const explainConceptTool: Tool<ExplainConceptInput, ExplainConceptOutput> = {
  id: 'lab_explain_plugin_concept',
  description:
    'Explain one concept from the TinyTinkerer plugin system: "manifest", "activation", ' +
    '"tool-descriptors", or "per-tool-enablement". Use this when the user asks how plugins or ' +
    'the tool picker work.',
  schema: explainConceptInputSchema,
  execute({ topic }) {
    return Promise.resolve({ topic, explanation: CONCEPT_EXPLANATIONS[topic] })
  }
}

const alwaysFailsInputSchema = z.object({
  reason: z
    .string()
    .max(200)
    .optional()
    .describe('Optional short note on why the model is invoking this tool.')
})

type AlwaysFailsInput = z.infer<typeof alwaysFailsInputSchema>

// Deliberately always throws (issue #453's "tool failures" coverage): a real,
// reproducible failed tool call the model can trigger, so a visitor can see
// exactly what `agent.tool.failed` looks like in both the Pixel Agents view and
// the accessible activity timeline without needing a flaky network condition.
const alwaysFailsTool: Tool<AlwaysFailsInput, never> = {
  id: 'lab_always_fails',
  description:
    'Always fails with an error. Use this ONLY if the user explicitly asks to see what a failed ' +
    'tool call looks like.',
  schema: alwaysFailsInputSchema,
  execute() {
    // A REJECTED promise, not a synchronous throw: `execute` must behave like
    // every other tool's `async execute` — a caller awaiting the call, not just
    // invoking it inside a try/catch, still needs to observe the failure.
    return Promise.reject(new Error('lab_always_fails: this demo tool always fails, on purpose.'))
  }
}

export const PLUGIN_TOOL_PICKER_APP_TOOL_GROUP_ID = 'plugin-tool-picker-lab-demo-tools'

// The docs-lab-only appToolGroup (see createBrowserApp's `appToolGroup` option
// in live-lab/client-runtime.tsx). Held as one exported constant so both the
// runtime wiring and any test/documentation code share the same tool ids.
export const pluginToolPickerDemoToolGroup: AppToolGroup = {
  id: PLUGIN_TOOL_PICKER_APP_TOOL_GROUP_ID,
  label: 'Tool-picker lab demo tools',
  tools: [rollDiceTool, explainConceptTool, alwaysFailsTool]
}
