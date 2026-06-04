import { z, type ZodSchema } from 'zod'

export interface Tool<Input, Output> {
  id: string
  description: string
  schema: ZodSchema<Input>
  execute(input: Input): Promise<Output>
}

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
    return tool.execute(parsed)
  }
}
