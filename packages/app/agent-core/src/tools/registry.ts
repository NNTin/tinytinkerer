import { z } from 'zod'
import type { Tool } from '@tinytinkerer/contracts'

// The pure Tool interface moved to @tinytinkerer/contracts (the leaf) so plugin
// packages can build tools depending only on contracts. Re-exported here so
// agent-core's public surface is unchanged; the runtime ToolRegistry below
// (validation + dispatch) stays in agent-core.
export type { Tool } from '@tinytinkerer/contracts'

export class ToolRegistry {
  private readonly tools = new Map<string, Tool<unknown, unknown>>()

  register<Input, Output>(tool: Tool<Input, Output>): void {
    if (this.tools.has(tool.id)) {
      throw new Error(`Tool already registered: ${tool.id}`)
    }
    this.tools.set(tool.id, tool)
  }

  get(toolId: string): Tool<unknown, unknown> | undefined {
    return this.tools.get(toolId)
  }

  async run(toolId: string, input: unknown): Promise<unknown> {
    const tool = this.tools.get(toolId)
    if (!tool) {
      throw new Error(`Tool not found: ${toolId}`)
    }

    const parsed = z.any().pipe(tool.schema).parse(input)
    const output = await tool.execute(parsed)
    // Output contract (issue #287): when a tool declares an `outputSchema`, validate
    // its result before returning so `agent.tool.completed.payload.output` is a
    // checked structured payload by the time the inspector/timeline consume it. A
    // tool without one keeps returning its raw `unknown` output (prior behaviour),
    // so a tool whose output is intentionally open is unaffected.
    return tool.outputSchema ? tool.outputSchema.parse(output) : output
  }
}
