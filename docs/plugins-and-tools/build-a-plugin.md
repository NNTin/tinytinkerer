---
sidebar_position: 2
title: Build a plugin
---

# Build a plugin

This is a task-oriented walkthrough, not a reference — it builds one small, real tool
(`roll_dice`) end to end. For the full contract, the registry, and every shipped plugin, see
[Plugin infrastructure](./plugin-infrastructure.md); this page links back into it instead of
repeating it.

**Learning objective:** give the assistant a brand-new tool using nothing but
`@tinytinkerer/contracts`, and see it appear in Settings with no host code changed.

## Before you start

- A local clone of the repo with `pnpm install` already run.
- You don't need to touch `app-browser`, the Settings modal, or the tool-tree picker — plugins are
  named in one catalogue, so a new package under `packages/plugins/*` plus one line there is
  enough. See [The plugin catalogue](./plugin-infrastructure.md#the-plugin-catalogue-tinytinkerercatalogue) for why
  that works.

## 1. Scaffold the package

Create `packages/plugins/plugin-dice/package.json`:

```json
{
  "name": "@tinytinkerer/plugin-dice",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "exports": {
    ".": {
      "types": "./src/index.ts",
      "default": "./src/index.ts"
    }
  },
  "main": "src/index.ts",
  "types": "src/index.ts",
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "lint": "eslint src",
    "test": "vitest run --passWithNoTests",
    "typecheck": "tsc -p tsconfig.json"
  },
  "dependencies": {
    "@tinytinkerer/contracts": "workspace:*",
    "zod": "4.4.3"
  }
}
```

and `packages/plugins/plugin-dice/tsconfig.json`:

```json
{
  "extends": "../../../config/tsconfig.base.json",
  "include": ["src", "tests"]
}
```

`packages/*/*` is already a pnpm workspace glob, so `pnpm install` picks up the new package with no
other configuration.

## 2. Write the tool

`packages/plugins/plugin-dice/src/index.ts`:

```ts
import { z } from 'zod'
import type {
  ActivitySummarizer,
  AgentPlugin,
  PluginManifest,
  PluginModule,
  Tool
} from '@tinytinkerer/contracts'

export const DICE_PLUGIN_ID = 'dice'

// The canonical schema: the SAME one the tool validates against and the one the
// manifest advertises to the planner (issue #287 — one schema, no drift). `sides`
// stays optional (`?: number`, not `number | undefined`) rather than using zod's
// `.default()`, so the input and output types of the schema stay identical.
export const rollDiceInputSchema = z.object({
  sides: z
    .number()
    .int()
    .min(2)
    .max(1000)
    .optional()
    .describe('Number of sides on the die. Defaults to 6 if omitted.')
})
export type RollDiceInput = z.infer<typeof rollDiceInputSchema>
export type RollDiceOutput = { sides: number; result: number }

export const summarizeRollDiceActivity: ActivitySummarizer = (output) => {
  const { sides, result } = output as RollDiceOutput
  return {
    title: 'Rolled dice',
    status: 'ok',
    sections: [{ kind: 'text', label: 'Result', value: `${result} (of ${sides})` }]
  }
}

const createRollDiceTool = (): Tool<RollDiceInput, RollDiceOutput> => ({
  id: 'roll_dice',
  description: 'Roll an N-sided die (default 6) and return the result.',
  schema: rollDiceInputSchema,
  summarizeActivity: summarizeRollDiceActivity,
  async execute(input): Promise<RollDiceOutput> {
    const sides = input.sides ?? 6
    return { sides, result: 1 + Math.floor(Math.random() * sides) }
  }
})

export const diceRollerPlugin = (): AgentPlugin => ({
  id: DICE_PLUGIN_ID,
  createTools: (): Tool<unknown, unknown>[] => [createRollDiceTool() as Tool<unknown, unknown>]
})

export const manifest: PluginManifest = {
  id: DICE_PLUGIN_ID,
  label: 'Dice roller (roll_dice)',
  description: 'Lets the assistant roll a die when you ask it to. Off by default.',
  toolDescriptors: [
    {
      id: 'roll_dice',
      description: 'Roll an N-sided die (default 6) and return the result.',
      schema: rollDiceInputSchema,
      summarizeActivity: summarizeRollDiceActivity
    }
  ]
}

export const createPlugin: PluginModule['createPlugin'] = diceRollerPlugin
```

This mirrors the shipped `@tinytinkerer/plugin-feedback` package almost line for line — see
[The Feedback plugin](./plugin-infrastructure.md#the-feedback-plugin-tinytinkererplugin-feedback)
for the pattern this is drawn from. Three things worth noticing:

- `Tool.schema` and the manifest's `toolDescriptors[].schema` are the **same** Zod schema object.
  There is no second, hand-written JSON Schema to keep in sync.
- `createTools` never throws and never touches a host capability — this plugin needs none (no
  network call, no sandboxed code, no DOM read). A plugin that does needs an optional
  `PluginHost` capability instead; see
  [The Code execution plugin](./plugin-infrastructure.md#the-code-execution-plugin-tinytinkererplugin-code-exec)
  for that pattern.
- `summarizeActivity` is what turns a raw `{ sides, result }` object into the readable "Rolled
  dice" row shown in the turn-activity panel, instead of the host's neutral JSON fallback.

## 3. Verify it locally

```bash
pnpm install
pnpm --filter @tinytinkerer/plugin-dice typecheck
pnpm check:boundaries
```

`check:boundaries` is the one that matters most here: it fails the build if this package imports
anything other than `@tinytinkerer/contracts` and local modules — the enforcement behind "a plugin
package must stay product-agnostic."

## 4. Try it

```bash
pnpm dev
```

Open the product, then Settings → Plugins. **Dice roller (roll_dice)** should appear in the list.
Enable it, start a new conversation, and ask: _"Roll a d20."_

If it is missing, you skipped step 3 — `packages/app/catalogue/tests/catalogue-coverage.test.ts`
fails in that case and prints the exact line to add.

**Expected outcome:** the turn-activity panel shows a `roll_dice` call with a "Rolled dice" summary
and a number between 1 and 20. Disable the plugin and ask again — the assistant can no longer call
it, because its tool descriptor is absent from that run's advertised tools entirely (not merely
hidden from the UI).

To see this activation/deactivation mechanic from the picker's side instead of the assistant's,
try the same enable/disable cycle in the
[Plugin & tool-picker impact lab](./plugin-tool-picker-lab.mdx) — it exercises the identical
`useToolTree`/`applyPluginToolSelection` path against its own demo tools.

## Troubleshooting

| Symptom                                             | Likely cause                                                                                                                                                                                                             |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Plugin never appears in Settings                    | `pnpm dev` was already running before the package existed — restart it so Vite's glob re-scans.                                                                                                                          |
| `pnpm check:boundaries` fails                       | The package imports something other than `@tinytinkerer/contracts` (or `zod`) — remove it.                                                                                                                               |
| Tool descriptor exists but the model never calls it | The tool `id` in `manifest.toolDescriptors` doesn't exactly match the `Tool.id` from `createTools` — see the descriptor↔`createTools` lockstep in [Adding a new plugin](./plugin-infrastructure.md#adding-a-new-plugin). |
| Activity shows raw JSON instead of "Rolled dice"    | `summarizeActivity` isn't wired onto both the manifest descriptor and the `Tool` instance, or the plugin wasn't rebuilt/reloaded.                                                                                        |

## Next step

- If your tool needs to reach the network, run untrusted code, or read the page, read the
  capability-injection pattern in [Plugin infrastructure](./plugin-infrastructure.md) before you
  build against a host capability.
- If your plugin sends any user content anywhere, document it in
  [Privacy & Telemetry](../overview/PRIVACY.md), per the last step of
  [Adding a new plugin](./plugin-infrastructure.md#adding-a-new-plugin).
- Want a remote tool instead of a bundled one? See [MCP integration](./mcp-integration.md).
