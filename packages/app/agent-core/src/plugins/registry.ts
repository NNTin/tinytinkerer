import {
  PluginCaptureError,
  type AgentHookContribution,
  type AgentPlugin,
  type PluginHost,
  type Tool
} from '@tinytinkerer/contracts'

export type PluginContributions = {
  tools: Tool<unknown, unknown>[]
  hooks: AgentHookContribution[]
}

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
    // `Array.from`, not `[...this.plugins.values()]`: a Babel build with
    // `@babel/preset-env`'s `loose: true` (Docusaurus's default client preset)
    // downlevels array spread to `[].concat(x)`, which is only correct for real
    // arrays — for a Map iterator it appends the iterator itself as one opaque
    // element instead of the plugins it yields. `Array.from` is unambiguous
    // under any bundler/target.
    return Array.from(this.plugins.values())
  }

  // Build the tool set for the active plugins, wrapping execute so structured
  // PluginCaptureError reports reach the host sink. Activation/deactivation
  // lifecycle is driven by the change in `activeIds` between calls; every
  // activate/deactivate callback is best-effort (never awaited, failures
  // swallowed) so a misbehaving plugin can never break runtime construction.
  collectTools(activeIds: ReadonlySet<string>, host: PluginHost): Tool<unknown, unknown>[] {
    return this.collect(activeIds, host, false).tools
  }

  // `isToolEnabled` is REGISTRATION-time filtering (issue #400): a tool it
  // rejects is never pushed into `tools`, so it never becomes an entry in
  // `addedPluginToolIds` downstream (app-browser create-runtime) — which means
  // it never gets a planner descriptor and the model never sees it, for free.
  // Optional (not app-core's `isPluginToolEnabled` called directly) because
  // agent-core must not import app-core: the caller closes over its own
  // disabledTools state and hands in a plain function.
  collectContributions(
    activeIds: ReadonlySet<string>,
    host: PluginHost,
    isToolEnabled?: (pluginId: string, toolId: string) => boolean
  ): PluginContributions {
    return this.collect(activeIds, host, true, isToolEnabled)
  }

  private collect(
    activeIds: ReadonlySet<string>,
    host: PluginHost,
    includeHooks: boolean,
    isToolEnabled?: (pluginId: string, toolId: string) => boolean
  ): PluginContributions {
    // Deactivate plugins that were active on a previous call but no longer are.
    // `Array.from`, not `[...this.activated]` — see `list()`'s comment above;
    // spreading a Set hits the same Babel-loose `.concat` corruption.
    for (const id of Array.from(this.activated)) {
      if (!activeIds.has(id)) {
        this.activated.delete(id)
        runHook(() => this.plugins.get(id)?.deactivate?.())
      }
    }

    const tools: Tool<unknown, unknown>[] = []
    const hooks: AgentHookContribution[] = []

    for (const plugin of this.plugins.values()) {
      if (!activeIds.has(plugin.id)) {
        continue
      }

      if (!this.activated.has(plugin.id)) {
        this.activated.add(plugin.id)
        runHook(() => plugin.activate?.(host))
      }

      // Tool construction is optional and may throw; an optional plugin must not
      // be able to take down runtime creation, so skip its tools on failure.
      let pluginTools: Tool<unknown, unknown>[]
      try {
        pluginTools = plugin.createTools?.(host) ?? []
      } catch {
        pluginTools = []
      }

      for (const tool of pluginTools) {
        // Scoped per plugin (plugin.id, not tool.id alone): two plugins may
        // legitimately register the same tool id, and a user disabling that
        // name under plugin A must not suppress plugin B's identically-named
        // tool.
        if (isToolEnabled && !isToolEnabled(plugin.id, tool.id)) {
          continue
        }
        tools.push(wrapToolCapture(tool, host))
      }

      if (includeHooks) {
        // Hook construction follows the same optional-plugin rule as tools:
        // failures skip that plugin's hook contributions without breaking
        // runtime construction or other active plugins.
        try {
          hooks.push(...(plugin.createHooks?.(host) ?? []))
        } catch {
          // Optional plugin hook construction failed — ignored.
        }
      }
    }

    return { tools, hooks }
  }
}

// Runs a best-effort lifecycle hook: never awaited, sync and async failures
// swallowed so plugin lifecycle can never break runtime construction.
const runHook = (hook: () => void | Promise<void> | undefined): void => {
  try {
    void Promise.resolve(hook()).catch(() => {})
  } catch {
    // Synchronous hook failure — ignored.
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
        // Best-effort: a throwing capture sink must not change the error the
        // runtime observes, so the original tool failure is always rethrown.
        try {
          host.capture(error.report)
        } catch {
          // Capture failures are swallowed.
        }
      }
      throw error
    }
  }
})
