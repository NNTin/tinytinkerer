import type { Tool } from '../tools/registry'
import {
  PluginCaptureError,
  type AgentPlugin,
  type PluginHost
} from './types'

// Registry of optional plugins. Activation gating lives here: `collectTools`
// returns tools only for the plugin ids the host marks active, and wraps each
// tool so a thrown PluginCaptureError is routed to the host capture sink before
// being rethrown into the runtime's normal tool-failure path.
export class PluginRegistry {
  private readonly plugins = new Map<string, AgentPlugin>()
  private readonly activated = new Set<string>()

  register(plugin: AgentPlugin): void {
    this.plugins.set(plugin.id, plugin)
  }

  list(): AgentPlugin[] {
    return [...this.plugins.values()]
  }

  // Build the tool set for the active plugins, wrapping execute so structured
  // PluginCaptureError reports reach the host sink. Newly-active plugins get a
  // one-time `activate` call; its result is never awaited and failures are
  // swallowed so a misbehaving plugin can never break a chat run.
  collectTools(
    activeIds: ReadonlySet<string>,
    host: PluginHost
  ): Tool<unknown, unknown>[] {
    const tools: Tool<unknown, unknown>[] = []

    for (const plugin of this.plugins.values()) {
      if (!activeIds.has(plugin.id)) {
        continue
      }

      if (!this.activated.has(plugin.id) && plugin.activate) {
        this.activated.add(plugin.id)
        try {
          void Promise.resolve(plugin.activate(host)).catch(() => {})
        } catch {
          // Activation must never break runtime construction.
        }
      }

      for (const tool of plugin.createTools?.(host) ?? []) {
        tools.push(wrapToolCapture(tool, host))
      }
    }

    return tools
  }
}

// Decorates a tool's execute so a thrown PluginCaptureError forwards its report
// to the host capture sink and is then rethrown. Any other error passes through
// untouched.
const wrapToolCapture = (
  tool: Tool<unknown, unknown>,
  host: PluginHost
): Tool<unknown, unknown> => ({
  ...tool,
  async execute(input) {
    try {
      return await tool.execute(input)
    } catch (error) {
      if (error instanceof PluginCaptureError) {
        host.capture(error.report)
      }
      throw error
    }
  }
})
